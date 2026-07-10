# ProxyParser

你的订阅配置的家。机场订阅是原料，ProxyParser 里存放的是你确认过的、带版本的、永远可回滚的成品配置；客户端拉到的每一个字节都是你见过并同意的。

面向 Clash / Mihomo 用户的订阅托管与编辑控制台：

- **声明式构建**：节点转换、代理组生成器、面向目标的规则块，全部声明式定义，换订阅源即可整体套用（模板）。
- **发布即版本**：编辑 → 预览 diff → 发布不可变版本；拉取端点只读已发布版本，毫秒级返回、随时回滚。
- **上游自动吸收**：后台同步机场订阅，节点增删/改名/换凭据自动生成同步报告，并按每订阅策略自动或经确认发版。
- **规则钉版本**：规则源以内容寻址快照进入配置（`/rs/<hash>.yaml` 不可变端点），远端更新只点亮徽章，永不静默改变已发布配置。
- **发布门禁**：结构校验 + 真实 mihomo 内核 `-t` 校验（内置离线 geodata），拉到的配置必然可加载。
- **离线开箱即用**：内置规则源与官方推荐模板随仓库分发，全离线环境首启即可完成黄金路径。

## 快速开始

```bash
bun install

# （可选，推荐）启用 mihomo 内核发布门禁
bun backend/scripts/fetch-mihomo.ts

bun run dev        # backend :3001 + frontend :5173
```

打开 http://localhost:5173 注册账号 → 粘贴机场订阅链接 → 选「推荐方案」→ 发布，即得到稳定订阅链接与二维码。

## 常用命令

```bash
bun run typecheck            # 双端类型检查
cd backend && bun test       # 后端测试（含 golden 渲染测试）
bun run build                # 全仓构建（后端类型检查 + 前端生产构建）
bun run sync-types           # 后端 BuildConfig 类型同步到前端
bun backend/scripts/fetch-rulesets.ts   # 更新内置规则源离线快照
bun backend/scripts/fetch-geodata.ts    # 更新离线 geodata
```

## 生产部署

见 `docs/deployment.md` 与 `deploy/`。关键环境变量：

| 变量 | 说明 |
|---|---|
| `PUBLIC_BASE_URL` | 对外地址（订阅链接与 /rs 端点用），如 `https://pp.example.com` |
| `JWT_SECRET` | 认证密钥，必须设置 |
| `PP_SECRET_KEY` | 数据加密密钥（hex 64 位）；不设则首启生成到数据库同目录的 `.secret-key` |
| `DATABASE_PATH` | SQLite 路径，默认 `data/proxyparser.sqlite` |

备份 = SQLite 文件 + 匹配的 `.secret-key`（或外部保存的 `PP_SECRET_KEY`）。

## 文档

- 产品设计：`docs/2026-07-04-proxyparser-next-product-design.md`
- 技术实现（as-built）：`docs/2026-07-04-proxyparser-next-technical-plan.md`
- 设计原型：`designs/proxyparser-next/`（`index.html` 总览）
