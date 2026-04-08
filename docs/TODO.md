# ProxyParser TODO

最后更新：2026-04-08

这个文件用于跟踪 ProxyParser 从当前解析器 / 检查面板演进为多用户 Mihomo 订阅服务的实现过程。

当前的主线已经调整：

- “生成订阅向导”是核心编辑入口
- “模板”不再是前置条件，而是从生成订阅操作流中沉淀出来的蓝图
- 内置规则源必须真实抓取入库，并按固定周期更新

## Phase 0：决策与清理

- [x] 确认 V1 目标方言为 `Mihomo-compatible Clash YAML`
- [x] 确认 V1 使用嵌入式 `SQLite`
- [x] 澄清内部术语：`upstream_source`、`template`、`managed_subscription`
- [x] 确认新的产品化 UI 默认使用中文
- [x] 梳理当前 backend 解析逻辑并提炼为统一渲染模块边界
- [x] 确认开发 / 生产环境下 SQLite 文件的放置策略
- [x] 加入后端运行时配置与环境变量策略

## Phase 1：持久化基础设施

- [x] 添加 SQLite 初始化模块
- [x] 添加 SQL 迁移执行器
- [x] 创建初始表：
- [x] `users`
- [x] `user_passwords`
- [x] `user_refresh_tokens`
- [x] `user_subscription_secrets`
- [x] `user_subscription_temp_tokens`
- [x] `upstream_sources`
- [x] `upstream_source_sync_logs`
- [x] `upstream_source_snapshots`
- [x] `templates`
- [x] `template_versions`
- [x] `managed_subscriptions`
- [x] `managed_subscription_snapshots`
- [x] `managed_subscription_pull_logs`
- [x] `ruleset_catalog`
- [x] `ruleset_cache_entries`
- [x] `audit_logs`
- [x] 为主要聚合根添加仓储层
- [x] 为内置规则源目录添加 seed 机制

## Phase 2：认证与用户管理

- [x] 引入 `argon2id` 密码哈希
- [x] 实现 JWT access token 签发
- [x] 实现 refresh token 签发与撤销
- [x] 添加 `POST /api/auth/register`
- [x] 添加 `POST /api/auth/login`
- [x] 添加 `POST /api/auth/refresh`
- [x] 添加 `POST /api/auth/logout`
- [x] 添加 `GET /api/me`
- [x] 添加受保护接口的认证中间件
- [x] 添加最小可用的前端登录流程

## Phase 3：上游订阅源管理

- [x] 实现 `upstream_sources` 的 CRUD
- [x] 持久化保存 owner、分享设置和展示名
- [x] 保存同步元数据：上次同步时间、上次成功时间、上次失败时间、上次状态
- [x] 抓取并保存 `subscription-userinfo` 等上游头信息
- [x] 保存原始上游快照
- [x] 保存解析后的标准化快照
- [x] 添加手动同步接口
- [x] 添加 stale 判定策略
- [x] 添加超时与重试策略
- [x] 在可用时支持 `ETag` / `If-Modified-Since`

## Phase 4：模板模型与版本化

- [x] 定义 V1 模板 JSON Schema
- [x] 支持以下模式：
- [x] `rules/groups`：`patch` 与 `full_override`
- [x] `config`：`patch` 与 `full_override`
- [x] `custom_proxies`：`append`、`replace_same_name`、`fail_on_conflict`
- [x] 实现模板 CRUD
- [x] 实现模板版本历史
- [x] 添加可见性和发布状态
- [x] 支持导出 Mihomo YAML 预览
- [x] 添加前端模板编辑器骨架
- [x] 把模板从“前置依赖”调整为“可复用蓝图产物”
- [x] 增加 `source_locked` / `shareable` 判定
- [x] 支持从生成订阅操作流提炼模板

## Phase 4.5：内置规则源真实同步

- [x] 将四个 GitHub 规则源从“仓库占位符”改为“真实可抓取规则项目录”
- [x] 为每个规则项保存来源、分支、路径、行为类型等元数据
- [x] 启动时同步所有到期的官方规则项
- [x] 增加固定周期后台同步，默认 `24h`
- [x] 保存规则内容缓存、抓取状态、抓取时间和到期时间
- [x] 为前端提供规则项详情与缓存内容读取接口
- [x] 支持将规则项直接作为生成订阅向导的可选 rule-provider

## Phase 5：渲染引擎

- [x] 将当前解析逻辑收敛到 `src/lib/render`
- [x] 定义 Mihomo 配置的统一内部表示
- [x] 支持导入第三方规则源
- [x] 正确应用模板的 patch / full override 逻辑
- [x] 支持自定义节点注入
- [x] 校验代理组和规则引用关系
- [x] 将最终配置序列化为 Mihomo YAML
- [x] 持久化渲染快照
- [x] 保留最近一次成功渲染结果作为回退缓存

## Phase 6：生成订阅

- [x] 实现 `managed_subscriptions` 的 CRUD
- [x] 允许绑定一个上游订阅源和一个模板
- [x] 保存托管订阅元数据：
- [x] 展示名
- [x] 上次同步时间
- [x] 上次渲染时间
- [x] 上次同步状态
- [x] 上次渲染状态
- [x] 最近一次成功快照 ID
- [x] 缓存的用量与到期信息
- [x] 支持用户自定义展示名
- [x] 添加手动重新渲染接口
- [x] 添加前端订阅列表与详情页面
- [x] 将“先选模板再创建订阅”调整为“向导式生成订阅”
- [x] 新建独立页面而不是弹窗
- [x] 支持顶部步骤导航和回退
- [x] 分步骤保存草稿
- [x] 选择外部订阅
- [x] 编辑节点
- [x] 编辑代理组与规则
- [x] 编辑其他设置
- [x] 预览最终配置并确认发布
- [x] 每一步都支持可视化 / RAW 双模式
- [x] 每一步都支持 `patch` / `full_override`
- [x] 数据库存储“操作”，而不是只存最终结果
- [x] 基于最新上游快照重放整条操作链
- [x] 支持根据操作流自动生成模板快照

## Phase 7：带秘钥的订阅拉取

- [x] 为每个用户生成长期订阅秘钥
- [x] 支持长期秘钥轮换
- [x] 支持创建默认 24 小时有效的临时订阅令牌
- [x] 对所有令牌只保存哈希并支持撤销
- [x] 添加 `GET /subscribe/:id`
- [x] 拉取时如果缓存过旧，尝试刷新上游订阅
- [x] 如果同步失败，返回最近一次有效渲染快照
- [x] 如果没有任何有效快照，则明确报错
- [x] 透传相关用量响应头
- [x] 记录拉取日志与 token 使用时间

## Phase 8：共享与模板市场

- [x] 为模板添加共享可见性模型
- [x] 为托管订阅添加共享可见性模型
- [x] 添加官方内置模板的市场展示
- [x] 添加用户公开模板的市场展示
- [x] 添加规则源目录管理 UI
- [x] 添加模板导入 / 复制流程
- [x] 添加署名与来源链接
- [x] 添加市场内容隐藏 / 下架能力

## Phase 9：前端产品化

- [x] 用带认证的应用路由替换当前单页检查面板
- [x] 新 UI 默认使用中文文案
- [x] 添加页面：
- [x] 登录 / 注册
- [x] 上游订阅源
- [x] 模板
- [x] 托管订阅
- [x] 模板市场
- [x] 账号与安全
- [x] 添加同步 / 渲染状态标签
- [x] 添加秘钥管理 UI
- [x] 将生成订阅创建入口升级为路由式向导页
- [x] 添加快照历史与 diff 检查 UI

## Phase 10：运维与加固

- [x] 添加结构化日志
- [x] 为安全敏感操作写入审计日志
- [x] 为认证和订阅拉取接口添加限流
- [x] 制定 SQLite 备份与恢复流程
- [x] 添加迁移回滚说明
- [x] 添加数据库与后台任务健康检查
- [x] 为认证、渲染和拉取回退行为添加自动化测试
- [x] 添加基于社区规则源的内置模板 seed

## 当前优先任务

- [x] 彻底移除当前基于静态配置文件的订阅加载路径
- [x] 将内置规则源升级为真实同步入库
- [x] 重新设计生成订阅的数据模型为“操作流 + 蓝图沉淀”
- [x] 为生成订阅向导建立后端草稿与步骤保存能力
- [x] 开始实现节点 / 代理组 / 规则 / 其他设置的 schema-driven 编辑模型
