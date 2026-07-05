# ProxyParser Agent Notes

ProxyParser Next（2026-07 重构完成）：面向 Clash/Mihomo 的订阅托管与编辑控制台。
核心模型：声明式 BuildConfig + 不可变版本发布 + 内容寻址规则快照 + mihomo 内核发布门禁。

Authoritative docs:

- 产品设计: `docs/2026-07-04-proxyparser-next-product-design.md`
- 技术方案（施工图）: `docs/2026-07-04-proxyparser-next-technical-plan.md`
- 设计原型: `designs/proxyparser-next/`（视觉规格，tokens 在 styles.css）
- 历史文档（已被取代，仅供考古）: `docs/technical-plan.md`, `docs/superpowers/`

Commands:

- Root typecheck: `bun run typecheck`
- Backend tests: `cd backend && bun test`（含 golden 渲染测试；行为变化需显式更新 `backend/tests/golden/`，设 `UPDATE_GOLDEN=1` 重生成）
- Frontend build: `cd frontend && bun run build`
- Dev: `bun run dev`；后端开发端口避开 3001 与 7001（用户可能占用）
- 类型同步: `bun run sync-types`（BuildConfig 类型 backend → frontend）

Architecture map (backend/src):

- `lib/build-config/` BuildConfig 类型/校验/稳定节点 ID/模板提炼与应用
- `lib/render-v2/` 确定性渲染管线（evaluate 七阶段）+ 规范化 YAML emitter（全仓唯一 yaml.dump 出口）+ release diff
- `lib/validate/mihomo-gate.ts` 内核校验门禁（离线 geodata 在 `backend/assets/geodata/`）
- `lib/scheduler/` 后台调度（测试模式用 runTickOnce() 驱动）
- `modules/subscriptions/` 订阅/版本/token/交付（`/s/:id/:token`、`/rs/:hash.yaml`）
- `modules/rulesets/` 规则库（内容寻址快照；离线内置在 `backend/assets/rulesets/`）
- `modules/upstream-sources/` 订阅源同步 + 同步报告 + onSynced hook

Invariants (do not break):

- 拉取端点只读已发布 Release，绝不触发上游请求或渲染。
- 相同输入 evaluate 必须字节级确定（golden 测试锁定）。
- 任何可下载数据必须有仓库内离线副本（assets/），网络只用于更新。
- 规则快照按内容 hash 不可变；更新 = 新快照 + 用户确认。
- UI 文案中文；代码与 API 字段英文。
- `backend/data/` gitignored（含 mihomo 二进制、SQLite、.secret-key），不得提交。
- `backend/data/mock-subscriptions/` 可能含真实节点，禁止提交或打印内容。
