# ProxyParser 产品重构草案

正式设计规格已经沉淀到：

```text
docs/superpowers/specs/2026-05-14-proxyparser-product-redesign-design.md
```

当前确认方向：

- 技术栈保留：Bun + Elysia + SQLite + React + Vite。
- 产品重新设计，不沿用旧版本的信息架构和工作流。
- V1 定位为半公开模板生态：个人生成订阅是核心，模板和规则方案可以脱敏共享。
- 扩展订阅可以共享给指定用户或所有人。
- 目标是先做出完整可用的一版产品，而不是只修补当前 UI。

后续 agent 请以正式规格为准。
