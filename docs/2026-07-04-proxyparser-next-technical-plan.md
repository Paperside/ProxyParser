# ProxyParser Next 技术实现说明

日期：2026-07-10
状态：已实现（as-built）

本文描述当前仓库已经运行的 Next 架构，不是施工计划。产品目标与交互原则见
`docs/2026-07-04-proxyparser-next-product-design.md`；部署操作见 `docs/deployment.md`；行为细节以代码和测试为最终依据。

## 0. 适用范围与约束

ProxyParser Next 面向 Clash/Mihomo，核心模型是“订阅源快照 + 声明式 BuildConfig → 不可变 Release”。当前仓库的 schema、API 与前端均为 Next 实现，公开拉取入口为 `/s/*`。

必须维持以下不变量：

1. `/s/*` 只读取 active Release，绝不在请求中同步上游或重新渲染。
2. 相同 `EvaluateInput` 必须生成字节级相同的 YAML；配置 YAML 只能由 `emitClashYaml` 输出。
3. Release 与规则快照不可变；回滚生成新 Release，不改写历史。
4. 规则源更新只生成新快照与更新提示，不静默改写 BuildConfig。
5. 发布必须先通过结构校验；mihomo 可用时还必须通过真实内核校验。
6. 运行所需 geodata、17 个内置规则集及官方推荐模板均有仓库内离线资产，联网只用于更新。
7. 自建节点敏感字段与长期 token 明文只以 AES-256-GCM 密文落库；匹配的密钥必须与数据库一起持久化和备份。

## 1. 运行时基线

- 运行时：Bun monorepo，后端 Elysia + `bun:sqlite`，前端 React 19 + Vite + TanStack Router/Query。
- 默认后端端口：`3001`；默认前端开发端口：`5173`。
- 默认数据库：`backend/data/proxyparser.sqlite`；生产 Compose 映射为 `/data/proxyparser.sqlite`。
- 密钥文件：数据库所在目录的 `.secret-key`；生产环境即 `/data/.secret-key`。设置 `PP_SECRET_KEY` 时不生成文件。
- 数据库启动参数：WAL、foreign keys、5 秒 busy timeout。
- 迁移：`backend/migrations/*.sql` 按文件名排序、逐个事务执行，并记录到 `_schema_migrations`。当前为 `0001_schema.sql` 与 `0002_token_ciphertext.sql`。

主要环境变量：

| 变量 | 用途 |
|---|---|
| `DATABASE_PATH` | SQLite 路径；相对路径按 backend 根目录解析 |
| `PUBLIC_BASE_URL` | 生成订阅链接与 `/rs/*` provider URL；生产必设 |
| `JWT_SECRET` | JWT 签名密钥；生产必设 |
| `PP_SECRET_KEY` | 64 位 hex 的数据加密密钥；不设时落 `.secret-key` |
| `PROXYPARSER_MIHOMO_PATH` | 显式指定 mihomo 二进制 |
| `JWT_ACCESS_TTL_SECONDS` / `JWT_REFRESH_TTL_SECONDS` | 登录 token 有效期 |
| `RULESET_CHECK_INTERVAL_MINUTES` | 规则集后台检查间隔，默认 1440 分钟 |

## 2. 架构与数据流

```text
URL / 上传 YAML
      │
      ▼
订阅源同步 ──► 不可变源快照 ──┐
                              ├─► evaluate ─► 结构校验 ─► mihomo 门禁 ─► Release
规则库同步 ──► hash 规则快照 ─┘                                      │
                                                                        ▼
客户端 ◄──────────── GET /s/:subId/:token ─────────────── active Release
客户端 ◄──────────── GET /rs/:hash.yaml ──────────────── 公开规则快照
```

后端入口 `backend/src/index.ts` 负责组装认证、订阅源、规则库、订阅、模板、公开交付与调度器。模块边界：

- `lib/build-config/`：类型、手写校验、稳定节点 ID、模板提炼与实例化。
- `lib/render-v2/`：纯求值、规范化 YAML、Release diff。
- `lib/validate/mihomo-gate.ts`：真实内核校验与离线 geodata 工作目录。
- `lib/scheduler/`：订阅源同步和规则集更新检查。
- `modules/upstream-sources/`：URL/上传源、快照、同步日志与报告。
- `modules/subscriptions/`：草稿、预览、发布、回滚、token、交付、问题与健康状态。
- `modules/rulesets/`：目录、不可变快照、diff、更新与粘贴解析。
- `modules/templates/`：模板版本、提炼报告与应用。

## 3. 存储模型

Next schema 直接定义当前最终表结构：

| 领域 | 主要表 | 说明 |
|---|---|---|
| 用户与认证 | `users`, `user_passwords`, `user_refresh_tokens` | 账号、密码哈希、可撤销 refresh token |
| 订阅源 | `upstream_sources`, `upstream_source_snapshots`, `upstream_source_sync_logs`, `source_sync_reports` | URL/上传源、成功快照、同步审计与节点变化报告 |
| 订阅与发布 | `subscriptions`, `subscription_sources`, `releases`, `subscription_issues` | 草稿/已发布 BuildConfig、源反向索引、不可变版本、待处理问题 |
| 访问 | `subscription_tokens`, `subscription_temp_tokens`, `subscription_pull_logs` | 长期/短期链接及拉取审计 |
| 密钥 | `custom_node_secrets` | 自建节点敏感字段密文 |
| 规则 | `ruleset_catalog`, `ruleset_snapshots` | 可变目录元数据 + 内容寻址不可变快照 |
| 模板 | `templates`, `template_versions` | 模板元数据、版本化 payload 与提炼报告 |
| 事件与审计 | `events`, `audit_logs` | 工作台事件流与账号操作审计 |

`subscription_share_grants` 已在 schema 中预留，但当前公开产品链路使用按订阅长期 token 与短期分享 token，尚无指定用户授权 API/UI。

## 4. BuildConfig 与稳定引用

权威类型位于 `backend/src/lib/build-config/types.ts`，通过 `bun run sync-types` 同步到前端。当前 `BuildConfig.version` 为 `1`，包括：

- `sources`：一个或多个源引用；多源只允许 `rebuild`。
- `nodes`：持续 transforms、按稳定 ID 的 overrides、自建节点。
- `groups`：代理组生成器、自定义组与显式顺序。
- `rules`：前置规则、按目标组织的规则块、块顺序与最终 MATCH。
- `config`：结构化字段及 raw YAML patch。

模式语义：

- `rebuild`：只把源节点当原料，重新构建代理组、规则与配置；支持多源和模板提炼。
- `patch`：以单一源文档为基底，应用节点改动、追加自定义组/规则和配置补丁；不支持模板提炼。

原生节点 ID 为 `n_<sha256(type|server|port) 前 12 位>`。改名和凭据轮换不改变 ID；server/port 变化按删旧增新处理。相同 identity 冲突时按节点名稳定排序后加入序号，保证结果可重放。

raw patch 不能覆盖 `proxies`、`proxy-groups`、`rules` 或 `rule-providers`；这些键只能由对应模块生成。

## 5. 确定性渲染

`backend/src/lib/render-v2/evaluate.ts` 是无 IO 的求值入口：

1. `collectNodes`：读取启用源，计算稳定 ID，执行 transforms/overrides，解密并追加自建节点，处理输出名冲突。
2. `generateGroups`：求值 Proxies/地区/Auto 生成器，展开 selector 与自定义成员，按 `groups.order` 排序。
3. `assembleRules`：输出 prelude、按目标排序的手动规则或快照规则，最后输出 MATCH。公开大规则集可生成无 `interval` 的托管 provider；私有或显式 inline 的快照展开为普通规则。
4. `applyConfig`：写入结构化配置，并深合并经过限制的 raw patch。
5. patch 支路：保留源文档，传播节点改名/禁用，插入自定义组与规则，并保留源 MATCH。
6. `validateStructural`：检查名称、成员、规则目标、provider 引用与 MATCH 位置，输出结构化 issues。
7. `emitClashYaml`：固定顶层、节点、代理组与 provider 键序，再由 js-yaml 序列化。

`emitClashYaml` 是 Clash 配置的唯一 YAML 序列化出口；规则集规范化使用独立的 payload 序列化逻辑。golden 测试锁定配置输出字节。

## 6. 发布、回滚与上游吸收

手动发布流程：

```text
draft_build_config ?? build_config
  → 组装最新成功源快照、钉住的规则快照与自建节点 secrets
  → evaluate
  → error issues 阻断并落 subscription_issues / event
  → mihomo 可用时执行内核校验
  → 与 active Release 计算结构化 diff
  → 事务创建 seq+1 Release，切换 active_release_id，清空草稿
  → 刷新健康状态
```

Release 冻结 BuildConfig、源快照 ID、渲染 YAML、内容 hash、diff、触发原因与校验结果。回滚直接复用目标历史 Release 的冻结产物创建一个新的 `trigger=rollback` Release，不重渲染也不改写旧版本。

URL 源同步成功后生成节点增删、改名和凭据变化报告，并回调订阅服务：

- 新求值结果 hash 未变：不发版。
- `publishPolicy=auto` 且无 error issue：自动发布 `upstream_sync` Release。
- `confirm` 或存在 error：保留线上版本，设置 pending change、issues 与事件，等待人工处理。

健康状态为 `ok | warn | error`：无 active Release 为 error；源同步失败/过期、引用缺失或 error issue 为 warn；已发布且无上述问题为 ok。

## 7. 交付与访问

公开端点：

- `GET /s/:subId/:token`：长期链接。
- `GET /s/:subId/t/:token`：带 TTL、可撤销的短期链接。
- `GET /rs/:hash.yaml`：仅公开规则快照，响应 `Cache-Control: public, max-age=31536000, immutable`。

订阅拉取先做内存限流与 token SHA-256 比对，只读取 active Release。无 Release 返回 503；无效 token 返回 403；成功响应包含 YAML、下载文件名、`profile-update-interval`，并在有缓存用量时透传 `subscription-userinfo`。每次成功、拒绝或失败均记录 pull log。

长期 token 的 hash 用于鉴权，明文密文用于用户按需再次复制；轮换会立即删除旧 token。短期 token 明文只在创建响应中返回。

## 8. 规则库

`backend/assets/rulesets/manifest.json` 定义 17 个内置规则集及合并源，配套 YAML 是首启 seed 的离线快照。`directory.json` 是可搜索的扩展目录索引，浏览目录本身不落库。

规则处理流程：

1. 拉取远端内容并规范化为 `payload`。
2. 以规范化内容的 SHA-256 作为 `ruleset_snapshots.hash`。
3. 新 hash 只创建新快照并置 `update_available`，不修改订阅。
4. 用户查看快照 diff 并确认后，批量替换所选订阅草稿中的 hash，再走正常发布流程。

订阅工作台规则区还提供 `POST /api/subscriptions/:id/rulesets/sync-latest` 一键入口：服务端按唯一 catalog 将当前配置已有的 snapshot 引用对齐到规则库的 `latest_snapshot_hash`，保留目标、顺序、emit 方式及其他草稿修改。该操作不抓取远端、不新增规则、不清更新徽章且不发布；同步期间工作台锁定编辑，完成后重新载入服务端草稿，仍需用户预览并显式发布。

公开快照可由 `/rs/*` 托管；私有快照只能 inline，避免内容泄露。粘贴规则接口只解析、去重和报告，不直接落库，前端确认后才写 BuildConfig。

更新仓库内全部离线副本使用 `bun backend/scripts/fetch-rulesets.ts`；也可追加 slug（例如 `chinamax anthropic`）只更新指定规则集。该脚本根据 manifest 合并 domain/classical 来源及 `extraRules`，再生成规范化 YAML。

## 9. 后台调度与事件

`Scheduler` 单进程运行：启动立即 tick，之后默认每 60 秒检查一次；测试环境不自动启动，通过 `runTickOnce()` 驱动。

- 每轮最多同步 5 个到期订阅源、检查 5 个到期规则集。
- 单任务失败隔离并写日志，不中断同轮其他任务。
- 源同步成功会落快照、同步报告和事件，并触发 §6 的订阅吸收。
- 规则检查发现新 hash 会落新快照和 `ruleset.update_available` 事件。

`GET /api/events` 提供工作台事件流；`GET /api/instance/health` 返回数据库、调度器、mihomo 门禁和公开地址状态。

## 10. 规则追踪器

`POST /api/subscriptions/:id/trace` 可针对草稿或已发布 BuildConfig 求值后逐条追踪域名/IP。当前精确处理 DOMAIN、DOMAIN-SUFFIX、DOMAIN-KEYWORD、IPv4 CIDR、RULE-SET 与 MATCH；IPv6 CIDR 不做精确匹配，GEOSITE/GEOIP/IP-ASN 返回 `maybe` 说明并继续匹配后续规则。

响应包含命中规则、RULE-SET 内部命中项、目标、代理组第一成员链和保守判断说明。

## 11. mihomo 发布门禁

二进制解析顺序：`PROXYPARSER_MIHOMO_PATH` → 数据目录的 `bin/mihomo` → `$PATH`。不可用时发布降级为结构校验，并在实例健康与 Release validation 中标明。

校验时创建临时工作目录，把 `backend/assets/geodata/geosite.dat` 与 `country.mmdb` 复制进去，写入候选配置，再执行：

```text
mihomo -t -f <config> -d <temp-dir>
```

默认超时 10 秒，结果记录 exit code、耗时与最后若干行输出；失败阻断发布。`bun backend/scripts/fetch-mihomo.ts` 和 `fetch-geodata.ts` 分别更新本地内核与离线 geodata。

## 12. 密钥与安全边界

- `.secret-key` 或 `PP_SECRET_KEY` 同时保护自建节点 secrets 与长期 token 明文密文；丢失后已有密文无法恢复。
- 密钥不进入 SQLite，也不得提交 Git；备份必须同时包含 `proxyparser.sqlite` 与匹配的 `.secret-key`，或外部保存的 `PP_SECRET_KEY`。
- 公开交付和规则快照端点有独立的内存限流；认证注册、登录与刷新也有限流。
- 公开 `/rs/*` 只读取 `is_public=1` 的快照。
- `backend/data/mock-subscriptions/` 可能包含真实节点，禁止提交或在日志/测试输出中打印。

## 13. 模板

`TemplatePayloadV2` 是去掉 sources 的 rebuild BuildConfig：

- transforms、生成器、自定义组、规则与配置保留。
- 原生节点 overrides 和原生节点 ID 成员被剔除并写入提炼报告。
- 自建节点结构保留，secret 变为占位符；应用后 `secretRef=null`，由用户在节点页补全。
- patch 模式因绑定单一源，明确禁止提炼。

`extractTemplate` 与 `instantiateTemplate` 都是纯函数，往返收敛由测试锁定。官方“推荐方案”由 `seed-builtin-templates.ts` 根据 17 个内置规则集生成，因而首启不依赖网络。

## 14. 前端

前端路由位于 `frontend/src/router.tsx`，业务页面按路由 lazy load。认证后入口为 `/workbench`，其余主路由是 `/subscriptions`、`/subscriptions/new`、`/subscriptions/:id/:tab`、`/sources`、`/rulesets`、`/templates` 与 `/settings`。

订阅工作台按 overview/nodes/groups/rules/config/releases/access 分区；右侧 rail 提供预览、diff、问题与规则追踪。服务端状态由 TanStack Query 管理，变更后按 query key 失效刷新；UI 文案统一中文。

设置页当前提供账号信息、数据库/调度器/mihomo/公开地址健康状态和备份指引。备份/恢复是运维操作，当前没有浏览器内导出或恢复接口。

## 15. API 概览

| 领域 | 前缀与能力 |
|---|---|
| 认证 | `/api/auth/*`, `/api/me`：注册、登录、刷新、退出、资料 |
| 订阅源 | `/api/sources/*`：URL/上传源 CRUD、同步、同步报告 |
| 订阅 | `/api/subscriptions/*`：CRUD、草稿、规则快照同步、预览、发布、回滚、版本、追踪、问题、访问 |
| 自建节点 secrets | `/api/secrets/*`：按协议拆分/加密字段、owner 校验后的编辑回显 |
| 规则库 | `/api/rulesets/*`：目录、导入、快照、更新、diff、解析、应用更新 |
| 模板 | `/api/templates/*`：列表、提炼预览、保存、实例化、元数据、删除 |
| 运行状态 | `/api/events`, `/api/instance/health`, `/api/health` |
| 公开交付 | `/s/*`, `/rs/*` |

API 的精确请求体和响应体以各模块 `routes.ts` 及 Swagger `/swagger` 为准。

## 16. 验证与变更检查

当前自动化基线为 59 个后端测试，覆盖稳定 ID、BuildConfig 校验、确定性/golden 渲染、发布与回滚、断网交付、上游自动/确认吸收、规则更新与后处理、订阅级 latest 快照同步、追踪、模板往返、token 生命周期、secrets 拆分、规则更新工具及运行时持久化路径。

提交前至少运行：

```bash
bun run typecheck
cd backend && bun test
cd ../frontend && bun run build
```

若渲染行为有意变化，必须审查 YAML diff，并以 `UPDATE_GOLDEN=1 bun test` 显式更新 `backend/tests/golden/`；不得顺手接受未知 golden 变化。部署链路另运行 `bash scripts/tests/deploy-config.test.sh`。
