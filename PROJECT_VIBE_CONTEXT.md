# PROJECT VIBE CONTEXT (Desktop Banter Bot Baseline)

## 1) 你在接手什么
这是一个 **Windows-only Electron + TypeScript** 桌面 overlay 工程，当前已经稳定跑通以下能力：
- 透明右上角 overlay（无边框、置顶、鼠标穿透）
- 全局热键 `Ctrl+Alt+T`
- 5 秒冷却（防刷屏）
- 活动窗口上下文获取（active-win + Zod 清洗）
- 本地吐槽兜底 + LLM（OpenAI-compatible）生成
- 多模态截图输入（支持前台窗口裁剪 / 全屏）
- Renderer 3s 展示 + 淡出 + 更新续命

目标不是“重写”，而是：**在不破坏现有业务链路的前提下迭代**。

---

## 2) 运行环境与硬约束
- 依赖安装与运行：**Windows PowerShell**
- 可在 WSL 编辑代码，但不要在 WSL 安装 Electron 运行依赖
- Node.js 20+
- 启动：`npm run dev`
- 构建：`npm run build`

---

## 3) 当前核心架构（必须遵守）

### Main process
- `src/main/main.ts`
  - 仅做生命周期编排：`loadEnv -> createOverlayWindow -> registerHotkey`
- `src/main/windowManager.ts`
  - 负责窗口创建、定位、页面加载、ready toast
- `src/main/hotkeyHandler.ts`
  - 热键注册/注销 + 主业务调度：
  - 冷却判断 -> 取窗口上下文 -> 生成 roast -> toast 发送
- `src/main/activeWindow.ts`
  - 封装 active-win，Zod 清洗输出 `WindowContext`
- `src/main/roast/roast.ts`
  - roast 编排层：LLM 优先，失败则本地兜底
- `src/main/roast/llmClient.ts`
  - **OpenAI-compatible 单协议客户端（当前唯一模型协议）**
- `src/main/roast/capture.ts`
  - 截图 + 压缩 + 前台窗口裁剪/全屏模式
- `src/main/dataLoader.ts`
  - JSON 配置加载与缓存

### Shared
- `src/shared/types.ts`
  - Zod schema + infer type（唯一类型事实源）
- `src/shared/ipc.ts`
  - IPC 通道常量与 payload schema 导出
- `src/shared/utils/stringUtils.ts`
  - Unicode 安全字符串截断/长度工具

### Preload + Renderer
- `src/preload/preload.ts`
  - IPC 海关：`ToastShowPayloadSchema.safeParse`
  - `window.overlay.onToastShow(...)`
  - 首条消息回放缓存（避免订阅时序丢消息）
- `src/renderer/overlay.ts`
  - UI 状态机：hidden/showing/fading
  - 绑定重试（避免早期注入时序问题）

---

## 4) 配置驱动（数据与逻辑分离）
- `src/main/assets/roasts.json`：本地句库与模板
- `src/main/assets/prompts.json`：prompt 模板
- `src/main/assets/capture.json`：截图模式
  - `captureMode`: `foreground` | `fullscreen`
  - `fallbackToFullscreen`: bool

`.env.local` 主要项：
- `LLM_API_KEY`（必需）
- `LLM_API_URL`（OpenAI-compatible 完整 endpoint）
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`
- `LLM_MAX_OUTPUT_TOKENS`
- `LLM_TEMPERATURE`
- `DEBUG_LLM`
- `MULTIMODAL_*`

---

## 5) 业务链路（禁止改变顺序）
热键触发后严格保持：
1. 冷却校验（冷却中只吐提示，不生成业务内容）
2. 获取前台窗口上下文
3. 可选截图（按 capture mode）
4. 组 prompt
5. 调 LLM
6. 清洗文本
7. 失败回退 roastLocal
8. send toast 给 renderer

---

## 6) 安全与隐私边界
- 不在日志打印敏感原始标题（`titleRaw`）
- 黑名单命中时仅使用安全占位
- renderer 不启用 Node API（`contextIsolation: true`, `nodeIntegration: false`）
- IPC 入口必须 `safeParse`
- 不用 `executeJavaScript` 做主链路旁路发送

---

## 7) 代码风格与协作协议（Vibe Coding 最佳实践）
1. 小步快跑：每次改动聚焦单职责模块
2. 先 schema 后逻辑：新增数据先定义 Zod schema
3. 配置外置：新增文案/模板/策略优先写 JSON
4. 不破坏主流程：只在模块内替换实现，不挪业务顺序
5. 明确 fallback：任何外部依赖失败都要本地兜底
6. 保持可观测：debug 日志仅输出非敏感统计
7. 统一字符串处理：必须走 `stringUtils`

---

## 8) 新需求落地模板（直接套用）
当你要加一个新能力（例如新风格、新路由、新模型）时：
1. 新增配置项到 `assets/*.json`（不是硬编码）
2. 在对应模块加 Zod schema 校验
3. 在编排层插入，不改变既有顺序
4. 保留 fallback 行为
5. 更新 README 的配置与验收步骤
6. Windows PowerShell 下执行 `npm run build`

---

## 9) DoD（完成定义）
改动完成必须满足：
- `npm run build` 通过（Windows PowerShell）
- 热键链路可用
- 冷却行为不变
- overlay 展示/淡出不回归
- 无敏感泄露日志
- 文档同步更新

---

## 10) 给下一位 AI/开发者的启动指令（可直接复制）
你是本项目的增量维护者。请遵守以下规则：
- 不重写系统，不改变主业务链路顺序
- 保持模块边界：windowManager / hotkeyHandler / roast orchestrator / llmClient / preload-gateway
- 新数据结构先建 Zod schema，再接逻辑
- 新文案与模板写入 assets JSON，不写死在 TS
- 任何外部调用失败必须 fallback 到本地可用路径
- 不引入破坏安全边界的旁路（例如 executeJavaScript 作为主发送链路）
- 完成后给出：修改文件列表、行为变化、回归风险、Windows 构建结果

