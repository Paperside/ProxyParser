# ProxyParser 技术方案

最后更新：2026-04-08

## 1. 当前基础

当前仓库已经具备以下能力：

- `Bun + Elysia + SQLite` 后端，已具备迁移、认证、用户、上游订阅、模板、生成订阅、订阅秘钥分发等基础能力
- `React + Vite` 前端，已具备登录、工作台、订阅、模板、设置，以及新一版生成订阅向导页
- 生成订阅已同时支持两条渲染链路：
  - 旧链路：`上游订阅快照 -> 模板 payload -> 生成订阅 YAML`
  - 新链路：`上游订阅快照 -> 草稿操作流重放 -> 生成订阅 YAML`
- 生成订阅发布时会自动沉淀一份蓝图模板，并在后续重发时持续滚动模板版本
- 内置规则源目录已经升级为“真实抓取入库 + 定时同步”的模型，并可直接作为向导中的 rule-provider 来源
- 用户也可以导入第三方规则源，规则项会进入同一套本地缓存和定时同步流程
- 前端已具备快照历史 / diff、模板市场复制、规则源管理、账号与安全活动面板
- 后端已补齐结构化日志、审计日志、认证/订阅拉取限流，以及关键主链路自动化测试
- 当前主要工作已经从“搭地基”转向“继续细化编辑器体验与模板生态”

本方案的目标，是把当前的解析器和检查面板推进为一个真正可用的多用户 Mihomo 订阅管理服务。

## 2. 产品级决策

### 2.1 支持的配置方言

V1 只支持 `Mihomo-compatible Clash YAML`。

原因：

- 配置能力更完整，且仍在积极维护
- 能覆盖我们要做的核心功能，包括 `proxy-providers`、`rule-providers`、`proxy-groups`、`rules`、DNS，以及链式代理相关字段如 `dialer-proxy`
- 过早支持多种方言，会让模板引擎、校验层和 UI 编辑器快速失控

### 2.2 数据库选型

V1 使用嵌入式 `SQLite`，数据库文件与后端进程部署在一起。

具体实现选择：

- 数据库引擎：`SQLite`
- 访问层：`bun:sqlite` + 轻量仓储层
- 迁移方式：提交到仓库的版本化 `.sql` 文件
- SQLite 模式：`WAL`

原因：

- 预期用户量不大
- 不需要单独维护数据库服务
- 读多写少，适合 SQLite
- 数据量较小，单文件数据库足够支撑 V1
- 能显著降低部署和运维成本

约束：

- V1 默认单节点部署
- 后台任务与 API 服务运行在同一进程
- 未来若并发写压力上升，仓储层需要预留迁移到 PostgreSQL 的空间

### 2.3 认证方式

API 认证使用 `JWT`。

推荐模型：

- 短期访问令牌 `access token`
- 较长期刷新令牌 `refresh token`
- 刷新令牌仅在数据库中保存哈希值，支持撤销
- 用户密码使用 `argon2id` 进行哈希

### 2.4 共享模型

模板和订阅都采用共享表的多租户设计，而不是每个用户独立建表。

每条记录至少应包含：

- `owner_user_id`
- `visibility`
- `share_mode`

推荐的 `visibility`：

- `private`
- `unlisted`
- `public`

语义：

- `public`：可以进入市场
- `unlisted`：可通过链接分享，但不参与公开发现
- `private`：仅所有者可见

### 2.5 前端语言与 UI 决策

新的产品化 UI 默认使用中文。

约束：

- 页面主文案、表单说明、状态标签、错误提示、操作按钮默认使用中文
- 内部字段名、API 字段、数据库字段仍保持英文，避免实现层混乱
- 若未来支持国际化，中文为默认语言，英文作为后续扩展

### 2.6 生成订阅核心模型调整

当前“先创建模板，再绑定上游订阅生成最终订阅”的模型过于刚性，需要调整。

修订后的核心原则：

- 用户创建生成订阅时，不应被迫先创建模板
- 生成订阅的创建流程是一个向导式编辑过程
- 系统在数据库中保存的是“操作”，而不只是最终配置结果
- 模板是这条操作流自然沉淀出来的可复用蓝图，而不是前置依赖
- 如果在 `patch` 模式下修改了外部订阅原本就存在的对象，那么这套蓝图应被标记为 `source_locked`，不能进入公共市场
- 如果只是新增内容，或使用 `full_override`，则蓝图通常可被提炼为可共享模板

### 2.7 内置规则源策略

内置规则源不再只是四个 GitHub 仓库链接的占位符。

V1 修订为：

- 后端维护一份受控的内置规则项目录
- 每个目录项都对应一个真实可抓取的规则文件，而不是一个仓库名
- 启动时和后台定时任务都会把这些规则项拉取到本地数据库
- 默认更新周期为 `24 小时`
- 用户在向导或模板编辑时，引用的是“已落库的规则项”，而不是手工复制远端 URL

## 3. 术语澄清

“订阅”这个词在产品里会非常混乱，内部必须拆成三个概念。

### 3.1 上游订阅源

用户提供的远端 Clash/Mihomo 订阅链接。

示例：

- 机场订阅地址
- 其他平台生成的 Clash 订阅 URL

建议内部命名：`upstream_source`

### 3.2 模板

模板不再是创建生成订阅的前置条件。

修订后，模板的语义变为：

- 对一组“生成订阅操作”的可复用提炼
- 适用于跨订阅复制的蓝图
- 只有在不依赖某个外部订阅具体对象的情况下，才适合共享和进入市场

建议内部命名仍保留：`template`

但业务上必须明确：`template` 是复用产物，不是编辑入口。

### 3.3 生成订阅

用户真正拉取的，是“生成订阅”，而不是“托管订阅”。

建议：

- UI 统一使用“生成订阅”
- 内部兼容命名可暂时保留 `managed_subscription`

生成订阅应抽象为：

`generated_subscription = upstream_source + operation_flow + publication settings + derived blueprint`

### 3.4 向导式生成订阅

创建生成订阅应改为单独的新页面，以向导形式完成。

建议步骤：

1. 选择外部订阅
2. 编辑节点
3. 编辑代理组与规则
4. 编辑其他设置
5. 预览并确认最终 Mihomo 配置

每一步都支持：

- 可视化编辑
- `RAW` 编辑
- `patch` / `full_override` 模式切换

其中 `patch` 是默认模式。

## 4. 模板与蓝图模型（修订）

### 4.1 操作流优先

数据库应保存“用户做了什么操作”，而不是只保存“最后 YAML 长什么样”。

至少要记录：

- 当前步骤数据
- 当前步骤模式：`patch` / `full_override`
- 操作类型：新增 / 删除 / 修改 / 重排 / 覆盖
- 操作目标：节点 / 代理组 / 规则 / rule-provider / 其他配置块
- 操作发生时引用的对象标识

### 4.2 模板是沉淀物

当一条生成订阅的操作流具备复用价值时，系统可以把它提炼为模板。

提炼结果应至少包含：

- 蓝图名称
- 是否可共享
- 是否 `source_locked`
- 由哪些步骤与操作组合而成
- 导出的结构化 payload
- 导出的 Mihomo YAML 预览

### 4.3 模板共享限制

若出现以下情况，模板应自动标记为 `source_locked` 或仅订阅私有：

- 在 `patch` 模式下直接修改了外部订阅原有节点
- 在 `patch` 模式下修改了外部订阅原有代理组
- 在 `patch` 模式下重写了依赖源内对象名称的规则引用

以下情况通常可共享：

- 新增节点
- 新增规则
- 新增代理组
- 全量 `full_override`

## 5. 生成订阅模型（修订）

生成订阅是用户消费的最终结果，同时也是一条“可持续重放的操作流水线”。

建议字段除现有元数据外，新增以下概念：

- 当前操作流版本
- 最新成功重放版本
- 蓝图提炼状态
- 共享适配状态：`shareable` / `source_locked`
- 向导当前步骤
- 步骤草稿更新时间

生成逻辑不再只是：

`上游订阅 + 模板 -> YAML`

而是：

`上游订阅快照 + 操作流重放 + 蓝图导出 + 发布参数 -> YAML`

## 4. 模板模型

### 4.1 模板包含的内容

模板包含三个高层部分：

1. 规则组与规则
2. 配置
3. 自定义节点

### 4.2 模板应用模式

对于 `规则组与规则`、`配置`，都支持两种模式：

- `patch`
- `full_override`

语义：

- `patch`：基于上游订阅进行增量追加、替换或覆盖
- `full_override`：完全忽略上游对应部分，使用模板内定义的内容作为真值

对于 `自定义节点`，V1 支持增量注入，并显式配置冲突策略：

- `append`
- `replace_same_name`
- `fail_on_conflict`

### 4.3 模板的持久化结构

模板在数据库中应至少包含：

- 元数据
- 可见性与市场字段
- 引用的规则源
- 规则块
- 分组块
- 配置块
- 自定义节点块
- 版本历史

### 4.4 模板的存储形式

模板不能只存原始 YAML。

正确做法：

- 数据库存结构化 JSON，作为编辑器和后端渲染的真值
- 需要展示或导出时，再生成 Mihomo YAML

V1 的结构化模板建议至少覆盖：

- `rules_mode`
- `groups_mode`
- `config_mode`
- `custom_proxies_policy`
- `rule_provider_refs`
- `rules`
- `proxy_groups`
- `config_patch`
- `custom_proxies`

## 5. 托管订阅模型

托管订阅是用户消费的最终结果。

建议字段：

- 所有者
- 展示名
- 绑定的 `upstream_source_id`
- 绑定的 `template_id`
- 发布状态
- 可见性
- 订阅秘钥策略
- 上次同步时间
- 上次渲染时间
- 上次抓取状态
- 上次渲染状态
- 缓存的用量元数据
- 缓存的响应头
- 当前生效快照 ID

用户侧关心的元数据至少应包括：

- 名称
- 用量 / 剩余流量
- 到期时间
- 上次从远端同步的时间
- 上次在本系统中更新的时间
- 上次同步状态
- 上次渲染状态

用户可以改托管订阅的展示名，而不影响上游源名称。

## 6. 订阅访问与秘钥模型

每个用户拥有一套长期订阅秘钥，作用于该用户的所有托管订阅。

拉取地址形态建议为：

`GET /subscribe/:subscriptionId?token=<user-secret-or-temp-secret>`

规则：

- 每个用户有一条长期秘钥
- 支持长期秘钥轮换
- 支持临时订阅令牌
- 临时订阅令牌默认有效期 24 小时
- 过期的临时令牌不得再拉取最新订阅

存储约束：

- 不在数据库中保存明文秘钥
- 只保存哈希
- 记录 `expires_at`、`revoked_at`、`last_used_at`

## 7. 同步与渲染行为

### 7.1 上游同步策略

当系统需要新鲜数据时：

1. 拉取上游订阅源
2. 捕获响应头，尤其是用量与过期相关信息
3. 保存原始响应与同步结果
4. 解析为统一的内部表示
5. 触发依赖该上游源的托管订阅重新渲染

推荐请求行为：

- 固定稳定的 `User-Agent`
- 支持超时
- 尽量支持 `ETag` 和 `If-Modified-Since`
- 始终保留最近一次成功的原始快照和解析快照

### 7.2 用户拉取订阅时的行为

当客户端拉取托管订阅时：

1. 校验访问令牌
2. 若缓存过旧，尝试刷新上游订阅
3. 若上游刷新成功，则重新渲染并返回最新结果
4. 若上游刷新失败，则回退到最近一次成功渲染的缓存快照
5. 记录本次同步和渲染状态，便于排障

产品目标：

- 优先返回最新结果
- 刷新失败时优先回退缓存
- 只有在不存在任何有效缓存时，才真正让用户拉取失败

### 7.3 状态语义

同步状态与渲染状态必须分开记录。

建议同步状态：

- `idle`
- `syncing`
- `success`
- `failed`
- `stale`

建议渲染状态：

- `pending`
- `rendering`
- `success`
- `failed`
- `degraded`

`degraded` 表示最新同步失败，但系统仍在对外提供最近一次有效快照。

## 8. 渲染流水线

当前项目已经有部分能力，但 V1 需要正式化为一条清晰的渲染流水线。

### 8.1 流程步骤

1. 把上游文本解码为 Mihomo YAML
2. 解析为统一内部结构
3. 解析并加载引用的规则源
4. 应用模板的 patch / full override 逻辑
5. 注入自定义节点
6. 重建引用关系
7. 校验最终配置是否合法
8. 序列化为 YAML
9. 保存渲染快照和元数据

### 8.2 内部表示

不要直接围绕最终 YAML 字符串做所有逻辑。

应建立统一内部表示，至少覆盖：

- `proxies`
- `proxy-providers`
- `rule-providers`
- `proxy-groups`
- `rules`
- 顶层配置字段
- 暂不支持但需要保留的原始块

### 8.3 冲突处理

常见冲突：

- 模板引用了不存在的代理组
- 自定义节点与上游节点重名
- 第三方规则源重复导入
- Full Override 删除了仍被其他配置引用的组

V1 策略：

- 非法引用一律快速失败
- 在渲染记录中保存详细错误信息
- 若存在历史成功快照，则继续对外服务历史快照

## 9. 规则源目录与市场默认内容

不应继续把规则硬编码成一份固定 `rules.json`。

V1 应维护一个内置规则源目录，至少支持三类内容：

- 产品内置的默认规则源
- 第三方规则源
- 用户可发布到市场的模板

每个目录项至少应包含：

- 名称
- 类型
- 来源 URL 或内联内容
- 源仓库
- 更新频率
- 校验信息或版本标记
- 启用状态
- 许可证 / 署名说明

适合作为默认参考池的社区仓库：

- `Loyalsoldier/clash-rules`
- `MetaCubeX/meta-rules-dat`
- `blackmatrix7/ios_rule_script`
- `ACL4SSR/ACL4SSR`

## 10. 建议的数据模型

V1 至少需要以下表。

### 10.1 用户与认证

- `users`
- `user_passwords`
- `user_refresh_tokens`
- `user_subscription_secrets`
- `user_subscription_temp_tokens`

### 10.2 上游源

- `upstream_sources`
- `upstream_source_sync_logs`
- `upstream_source_snapshots`

### 10.3 模板

- `templates`
- `template_versions`

### 10.4 托管订阅

- `managed_subscriptions`
- `managed_subscription_snapshots`
- `managed_subscription_pull_logs`

### 10.5 公共目录与审计

- `ruleset_catalog`
- `ruleset_cache_entries`
- `audit_logs`

## 11. 各表职责说明

### `users`

- 基本身份信息
- 保证邮箱和用户名唯一

### `user_passwords`

- 仅保存密码哈希

### `user_refresh_tokens`

- 保存 refresh token 的哈希
- 带过期和撤销字段

### `user_subscription_secrets`

- 保存当前长期订阅秘钥哈希
- 记录轮换信息

### `user_subscription_temp_tokens`

- 保存临时订阅令牌哈希
- 可配置作用范围是全部订阅还是单个订阅
- 带 TTL

### `upstream_sources`

- 所有者
- 上游 URL
- 展示名
- 启用状态
- 共享状态
- 上次同步摘要
- 上次成功快照 ID

### `upstream_source_snapshots`

- 原始文本
- 解析后的 JSON 快照
- 响应头 JSON
- 用量元数据
- 同步结果

### `templates`

- 所有者
- 展示元数据
- 可见性
- 市场字段
- 最新版本 ID

### `template_versions`

- 结构化 JSON 载荷
- 可选导出的 YAML
- 版本说明

### `managed_subscriptions`

- 所有者
- `upstream_source_id`
- `template_id`
- 展示名
- 可见性
- 启用状态
- 最近同步状态
- 最近渲染状态
- 最近成功快照 ID

### `managed_subscription_snapshots`

- 渲染后的 Mihomo YAML
- 渲染后的 JSON 快照
- 需要透传的响应头
- 来源快照 ID
- 模板版本 ID
- 校验结果

### `ruleset_catalog`

- 存放官方默认规则源和后续可拓展的共享目录

### `audit_logs`

- 谁对哪个实体做了什么操作
- 保存安全与审计相关行为

## 12. 后端模块划分建议

建议按以下目录逐步拆分：

- `src/modules/auth`
- `src/modules/users`
- `src/modules/upstream-sources`
- `src/modules/templates`
- `src/modules/managed-subscriptions`
- `src/modules/rulesets`
- `src/modules/marketplace`
- `src/modules/audit`
- `src/lib/db`
- `src/lib/render`
- `src/lib/token`
- `src/lib/validation`

当前已有的订阅解析逻辑，后续应逐步收束到 `src/lib/render`。

## 13. API 轮廓

V1 推荐 API 分组：

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/me`

- `GET /api/upstream-sources`
- `POST /api/upstream-sources`
- `GET /api/upstream-sources/:id`
- `PATCH /api/upstream-sources/:id`
- `POST /api/upstream-sources/:id/sync`

- `GET /api/templates`
- `POST /api/templates`
- `GET /api/templates/:id`
- `PATCH /api/templates/:id`
- `POST /api/templates/:id/publish`

- `GET /api/subscriptions`
- `POST /api/subscriptions`
- `GET /api/subscriptions/:id`
- `PATCH /api/subscriptions/:id`
- `POST /api/subscriptions/:id/render`
- `POST /api/subscriptions/:id/secret/rotate`
- `POST /api/subscriptions/:id/temp-token`

- `GET /api/marketplace/templates`
- `GET /api/marketplace/rulesets`

- `GET /subscribe/:id`

## 14. 安全要求

- 密码使用 `argon2id`
- access JWT 使用短生命周期
- refresh token 只保存哈希
- 订阅秘钥只保存哈希
- 敏感上游 URL 后续可视情况增加静态加密
- 登录和订阅拉取接口需要限流
- 记录秘钥轮换和异常拉取行为
- 日志中不得打印明文订阅秘钥

当前实现状态：

- 登录、注册、刷新和订阅拉取均已接入本地内存限流
- 长期秘钥轮换、临时令牌创建、登录、资料更新、草稿发布、模板提炼等关键行为会写入 `audit_logs`
- 后端日志默认输出为 JSON 结构化格式，便于后续接入日志采集

### 14.1 SQLite 备份与恢复流程

V1 的推荐流程：

1. 对外先切流或暂停写入请求
2. 备份 `backend/data/proxyparser.sqlite` 及同目录下的 `-wal` / `-shm` 文件
3. 通过只读启动或独立临时环境验证备份文件可正常打开
4. 恢复时优先整体替换数据库文件组，再启动服务进行健康检查

约束：

- 生产环境默认使用 `WAL`，备份时不能只复制主 `.sqlite` 文件
- 若需要在线快照，应在后续引入 SQLite `VACUUM INTO` 或专门备份命令

### 14.2 迁移回滚说明

V1 仍采用“前滚优先”策略。

约定：

- 所有迁移以版本化 `.sql` 文件提交到仓库
- 如果某次迁移有回滚风险，应新增一条更高版本的修正迁移，而不是修改已发布迁移
- 发生线上问题时，优先恢复最近一次数据库备份，再回滚应用版本
- 只有在本地开发环境，才允许手动清库后重新跑全量迁移

## 15. 实现顺序

建议按以下顺序推进：

1. 引入 SQLite、迁移系统和仓储层
2. 加入认证与用户模型
3. 加入上游订阅源存储与同步日志
4. 加入模板存储与版本化
5. 加入托管订阅绑定与渲染快照
6. 加入带秘钥的订阅拉取接口
7. 加入共享和模板市场

这个顺序能保证每一步都是可运行、可观察、可继续扩展的。

## 16. 参考资料

- Mihomo 文档：https://wiki.metacubex.one/en/config/
- MetaCubeX/mihomo：https://github.com/MetaCubeX/mihomo
- Loyalsoldier/clash-rules：https://github.com/Loyalsoldier/clash-rules
- MetaCubeX/meta-rules-dat：https://github.com/MetaCubeX/meta-rules-dat
- blackmatrix7/ios_rule_script：https://github.com/blackmatrix7/ios_rule_script
- ACL4SSR/ACL4SSR：https://github.com/ACL4SSR/ACL4SSR
- Sub-Store：https://github.com/sub-store-org/Sub-Store
