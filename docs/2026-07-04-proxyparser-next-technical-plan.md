# ProxyParser Next 技术方案（可执行版）

日期：2026-07-04
状态：技术实施方案。配套产品设计：`docs/2026-07-04-proxyparser-next-product-design.md`（必读，本文不重复产品论证）。
可行性：本文所有关键机制已于 2026-07-04 在本机实验验证通过（见附录 A）。

---

## 0. 给执行者（Code Agent）的阅读指南

本文是把当前代码库重构为 Next 版本的完整施工图。按里程碑 M1→M5 顺序执行，每个任务给出目标、涉及文件、做法、验收标准。执行时的全局约定：

1. **命令**：根目录 `bun run typecheck`；后端测试 `cd backend && bun test`；前端 `bun run dev:frontend`。后端开发端口避开 `3001` 和 `7001`。
2. **每个任务完成的定义**：typecheck 通过 + 全部测试通过 + 该任务自己的验收标准满足。禁止跳过验收进入下一任务。
3. **不可破坏的基线**：任何时刻 `bun test` 必须全绿。改动渲染逻辑时先补 golden 测试再改。
4. `backend/data/mock-subscriptions/` 含真实节点，禁止提交或打印内容。
5. UI 文案中文；代码、API 字段、数据结构英文。
6. 前端设计工作使用已安装的 `baoyu-design` skill（`~/.claude/skills/baoyu-design`），流程见 §14.1。
7. 本文与产品文档冲突时，以本文为准（本文更新）；发现本文与代码现实冲突时，修正本文并在 git commit 中说明。
8. **离线内置原则**：任何运行时依赖的、需要网络下载才能获得的数据（geodata、内置规则源内容等），仓库内必须携带一份离线副本作为兜底（`backend/assets/`），确保全离线环境下首启即可用。网络获取只用于"更新"，永远不是"可用"的前提。详见 §11.1 与 §8。
9. **无向前兼容约束**（2026-07-04 用户决定）：现有数据全部可丢弃。schema 从零重建（单一全新迁移）、旧拉取 URL 不保留、旧数据转换器取消、旧 draft/快照表直接不建。凡本文早先为兼容而设的路径，一律按"最优方案"简化执行（各节已标注）。

术语对照（本文 → 数据库/代码）：订阅源 → `upstream_sources`；订阅 → `subscriptions`（由 `managed_subscriptions` 演进）；版本 → `releases`；规则库 → `ruleset_catalog` + `ruleset_snapshots`；构建配置 → `BuildConfig`。

---

## 1. 现状基线（2026-07-04 代码事实）

保留的底座：

- Bun 1.3.x + Elysia + `bun:sqlite`（WAL、外键、busy_timeout 已配置）+ js-yaml 4；React 19 + TanStack Router + Radix + Tailwind 4 + lucide。
- 迁移器：`backend/migrations/*.sql` 按文件名序执行，事务包裹，记录于 `_schema_migrations`（`backend/src/lib/db/index.ts`）。新迁移 = 新增 `0007_*.sql` 起的文件。
- 认证体系（argon2id + JWT + refresh token）、审计日志、限流器、结构化日志：全部保留不动。
- 16 个后端集成测试全绿，双端 typecheck 全绿（基线已验证）。

要被替换的三个核心弱点（均已在代码中确认）：

| # | 现状 | 位置 | Next 方案 |
|---|---|---|---|
| W1 | 拉取时同步上游 + 重渲染（每次拉取都做，无 stale 判断），失败才回退快照 | `managed-subscription.service.ts` `deliver()` L453 | 拉取只读已发布 Release（§7） |
| W2 | 草稿操作流按 `targetName` 名字引用、日志式序列 | `draft-operations.ts` | 稳定 ID + 声明式 BuildConfig（§4） |
| W3 | rule-provider 指向可变内容端点 `interval: 86400`，远端更新静默流入 | `rule-provider-render.ts`、05-14 规格 §7 | 内容寻址快照 + 不可变端点（§8） |

前端弱点：向导页 2989 行单文件；无服务端状态库（手写 fetch）；ui 组件仅 10 个基础件；无 toast/popover/command/diff 组件。

---

## 2. 目标架构总览

```text
                    ┌────────────────────────────────────────────────┐
                    │                后台调度器 Scheduler                │
                    │  源同步(默认6h+抖动) / 规则库检查(24h) / GC        │
                    └───────┬───────────────────────┬────────────────┘
                            ▼                       ▼
┌──────────┐  sync   ┌────────────┐  评估    ┌─────────────┐  发布策略  ┌──────────┐
│ 上游订阅  ├────────▶│ 源快照序列  ├────────▶│ 渲染管线 v2  ├──────────▶│ Releases │
└──────────┘         │ +同步报告   │          │ evaluate()  │  校验门禁  │ (不可变)  │
                     └────────────┘          └──────▲──────┘           └────┬─────┘
                                                    │                       │ 只读
┌──────────┐  fetch  ┌────────────┐                │                       ▼
│ 规则源    ├────────▶│ 规则快照    ├── snapshot ref ┤              GET /s/:subId/:token
└──────────┘         │ (sha256)   │                │              GET /rs/:hash.yaml
                     └────────────┘                │
                                     ┌─────────────┴─────────────┐
                                     │  BuildConfig（声明式，草稿+已发布双份） │
                                     │  ← 编辑器工作台 / 模板实例化           │
                                     └───────────────────────────┘
```

核心数据流三条，彼此解耦：

1. **同步流**（后台）：源 URL → 抓取 → 快照 → 结构化 diff → 同步报告 → 触发受影响订阅的重渲染。
2. **构建流**（用户编辑或后台触发）：BuildConfig + 最新成功源快照 + 规则快照 → `evaluate()` → 文档 → 校验（结构 + mihomo -t）→ Release。
3. **交付流**（客户端）：拉取端点直接读 active Release 的 YAML，零计算、零上游请求。

不新建 `/api/v2` 并行接口：前端是唯一消费者，接口原地演进，破坏性变更随里程碑一次性切换。旧拉取 URL 保持兼容（§7.3）。

---

## 3. 数据模型与迁移

原则（按 §0-9 无兼容约束更新）：**删除全部旧迁移文件，合并为一份全新 `0001_schema.sql`**——包含保留表的最终形态（users/认证、upstream_sources 及其快照与同步日志、templates/template_versions、ruleset_catalog、audit_logs、managed_subscriptions 及 share_grants/pull_logs/temp_tokens，均按现列 + 下述新列一次建成，无 ALTER）加下述新表。不建的旧表：`generated_subscription_drafts(_steps)`、`managed_subscription_snapshots`、`user_subscription_secrets`。数据库默认路径更名为 `data/proxyparser.v2.sqlite`，旧库文件自然弃用。下述 3.1–3.3 的分组仅为阅读结构，实际都在 `0001_schema.sql` 内。

### 3.1 订阅核心（原计划 0007）

```sql
-- 订阅扩列：BuildConfig 双份 + 发布指针 + 策略 + 健康
ALTER TABLE managed_subscriptions ADD COLUMN build_config TEXT;          -- 已发布 BuildConfig JSON
ALTER TABLE managed_subscriptions ADD COLUMN draft_build_config TEXT;   -- 草稿 BuildConfig JSON（NULL=无未发布修改）
ALTER TABLE managed_subscriptions ADD COLUMN active_release_id TEXT;
ALTER TABLE managed_subscriptions ADD COLUMN publish_policy TEXT NOT NULL DEFAULT 'auto';  -- auto | confirm
ALTER TABLE managed_subscriptions ADD COLUMN health TEXT NOT NULL DEFAULT 'ok';            -- ok | warn | error
ALTER TABLE managed_subscriptions ADD COLUMN health_reasons TEXT NOT NULL DEFAULT '[]';    -- JSON string[]

-- 多源支持：源引用移入 BuildConfig.sources，旧列 upstream_source_id 保留但不再是权威（转换器填充 BuildConfig）

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES managed_subscriptions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,                        -- 订阅内自增序号，展示为 v1, v2…
  build_config TEXT NOT NULL,                  -- 冻结的 BuildConfig JSON
  source_snapshot_ids TEXT NOT NULL,           -- JSON: {sourceId: snapshotId}
  rendered_yaml TEXT NOT NULL,
  rendered_hash TEXT NOT NULL,                 -- sha256(rendered_yaml)
  diff_summary TEXT NOT NULL DEFAULT '{}',     -- JSON，见 §6.3
  trigger TEXT NOT NULL,                       -- manual | upstream_sync | ruleset_update | rollback
  trigger_detail TEXT,                         -- 人类可读补充（哪个源/哪个规则源）
  validation TEXT NOT NULL DEFAULT '{}',       -- JSON: {structural: {...}, mihomo: {available, exitCode, output}}
  created_by TEXT,                             -- user id 或 'system'
  created_at TEXT NOT NULL,
  UNIQUE (subscription_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_releases_sub ON releases(subscription_id, seq DESC);

CREATE TABLE IF NOT EXISTS subscription_tokens (        -- 按订阅独立长期 token
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES managed_subscriptions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,             -- sha256(token)，明文只在创建时返回一次
  label TEXT,
  created_at TEXT NOT NULL,
  rotated_from_id TEXT,
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS subscription_issues (        -- 待处理问题
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES managed_subscriptions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,        -- dangling-node-ref | dangling-group-ref | unclassified-nodes |
                             -- name-collision | render-error | validation-error | legacy-unconverted
  refs TEXT NOT NULL DEFAULT '{}',   -- JSON 定位信息（groupName/nodeId/rule 等）
  message TEXT NOT NULL,             -- 中文描述
  suggestion TEXT,                   -- JSON 一键修复建议（对 BuildConfig 的 patch），可空
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_issues_sub ON subscription_issues(subscription_id, resolved_at);

CREATE TABLE IF NOT EXISTS events (                     -- 工作台事件流
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL,     -- source | subscription | ruleset
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- source.synced | source.sync_failed | release.published |
                                 -- release.blocked | ruleset.update_available | subscription.degraded
  payload TEXT NOT NULL DEFAULT '{}',   -- JSON（同步报告摘要、release seq、diff 概要等）
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS custom_node_secrets (        -- 自建节点敏感字段，AES-256-GCM
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext BLOB NOT NULL,      -- iv(12) || tag(16) || data
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 3.2 规则快照（原计划 0008）

```sql
CREATE TABLE IF NOT EXISTS ruleset_snapshots (
  hash TEXT PRIMARY KEY,                        -- sha256(content) hex
  catalog_id TEXT NOT NULL REFERENCES ruleset_catalog(id),
  content TEXT NOT NULL,                        -- 规范化后的 YAML payload
  behavior TEXT NOT NULL,                       -- domain | ipcidr | classical
  entry_count INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 1          -- 私有粘贴内容=0，不经 /rs/ 提供
);
CREATE INDEX IF NOT EXISTS idx_ruleset_snapshots_catalog ON ruleset_snapshots(catalog_id, fetched_at DESC);

-- ruleset_catalog 扩列：最新已知快照与更新徽章
ALTER TABLE ruleset_catalog ADD COLUMN latest_snapshot_hash TEXT;
ALTER TABLE ruleset_catalog ADD COLUMN update_available INTEGER NOT NULL DEFAULT 0;
```

### 3.3 调度（原计划 0009）

```sql
ALTER TABLE upstream_sources ADD COLUMN sync_interval_minutes INTEGER NOT NULL DEFAULT 360;
ALTER TABLE upstream_sources ADD COLUMN next_sync_at TEXT;

CREATE TABLE IF NOT EXISTS source_sync_reports (
  id TEXT PRIMARY KEY,
  upstream_source_id TEXT NOT NULL REFERENCES upstream_sources(id) ON DELETE CASCADE,
  from_snapshot_id TEXT,
  to_snapshot_id TEXT NOT NULL,
  nodes_added TEXT NOT NULL DEFAULT '[]',       -- JSON: [{id,name}]
  nodes_removed TEXT NOT NULL DEFAULT '[]',
  nodes_renamed TEXT NOT NULL DEFAULT '[]',     -- JSON: [{id,from,to}]
  nodes_updated TEXT NOT NULL DEFAULT '[]',     -- 同 ID 字段变化（凭据轮换等）
  created_at TEXT NOT NULL
);
```

### 3.4 旧表处置（已按无兼容约束简化）

无任何转换或过渡期：旧迁移与旧表一律不建；`templates.payload` 直接使用 TemplatePayloadV2；短期分享 token 沿用 `subscription_temp_tokens` 表设计（随新 schema 一次建成）；账号级长期 key 概念删除，只有按订阅 token。

---

## 4. 核心类型与算法

新增文件 `backend/src/lib/build-config/types.ts`（前端通过复制或共享包同步一份，见 M1 任务）。以下为权威定义（截取核心，执行时按此实现完整 zod/手写校验器）：

```typescript
export type BuildMode = "rebuild" | "patch";
export type BuiltinPolicy = "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS" | "COMPATIBLE";

export interface BuildConfig {
  version: 1;                          // schema 版本，未来演进用
  mode: BuildMode;
  sources: SourceRef[];                // patch 模式恰好 1 个；rebuild 模式 1..n
  nodes: NodesSection;
  groups: GroupsSection;               // patch 模式下仅 append 生效
  rules: RulesSection;
  config: ConfigSection;
}

export interface SourceRef { sourceId: string; enabled: boolean; }

// ---------- 节点 ----------
export interface NodesSection {
  transforms: NodeTransform[];         // 持续生效管道，按序应用于所有原生节点（现在与未来）
  overrides: NodeOverride[];           // 按稳定 ID 钉住的单点操作
  custom: CustomNode[];
}
export type NodeTransform =
  | { kind: "strip-emoji" }
  | { kind: "strip-multiplier" }                          // 去 “x2 / 2倍率” 类标签
  | { kind: "regex-replace"; from: string; to: string; flags?: string }
  | { kind: "trim-whitespace" };
export interface NodeOverride {
  nodeId: string;                      // 原生节点稳定 ID
  rename?: string;                     // 在 transforms 之后应用
  disabled?: boolean;
  tags?: string[];                     // 用户手动标签（含采纳的地区推断）
}
export interface CustomNode {
  id: string;                          // cn_ 前缀，创建时生成，永不变
  name: string;
  type: string;                        // ss / vmess / trojan / hysteria2 / ...
  server: string;
  port: number;
  secretRef: string | null;            // custom_node_secrets.id；敏感字段不入 BuildConfig
  extra: Record<string, unknown>;      // 其余非敏感字段
  tags?: string[];
}

// ---------- 代理组 ----------
export interface GroupsSection {
  generators: GroupGenerator[];
  custom: CustomGroup[];
  order: string[];                     // 输出顺序：generator 产物名与 custom 组名混排
}
export type GroupGenerator =
  | { kind: "proxies-root"; name: string; includeAuto: boolean; extraMembers: GroupMember[] }
  | { kind: "region-groups"; groupType: "select" | "url-test"; unclassified: "others" | "ignore";
      regionOverrides?: Record<string, string> }          // nodeId -> region code 手动纠正
  | { kind: "auto-group"; name: string; selector: NodeSelector };
export interface CustomGroup {
  name: string;
  type: "select" | "url-test" | "fallback" | "load-balance";
  members: GroupMember[];
  options?: Record<string, unknown>;   // url/interval/tolerance 等
}
export type GroupMember =
  | { kind: "node"; nodeId: string }                      // 原生或自建节点稳定 ID（原生引用⇒模板不可携带）
  | { kind: "group"; name: string }
  | { kind: "selector"; selector: NodeSelector }          // 抽象集合，可进模板
  | { kind: "builtin"; policy: BuiltinPolicy };
export type NodeSelector =
  | { kind: "all-enabled" }
  | { kind: "region"; region: string }
  | { kind: "tag"; tag: string }
  | { kind: "protocol"; protocol: string }
  | { kind: "custom-only" };

// ---------- 规则 ----------
export interface RulesSection {
  targets: RuleTargetBlock[];          // 面向目标组织
  order: string[];                     // 块级输出顺序（目标名列表）；prelude 恒在最前
  prelude: RuleEntry[];                // 前置规则（如 PROCESS-NAME 特判）
  final: { target: string };           // MATCH 落点，恒在最后
}
export interface RuleTargetBlock {
  target: string;                      // 已知组名或 BuiltinPolicy
  items: RuleItem[];
}
export type RuleItem =
  | { kind: "snapshot"; catalogId: string; hash: string;  // 钉死的规则快照
      emit: "provider" | "inline" }
  | { kind: "manual"; entries: RuleEntry[] };
export interface RuleEntry { type: RuleType; value: string; extra?: string }  // extra: no-resolve 等
export type RuleType = "DOMAIN" | "DOMAIN-SUFFIX" | "DOMAIN-KEYWORD" | "IP-CIDR" | "IP-CIDR6"
  | "GEOIP" | "GEOSITE" | "PROCESS-NAME" | "SRC-IP-CIDR" | "DST-PORT";

// ---------- 配置 ----------
export interface ConfigSection {
  structured: {                        // 结构化表单字段（白名单键）
    ports?: { mixedPort?: number; port?: number; socksPort?: number };
    mode?: "rule" | "global" | "direct";
    dns?: Record<string, unknown>;
    tun?: Record<string, unknown>;
    sniffer?: Record<string, unknown>;
    logLevel?: string;
  };
  rawPatch: string | null;             // YAML 文本，深合并于 structured 之上；发布前校验
}
```

### 4.1 原生节点稳定 ID 算法

新增 `backend/src/lib/build-config/node-identity.ts`：

```text
identity = `${type}|${server}|${port}`
nodeId   = "n_" + sha256(identity).hex[0:12]
同一快照内 identity 冲突（罕见）：按名称排序后追加 "#0"、"#1" 再散列。
```

语义与推论（写入代码注释与用户文档）：

- 改名、换凭据（uuid/password 轮换）→ ID 不变 → 引用稳固、同步报告归类为 renamed/updated。
- 机场更换服务器域名/端口 → ID 变化 → 视为删除+新增 → ID 级引用进入待处理问题，selector 引用自动吸收。这是可解释的正确行为。

### 4.2 规范化 YAML emitter

新增 `backend/src/lib/render/emit-yaml.ts`。实验证实 js-yaml 对同一对象输出字节稳定，但键插入顺序影响输出，因此 emitter 负责**规范化构造**：

- 顶层键序固定表：`mixed-port, port, socks-port, mode, log-level, ipv6, dns, tun, sniffer, proxies, proxy-groups, rule-providers, rules`，未列出的键按字典序插在 rules 之前。
- proxy 键序：`name, type, server, port`，其余字典序；group 键序：`name, type`，其余字典序，`proxies` 恒最后。
- dump 参数：`{ noRefs: true, lineWidth: -1, sortKeys: false }`（`lineWidth: -1` 禁止长行折叠——折行会破坏字节确定性，实验已验证长字符串、中文、emoji、冒号、前导零往返无损）。
- 导出 `emitClashYaml(doc): string` 为**唯一**的 YAML 出口，全仓库禁止直接调用 `yaml.dump` 输出配置（golden 测试锁定）。

---

## 5. 渲染管线 v2

新增 `backend/src/lib/render-v2/`，替代 `render/`（旧目录在 M2 结束后删除）。纯函数、无 IO：

```typescript
// evaluate.ts
export interface EvaluateInput {
  buildConfig: BuildConfig;
  sourceSnapshots: Map<string, ClashProxyDocument>;   // sourceId -> 已解析快照
  rulesetSnapshots: Map<string, RulesetSnapshot>;     // hash -> 快照（content+behavior）
  customNodeSecrets: Map<string, Record<string, unknown>>;  // secretRef -> 解密后的敏感字段
  publicBaseUrl: string;                              // 生成 /rs/ 提供者 URL 用
}
export interface EvaluateResult {
  document: ClashProxyDocument;
  yamlText: string;                    // 经 emitClashYaml
  issues: Issue[];                     // 结构化问题（不抛异常，除非致命）
  stats: { nodeCount: number; groupCount: number; ruleCount: number; providerCount: number };
  nodeIndex: Array<{ id: string; renderedName: string; sourceId: string | null }>;
}
export function evaluate(input: EvaluateInput): EvaluateResult;
```

求值阶段（固定顺序，每阶段一个文件）：

1. **collect-nodes**：合并各启用源的 proxies → 计算稳定 ID → 应用 transforms（顺序执行）→ 应用 overrides（rename/disabled）→ 追加 custom 节点（合入解密字段）→ 输出名冲突时后出现者加源名前缀并记 `name-collision` issue。产出 `NodePool`（id → 渲染名 + 文档 + 标签 + 推断地区）。
2. **generate-groups**：按 generators 求值（region-groups 用推断地区 + `regionOverrides`；命名固定 `HK/TW/JP/US/SG/KR/Others`，检测正则表复用现有 `auto-groups.ts` 的成熟正则）→ 组装 custom groups（selector 展开为当前渲染名列表；node ref 查 NodePool，失效则记 `dangling-node-ref` issue 并跳过该成员）→ 按 `order` 排序输出。
3. **assemble-rules**：按 `rules.order` 遍历 target blocks；`snapshot+provider` 产出 `rule-providers.<slug>`（`type: http, url: {base}/rs/{hash}.yaml, format: yaml, behavior: <b>`，**不设 interval**）+ `RULE-SET,<slug>,<target>`；`snapshot+inline` 与 manual 展开为规则行；目标不存在 → 整块记 `dangling-group-ref` issue 并跳过；`prelude` 置顶、`final` 兜底 MATCH。
4. **apply-config**：structured 白名单字段 → 文档；rawPatch 解析后深合并（数组替换不合并）；`proxies/proxy-groups/rules/rule-providers` 四个键禁止被 rawPatch 触碰（校验拒绝）。
5. **patch 模式支路**：以源文档为基底，仅执行 custom 节点注入、组 append、规则 prepend/append、config patch；名字引用按源文档校验。
6. **validate-structural**：唯一名、成员/目标存在性、RULE-SET↔provider 匹配、behavior 匹配、MATCH 存在且最后。产出 issues（error 级阻断发布，warn 级不阻断）。
7. **emit**：`emitClashYaml`。

确定性契约（golden 测试锁定）：相同 `EvaluateInput` → 字节相同 `yamlText`。禁止在管线内取时间、随机数、Map 无序遍历（遍历前显式排序）。

---

## 6. 发布管线

新增 `backend/src/modules/releases/release.service.ts`。

### 6.1 发布流程

```text
publish(subscriptionId, {trigger, actor}):
  1. cfg = draft_build_config ?? build_config
  2. snapshots = 各源最新成功快照（任一源从未成功 → 拒绝并说明）
  3. result = evaluate(...)
  4. error 级 issues 存在 → 写 subscription_issues + health=warn/error + 事件 release.blocked，返回失败详情
  5. mihomo -t 门禁（§11；二进制不可用则跳过并在 validation 里标注）
  6. diffSummary = diff(active release 文档, 新文档)（§6.3）
  7. 事务：插入 releases(seq+1) → build_config=cfg, draft_build_config=NULL,
     active_release_id=新id → 写事件 release.published → 刷新 health
```

回滚 `rollback(subscriptionId, releaseId)`：取历史 release 冻结的 build_config 与 rendered_yaml，直接作为新 release 插入（trigger=rollback，不重渲染——历史产物本身不可变可信）。

### 6.2 上游同步触发（调度器回调）

```text
onSourceSynced(sourceId, report):
  for sub in 使用该源的订阅:
    r = evaluate(当前已发布 build_config, 新快照)
    if r.yamlText 与 active release 相同 → 跳过
    if publish_policy == 'auto' and 无 error issues → publish(trigger=upstream_sync)
    else → draft 不动，写事件 + 待发布标记（前端据此显示"有未吸收的上游变化"）
  失败/阻断 → health=warn，事件 subscription.degraded
```

### 6.3 diff 摘要（`release-diff.ts`）

结构化对比两个文档：节点（按稳定 ID：added/removed/renamed/updated）、组（按名：added/removed/membersChanged）、规则（按 target 块：条数变化）、config 顶层键变更列表。存入 `releases.diff_summary`，前端直接渲染，不在前端重算。完整行级 diff 由前端用 `diff` 包对两个 YAML 现算（按需，不落库）。

### 6.4 健康状态机

```text
error: 无 active_release_id，或最近一次 publish 因 error issues/校验失败被阻断
warn : 任一源 last_successful_sync 距今 > 2×sync_interval；或存在未解决 error 级 issue；
       或最近 upstream_sync 触发的发布被阻断
ok   : 其余
```

`refreshHealth(subscriptionId)` 在同步、发布、issue 变更后调用，落库 `health` + `health_reasons`（中文原因数组）。

---

## 7. 交付与访问

### 7.1 新拉取端点

```text
GET /s/:subscriptionId/:token
  token 查 subscription_tokens（sha256 比对，未撤销）→ 读 active release →
  200 text/yaml + subscription-userinfo(最近缓存) + content-disposition: attachment; filename*=UTF-8''<订阅名>.yaml
  + profile-update-interval: 24
  无 active release → 503 明确文案。全程零上游请求、零渲染。写 pull log（复用现有表，异步）。
```

### 7.2 短期分享

沿用 `user_subscription_temp_tokens`（已支持 TTL、撤销、列表），URL 形如 `/s/:subId/t/:tempToken`。

### 7.3 旧 URL（已删除）

无兼容约束：`GET /subscribe/:id` 端点直接移除，唯一拉取入口为 §7.1/§7.2 的新端点。

### 7.4 规则快照端点

```text
GET /rs/:hash.yaml   → ruleset_snapshots WHERE hash=? AND is_public=1
  200 text/yaml + cache-control: public, max-age=31536000, immutable
  不存在或私有 → 404。无鉴权（内容本身来自公开规则源）。限流复用现有 rateLimiter。
```

---

## 8. 规则库子系统

- **导入到订阅**：用户在编辑器选规则源 → 后端确保有最新快照（无则即时 fetch 并落 `ruleset_snapshots`）→ BuildConfig 写入 `{catalogId, hash, emit}`。默认 `emit: provider`；条目数 < 50 或私有内容默认 `inline`。
- **更新检查**（调度器 24h）：fetch → 规范化 → hash 与 `latest_snapshot_hash` 不同 → 存新快照、置 `update_available=1`、写事件 `ruleset.update_available`。**绝不**自动改任何 BuildConfig。
- **应用更新**：前端"查看差异"（两快照内容 diff + 条数统计）→ 用户确认 → 后端把指定订阅（可多选）BuildConfig 中该 catalogId 的 hash 替换为新值 → 各订阅走正常发布流程。
- **粘贴规则**：解析为 `RuleEntry[]`（解析器复用/迁移现有 `proxy-rules.ts` 能力）；解析报告（去重 N 条、修正空格 M 条、无法解析 K 行原文列出）作为 API 响应返回，前端确认后才保存——对应产品文档"规范化确认"。
- **快照 GC**：删除不被任何 BuildConfig / release 引用且非 latest 的快照（调度器周任务）。
- **内置离线快照**（离线内置原则）：四个内置规则源的初始内容以 YAML 文件形式提交在 `backend/assets/rulesets/<slug>.yaml`；首次启动 seed 时直接从文件落 `ruleset_snapshots`（hash 现算），使规则导入、官方推荐方案、黄金路径在**全离线环境**下开箱即用。后台同步只负责其后的更新徽章，不是可用性前提。`scripts/fetch-rulesets.ts` 供更新仓库内副本。

## 9. 后台调度器

新增 `backend/src/lib/scheduler/`。单进程内 60s tick（`setInterval`），启动时立即 tick 一次：

- 到期判定读表（`next_sync_at`、ruleset `fetched_at+24h`），不在内存排队 → 进程重启无损。
- 执行前用 `UPDATE ... SET status='syncing' WHERE status != 'syncing'` 乐观锁防并发重入；单次 tick 上限（如 5 个源）+ ±10% 抖动写回 `next_sync_at`，避免整点齐发。
- 源同步成功 → 生成 `source_sync_reports`（节点按稳定 ID 对比）→ 写事件 → 调 `onSourceSynced`。
- 所有任务 try/catch 全隔离，单任务失败只记日志与事件，绝不影响 tick 循环。
- 测试模式（`NODE_ENV=test`）不启动定时器，暴露 `runTickOnce()` 供集成测试显式驱动。

## 10. 规则追踪器

新增 `backend/src/lib/trace/rule-tracer.ts` + `POST /api/subscriptions/:id/trace`（body: `{query: string, draft: boolean}`）：

- 对 evaluate 产物顺序匹配：DOMAIN（精确）、DOMAIN-SUFFIX、DOMAIN-KEYWORD、IP-CIDR/IP-CIDR6（解析 CIDR）、RULE-SET（展开我们自己的快照内容逐条匹配）、MATCH。
- **GEOSITE/GEOIP 如实降级**：返回 `verdict: "maybe"`，文案"命中与否取决于客户端 geodata"。v1 不解析 geodata（记为后续增强）。
- 响应：`{matched: {ruleText, blockTarget, index}, groupChain: [...], verdict: "hit"|"maybe"|"final"}`。

## 11. mihomo 校验门禁

新增 `backend/src/lib/validate/mihomo-gate.ts`：

- 二进制解析顺序：env `PROXYPARSER_MIHOMO_PATH` → `backend/data/bin/mihomo` → `$PATH`。都没有 → `{available: false}`，发布仅结构校验并在 validation 与实例健康页标注"内核校验未启用"。
- 执行：写临时文件 → `mihomo -t -f <file> -d <emptyDir>`（空工作目录避免读取宿主 geodata 配置）→ 5s 超时 → 记录 exitCode 与末行输出。实验实测：合法配置 exit 0，悬空引用 exit 1 且错误信息精确（`rules[1] [MATCH,X] error: proxy not found`），耗时毫秒级。
- 提供 `scripts/fetch-mihomo.ts`：按平台从 GitHub Releases 下载解压到 `backend/data/bin/`（deploy 文档与 Dockerfile 同步引用；Docker 镜像在**构建期**内置二进制）。二进制缺失时的降级路径（仅结构校验）本身就是内置兜底。

### 11.1 内置离线 geodata（已实验固化）

实验结论（2026-07-04，附录 A-6）：`-d` 目录含 `geosite.dat`(4.0MB) + `country.mmdb`(7.7MB) 时，含 GEOSITE/GEOIP 的配置校验 **139ms、零网络请求**；`-d` 为空目录时 mihomo **静默联网下载 MMDB**（实测 8.7s，离线环境即失败）。因此：

- 仓库提交 `backend/assets/geodata/geosite.dat` 与 `backend/assets/geodata/country.mmdb`（来源：MetaCubeX/meta-rules-dat releases，合计约 12MB）。
- 校验门禁的 `-d` 恒指向 `backend/assets/geodata/` 的副本目录，**永不**指向空目录。
- 校验只需要 geodata "能加载"，不需要最新——离线副本过期无碍；`scripts/fetch-geodata.ts` 供手动/构建期更新。

## 12. 旧数据转换器（已取消）

按 §0-9 无兼容约束：本节整体取消。不写转换器、不保留旧拉取行为、旧库文件（`data/proxyparser.sqlite`）弃用不读。风险 R5 随之消除。以下映射表仅作历史记录保留：

| 旧数据 | 转换 |
|---|---|
| `managed_subscriptions.template_id` 模式 | TemplatePayload → BuildConfig：`rules/groups/config` 的 patch/full_override → `mode` 与对应 section；`customProxies` → `nodes.custom`（敏感字段抽入 `custom_node_secrets`）；`ruleProviderAttachments` → 各 target 的 `snapshot` item（hash 取该 catalog 当前缓存内容散列，即时落 `ruleset_snapshots`）；`autoGroup` → `region-groups`+`proxies-root` generators |
| draft 模式的步骤操作流 | 逐步骤折算：proxies add→`nodes.custom`；patch/replace/remove 按 targetName 在最近成功源快照中解析稳定 ID → `overrides`；解析不到 → `legacy-unconverted` issue（原始操作 JSON 存入 refs）|
| groups 操作 | add/replace→`groups.custom`（成员名解析为 node ref/group ref/builtin；解析失败记 issue）；remove→从 order 剔除 |
| raw 模式步骤 | 整段折算为 `full_override` 等价物；无法结构化的整体放入 `config.rawPatch` 并记 warn issue |
| 最近成功渲染快照 | 折算为该订阅 Release v1（trigger=manual, created_by=system, diff 为空基线）+ 创建首个 subscription token |
| 账号长 key | 保留可用；事件流提示"建议迁移到按订阅 token" |

验收：转换后每个订阅 `GET /s/...` 返回与转换前 `/subscribe/...` 语义等价的 YAML（节点集、组结构、规则集一致；键序与格式可不同——用结构化对比脚本验证，不比字节）。

## 13. 模板 v2

- `TemplatePayloadV2 = BuildConfig` 去掉 `sources`、去掉 `kind:"node"` 的原生 ID 成员、`custom` 节点的 `secretRef` 置为 `{placeholder: true}`。
- **提炼** `extractTemplate(buildConfig)`：过滤 + 生成报告 `{recorded: [...], dropped: [{reason, detail}]}`（对应产品文档 §9.5 模板报告）。纯函数，30 行内可测。
- **应用** `instantiateTemplate(payload, sourceIds, placeholderFills)`：回填 sources 与自建节点凭据（写入 `custom_node_secrets` 后引用）→ 得到新订阅的 BuildConfig。
- 往返测试：`extract(instantiate(extract(x))) == extract(x)`（收敛性）。
- 官方"推荐方案"模板以 seed 形式维护于 `backend/src/lib/db/seed-builtin-templates.ts`（替换现有 seed 内容为 V2 payload）。**约束**：推荐方案只允许引用内置规则源（其离线快照随仓库分发，§8），保证黄金路径全离线可用。

## 14. 前端技术方案

### 14.1 设计先行（使用 baoyu-design skill）

M4 开工前，先用已安装的 `baoyu-design` skill 完成设计（产出全部落在仓库 `designs/proxyparser-next/`）：

1. 按 skill 的 design-system-authoring 流程，把现有视觉基因（高密度控制台、Radix + Tailwind 4、中文文案）沉淀为一个可复用 design system（tokens：色板/字号/间距/状态色 + 核心组件样例），供后续所有页面设计绑定。
2. 出 6 张关键屏的 hi-fi HTML 原型：工作台、订阅列表、订阅工作台（含右侧诊断栏）、3 步创建向导、规则编辑器（目标块 + 追踪器）、版本历史（diff 视图）。
3. 原型确认后（用户过目）才进入组件实现；实现以原型为视觉规格，禁止边写边设计。

### 14.2 技术栈增量

- 新增依赖（2026-07-04 选型定稿，理由见 §14.5）：`@tanstack/react-query`（服务端状态；`lib/api.ts` 保留为 fetch 封装）、`@tanstack/react-table`（headless 表格逻辑：节点/规则大表的筛选、排序、多选）、`sonner`（Toast）、`cmdk`（Command 面板）、`diff`（YAML 行级 diff）、`qrcode`（订阅链接二维码）、`class-variance-authority`（组件变体）、`@radix-ui/react-popover`、`@radix-ui/react-switch`、`@radix-ui/react-radio-group`、`@radix-ui/react-dropdown-menu`（已有）等 Radix 原语按需补齐。
- 路由级代码分割（TanStack Router lazy routes），消灭 500kB warning（现存已知问题）。
- `frontend/src/lib/types.ts` 与后端 BuildConfig 类型保持同构：M1 起后端类型文件为唯一权威，前端复制文件 + 头部注释声明"生成自 backend，勿手改"，根 package.json 加 `sync-types` 脚本（cp 命令）。

### 14.5 图标与组件库选型（2026-07-04 定稿）

- **图标：lucide-react 为唯一图标源**。1.5px 描边风格契合高密度控制台的精确感，覆盖面最全且已是依赖。评估并排除：Radix Icons（15px 网格、数量不足）、Phosphor（圆润风格与设计方向不符）、Tabler（无增量价值，纯迁移成本）。原型中的文字符号在实现时映射为 lucide 等价物（⠿→GripVertical、↥→ArrowUpToLine、⟳→RefreshCw、健康灯保持纯 CSS 圆点）。
- **组件：shadcn/ui 模式（vendored，非运行时依赖）**。以 Radix 原语 + CVA + tailwind-merge 在 `components/ui/` 内自建组件库（现有 clsx/tailwind-merge/Radix 正是该模式底座），全部按 `designs/proxyparser-next/styles.css` 的 oklch 令牌蒙皮。**明确不引入** AntD / Mantine / Chakra / Radix Themes 等整装组件库——与自有设计令牌冲突。
- 专项：Toast 用 sonner；命令面板 cmdk；大表格逻辑 @tanstack/react-table（headless）；YAML diff 用 diff 包；二维码 qrcode 包。长列表如遇性能问题允许引入 @tanstack/react-virtual（按需）。

### 14.3 路由与页面结构

```text
/login /register                      （现有，微调）
/                                     工作台：健康卡片 + 事件流 + 待处理聚合
/subscriptions                        订阅列表
/subscriptions/new                    3 步创建向导（独立轻页面，非编辑器复用）
/subscriptions/:id                    订阅工作台（布局：左 Tab 导航 + 主区 + 右诊断栏）
  ├ overview / nodes / groups / rules / config / releases / access / issues （子路由）
/sources /sources/:id                 订阅源列表与详情（详情含快照历史、同步报告）
/rulesets                             规则库（更新徽章、diff、应用更新）
/templates /templates/:id             模板（提炼报告、应用向导）
/settings                             账号、token 总览、实例健康、备份
```

组件拆分红线：单文件 ≤ 400 行；订阅工作台每个 Tab 一个目录；现有 2989 行向导页整体废弃重写。

### 14.4 关键前端组件（新建于 `components/`）

`health-dot`、`event-feed`、`diff-view`（结构化摘要 + 可展开行级 diff）、`confirm-dialog`（统一"系统将做 N 件事"确认，接后端解析/规范化报告）、`rule-target-board`（目标块编辑）、`rule-tracer-panel`、`node-table`（transforms/overrides 徽章）、`member-picker`（组成员选择：节点/组/selector/builtin 四类带说明）、`release-timeline`、`token-panel`、`qr-code`（订阅链接二维码，纯前端生成，用无依赖的小实现或 `qrcode` 包）。

## 15. API 总表（增量）

```text
-- 订阅（原 managed-subscriptions 路由演进）
GET    /api/subscriptions                       列表（含 health、activeRelease 摘要）
POST   /api/subscriptions                       创建（body: 名称+sources+起点[template|recommended|patch|blank]）
GET    /api/subscriptions/:id                   详情（build_config、draft、health、issues 计数）
PUT    /api/subscriptions/:id/draft             整份保存 draft BuildConfig（后端校验 schema）
POST   /api/subscriptions/:id/draft/preview     evaluate(draft) → yaml + issues + stats（不落库）
POST   /api/subscriptions/:id/publish           发布（§6.1）；409 返回阻断 issues
POST   /api/subscriptions/:id/rollback          body: {releaseId}
GET    /api/subscriptions/:id/releases          版本列表（diff_summary 内联）
GET    /api/subscriptions/:id/releases/:rid     单版本（含 yaml，支持 ?compare=<rid2>）
POST   /api/subscriptions/:id/trace             规则追踪（§10）
GET    /api/subscriptions/:id/issues            未解决问题列表
POST   /api/subscriptions/:id/issues/:iid/apply 应用建议修复（patch draft，返回新 draft）
POST   /api/subscriptions/:id/tokens            创建/轮换 token（响应含明文一次）
DELETE /api/subscriptions/:id/tokens/:tokenId   撤销
-- 规则库
POST   /api/rulesets/:catalogId/refresh         手动检查更新
GET    /api/rulesets/:catalogId/snapshots/:hash/diff?against=<hash2>
POST   /api/rulesets/parse                      粘贴规则解析（返回规范化报告，不落库）
POST   /api/rulesets/apply-update               body: {catalogId, hash, subscriptionIds[]}
-- 事件与工作台
GET    /api/events?limit=50                     事件流
-- 模板
POST   /api/templates/extract                   body: {subscriptionId} → payload + 报告（预览）
POST   /api/templates/:id/instantiate           body: {sourceIds, fills} → 新订阅
-- 公开
GET    /s/:subId/:token   GET /s/:subId/t/:temp GET /rs/:hash.yaml   （§7）
```

删除的旧接口：draft 步骤相关（`/api/generated-subscription-drafts/*`）随 M4 前端切换后下线。

---

## 16. 里程碑与任务分解

每个任务 = 一次可独立验收的 PR 粒度。标注 ⚑ 的是该里程碑验收演示点。

### M1 — 模型地基（后端，无 UI 变化）

| # | 任务 | 要点 | 验收 |
|---|---|---|---|
| 1.1 | BuildConfig 类型 + 校验器 | `lib/build-config/{types,validate}.ts`；手写校验（不引 zod，保持零依赖风格）| 非法样例各返回中文错误；单测覆盖每个 section |
| 1.2 | 稳定 ID | `node-identity.ts` §4.1 | 单测：改名/换凭据 ID 不变；换 server ID 变；冲突去重确定性 |
| 1.3 | 规范化 emitter | `render/emit-yaml.ts` §4.2 | golden 测试：固定输入 → 锁定字节输出（含中文/emoji 样例）|
| 1.4 | 渲染管线 v2 | `render-v2/` 七阶段 §5；region 正则迁移自 `auto-groups.ts` | 集成测试：mock 源快照 + 完整 BuildConfig → 校验产物结构；同输入双跑字节一致 ⚑ |
| 1.5 | 全新 schema | 删除旧迁移，写 `0001_schema.sql`（§3 全部 DDL 一次建成）；DB 路径更名 v2；seeds 重写 | 新库初始化成功；旧库文件不被读取 |
| 1.6 | ~~转换器~~ | 已取消（§12，无兼容约束） | — |
| 1.7 | secrets 加密 | `lib/security/secret-box.ts`（AES-256-GCM，key 来自 env 或首启生成于 data 目录）| 单测往返；key 缺失时启动报错文案清晰 |

### M2 — 发布管线与交付

| # | 任务 | 要点 | 验收 |
|---|---|---|---|
| 2.1 | releases 服务 | §6.1/6.3/6.4 | 集成测试：publish→再 publish→rollback，seq 与 active 指针正确 |
| 2.2 | mihomo 门禁 + 离线资产 | §11/§11.1 + `scripts/fetch-mihomo.ts`/`fetch-geodata.ts`/`fetch-rulesets.ts`；提交 `backend/assets/{geodata,rulesets}` 离线副本 | 有二进制：坏配置发布被 409 阻断且错误透出 ⚑；无二进制：降级标注；**断网环境**下含 GEOSITE 配置校验通过且内置规则源可导入 ⚑ |
| 2.3 | 新拉取端点 | §7.1-7.2；旧 `/subscribe` 端点整体删除 | 集成测试：拉取零上游请求（mock fetch 断言不被调用）⚑ |
| 2.4 | 调度器 | §9 | 测试用 `runTickOnce()`：到期源被同步、报告生成、auto 策略产出新 release ⚑ |
| 2.5 | 同步报告 | §3.3 表 + 稳定 ID diff | 单测：增/删/改名/换凭据四类正确分类 |
| 2.6 | 健康与事件 | `refreshHealth` + events 写入 | 集成测试：源同步失败→health=warn→恢复→ok |
| 2.7 | deliver() 旧逻辑删除 | 移除同步-渲染路径与 `render/` 旧目录 | 全测试绿；`grep -r "yaml.dump" backend/src` 仅 emit-yaml.ts 一处 |

### M3 — 规则体系

3.1 `ruleset_snapshots` 存取 + `/rs/:hash.yaml`（immutable 头，公开性判定）；3.2 更新检查调度任务 + `update_available` + 事件；3.3 diff 与 apply-update API（含多订阅批量）；3.4 粘贴解析 API（迁移 `proxy-rules.ts` 解析能力，输出规范化报告）；3.5 规则追踪器 §10。
⚑ 验收演示：导入规则源 → 发布 → 上游规则变化 → 徽章出现 → 看 diff → 应用到订阅 → 新 release；追踪 `chat.openai.com` 正确返回命中链。

### M4 — 前端重构（依赖 M1-M3 的 API）

4.0 baoyu-design 设计流程 §14.1——六张关键屏 hi-fi 原型**已于 2026-07-04 产出**在 `designs/proxyparser-next/`（index.html 为总览，styles.css 为设计令牌）；M4.0 剩余工作 = 用户确认与迭代 + 按 baoyu-design authoring 流程把 tokens 沉淀为正式 design system + 补齐未覆盖屏（代理组/配置/访问/规则库/模板/设置）；4.1 依赖与基建（react-query、路由分割、类型同步脚本、ui 组件补齐）；4.2 工作台页；4.3 订阅列表 + 3 步创建向导（含官方推荐方案起点、发布后二维码/链接/导入指引）；4.4 订阅工作台 8 个 Tab + 右侧诊断栏（预览/diff/追踪器/问题）；4.5 源与规则库页面（同步报告、更新 diff 流）；4.6 版本历史与回滚 UI；4.7 访问管理（token 轮换、短期链接、拉取日志）；4.8 删除旧向导页与旧 draft API。
⚑ 验收演示：浏览器端到端走通产品文档 §10 成功标准 1-4 的全部动作；`bun run build` 无 chunk warning。

### M5 — 模板与打磨

5.1 模板 v2 提炼/应用 + 报告 UI + 往返测试；5.2 官方推荐方案 seed 重写为 V2；5.3 设置页：实例健康（调度器/门禁/磁盘）、备份导出恢复（SQLite `VACUUM INTO` + secrets key 提示）；5.4 删除全部遗留代码（旧 render/、drafts 模块、旧页面、旧 config.ts 路径等，`grep` 确认无引用）；5.5 部署文档与 Dockerfile 更新（含 fetch-mihomo）；5.6 全量回归 + 文档收尾（AGENTS.md 指向本文）。
⚑ 验收演示：产品文档 §10 成功标准 6（换机场 10 分钟迁移）真机走通。

依赖关系：M1→M2→M3 严格串行；M4.0（设计）可与 M2/M3 并行；M4 实现依赖 M2+M3；M5 依赖 M4。

---

## 17. 测试与验收策略

- **golden**：`backend/test/golden/` 固定输入 JSON + 期望 YAML 字节；`evaluate` 或 emitter 任何行为变化必须显式更新 golden 文件（diff 出现在 PR 里）。
- **集成**：沿用现有 bun test 风格（内存/临时 SQLite）；新增：发布流水线、拉取零上游、调度 tick、转换器等价性、模板往返。
- **端到端**：M4/M5 用浏览器手工清单（产品文档 §10 的 6 条成功标准逐条打勾），记录于 `docs/verification/next-e2e-checklist.md`。
- **性能抽查**：拉取端点本地压测（简单 `autocannon` 或脚本并发 100），p99 < 100ms 达标线。

## 18. 风险与卡点

- **R1（低）**：机场整体换域名导致节点 ID 全变 → 设计上视为删+增，selector 引用无感，ID 引用出问题清单。行为正确但用户可能困惑，UI 文案要解释。
- **R2（低）**：`lineWidth: -1` 使超长行不折叠 → 对 Clash 解析无影响（实验验证往返无损），仅影响人读观感。接受。
- **R3（已消除）**：mihomo -t 遇 GEOSITE 规则在无 geodata 时会静默联网下载（实测 8.7s）→ 已实验固化为内置离线 geodata 方案（§11.1），M2 任务 2.2 按此实施即可。
- **R4（低）**：`/rs/:hash` 无鉴权 → 仅公开规则源内容可经此端点（`is_public` 判定），私有粘贴内容强制 inline。已在设计内闭环。
- **R5（已消除）**：转换器已取消（无兼容约束，§12）。

## 附录 A：可行性实验记录（2026-07-04，本机 darwin-arm64）

1. 基线：`bun run typecheck` 双端 0 错误；`bun test` 16/16 通过（1.0s）。
2. js-yaml 4.1.1：同对象双 dump 字节一致 ✓；键插入序影响输出（⇒需规范化构造）✓；`sortKeys:true` 可抹平但放弃语义键序（弃用，改用规范化构造）；中文/emoji/冒号/前导零/`yes`/`~`/300 字符长串 dump 稳定且 load 往返无损 ✓（`lineWidth:-1`）。
3. sha256（node:crypto in Bun）稳定 ✓；AES-256-GCM 加解密往返 ✓。
4. mihomo v1.19.27（GitHub Releases 单文件 gz，darwin-arm64）：`-t -f` 合法配置 exit 0、毫秒级；悬空规则目标 exit 1，错误信息 `rules[1] [MATCH,NoSuchGroup] error: proxy [NoSuchGroup] not found` 可直接透传给用户 ✓。
5. baoyu-design skill 已安装于 `~/.claude/skills/baoyu-design`（含 design-system authoring / hi-fi / prototype 全流程）✓。
6. geodata 离线校验：`-d` 含 `geosite.dat`(4.0MB)+`country.mmdb`(7.7MB) 时 GEOSITE/GEOIP 配置校验 139ms 零联网 ✓；空 `-d` 时 mihomo 静默下载 MMDB（8.7s）✗ ⇒ 固化为内置离线 geodata 方案（§11.1）。
