# 仓库协作约定

本文件适用于整个仓库。用户当前会话中的明确要求优先。

## 修改方式

1. 先快速阅读相关代码和直接调用链，定位最小修改点，然后直接修改。
2. 不输出详细计划、长篇分析或中间过程汇报。
3. 只完成明确要求的修改，不主动重构、补文档、增加测试或扩大范围。
4. 除非用户明确要求，不运行测试、构建、Lint、类型检查、服务启动或重启、浏览器验证等验证操作。
5. 普通细节遵循现有模式并作合理假设，不反复提问。
6. 完成后立即停止，用 1～3 行说明修改文件及内容；未验证时注明“未执行验证”。用户授权验证时，如实说明结果和未覆盖范围。
7. 修改可能导致数据丢失、安全风险或不可逆操作时，暂停并向用户确认。
8. 不涉及逆向时，不使用 reverse-skill 及其子技能。
9. 读取文件前，先判断已有上下文是否足够，避免重复读取。

## 浏览器操作

- 默认使用 ego-browser，并遵循 ego-browser 技能；用户明确指定其他工具时再切换。
- ego-browser 不可用、需要登录或用户接管时，说明具体情况并等待用户处理，不自行切换浏览器。

## 技术栈与目录

- 包管理器：pnpm，版本以 `package.json` 的 `packageManager` 为准。
- 前端：React、TypeScript、Vite、Tailwind CSS、shadcn/ui。
- 前端请求统一使用 `frontend/src/lib/api.ts` 中的 Axios 实例。
- 服务端：Express 5、TypeScript，使用 tsx 加载 TS 模块。
- 数据库：Node.js 内置 SQLite，本地默认数据库为 `data/hub.db`。
- 浏览器自动化：现有 Chrome 驱动与配套发布助手适配器。

| 路径 | 职责 |
| --- | --- |
| `frontend/src/pages/` | 看板、流量、日历、档案、系统、任务、评论和运行页面 |
| `frontend/src/components/ui/` | shadcn/ui 基础组件 |
| `frontend/src/components/` | 公共业务组件和图表 |
| `frontend/src/lib/` | Axios 请求、格式化及公共工具 |
| `frontend/src/types.ts` | 前端接口类型 |
| `src/web.ts` | Express 入口、访问控制和现有业务接口 |
| `src/management.ts` | 任务中心、评论反馈和运行管理接口 |
| `src/login.ts` | 飞书验证码及网页会话 |
| `src/jobs.ts` | 持久化操作队列、取消、重试和平台任务状态 |
| `src/feedback.ts` | 评论导入、去重、分类与汇总 |
| `src/runtime.ts` | 守护进程心跳、启停及日志 |
| `src/browser-lock.ts` | 浏览器任务互斥 |
| `src/platforms.ts` | 平台开关及配置持久化 |
| `src/hub.mjs` | CLI、发布流程及守护调度 |
| `src/db.mjs` | 数据表、任务状态与数据访问 |
| `src/driver.mjs`、`src/chrome-shim.mjs` | 浏览器驱动和 CDP 连接 |
| `src/*.d.mts`、`src/server-types.ts` | 现有 JS 模块的类型声明和服务端类型 |

## 实现约定

- 新增前端和 Express 服务端代码使用 TypeScript；不为迁移语言而批量改写现有 `.mjs`。
- 修改 JS 模块的导出契约时，同步更新对应类型声明。
- 复用 shadcn/ui 和现有业务组件；不引入另一套组件库或请求库。
- 开发入口使用 Vite 中间件；生产页面由 Express 提供 `dist/` 构建产物。
- 保留现有口令、飞书会话及 Cloudflare Access 鉴权，不让新增接口绕过访问控制。
- SQL 使用参数绑定；平台输入须校验，平台执行遵循已开启列表。
- 关闭平台保留历史数据，不自动删除任务、评论、登录目录或数据库。
- 耗时的浏览器操作通过操作队列和互斥锁协调，避免与守护调度争用浏览器。
- 重试发布复用现有防重逻辑，不默认加 `--force`；取消本地任务不会撤回平台已接受的发布。
- 评论反馈目前通过文本、JSON、CSV 导入，采用规则分类；本地“已回复”标记不代表向平台发送了回复。
- 不提交真实口令、Webhook、Cookie、`config.json`、数据库、运行日志或 `chrome-profile/`。

## 命令与提交

以下命令仅在用户明确授权相应操作时执行：

| 命令 | 用途 |
| --- | --- |
| `pnpm install` | 安装依赖，并通过 prepare 初始化 Husky |
| `pnpm dev` | 开发服务，前端支持热更新；后端修改仍需重启 |
| `pnpm build` | 构建前端到 `dist/` |
| `pnpm start` | 启动生产网页服务，需要已有前端构建产物 |
| `pnpm lint` | ESLint 检查 |
| `pnpm typecheck` | 前后端 TypeScript 检查 |

- 依赖变更同步更新 `package.json` 与 `pnpm-lock.yaml`，不混用其他包管理器生成锁文件。
- 用户要求提交时，保留 Husky 的 `pnpm lint && pnpm typecheck` 提交前校验；失败时修复相关问题，不自行跳过钩子。
- 不擅自提交、推送、发布或更改 Git hooks 配置以绕过校验。
