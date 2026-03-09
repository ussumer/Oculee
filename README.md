# Desktop Banter Bot (Electron, Windows Only)

桌面透明 Overlay 吐槽助手，主进程基于 Electron + TypeScript。
当前主链路已升级为：

- 全局热键触发：`Ctrl+Alt+T`
- 5 秒冷却 + 运行中防重入
- 前台窗口上下文采集（含窗口 `id`）
- 多模态截图（`desktopCapturer`）
- LLM 双路由高可用：`PRIMARY -> FLASH_API(纯文本) -> LOCAL_FALLBACK`
- AI SDK 流式消费 + Function Calling（`changeEmotion`）

## Requirements

- Windows 10/11
- Node.js 20+
- `pnpm`
- 运行和构建请使用 Windows PowerShell

## Quick Start

```powershell
cd C:\dev\oculee
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

构建：

```powershell
pnpm build
```

## Environment Variables

### Base LLM (primary 默认来源)

- `LLM_API_KEY`：基础 key（Primary 未单独配置时会使用它）
- `LLM_API_URL`：OpenAI-compatible 地址，支持以下两种写法：
  - `https://api.openai.com/v1`
  - `https://api.openai.com/v1/chat/completions`
- `LLM_MODEL`：默认 `gpt-4o-mini`
- `LLM_TIMEOUT_MS`：默认 `5000`
- `LLM_MAX_OUTPUT_TOKENS`：默认 `180`
- `LLM_TEMPERATURE`：默认 `1.1`

### Primary Route (可选覆盖)

- `PRIMARY_LLM_API_KEY`
- `PRIMARY_LLM_API_URL`
- `PRIMARY_LLM_MODEL`
- `PRIMARY_LLM_TIMEOUT_MS`
- `PRIMARY_LLM_MAX_OUTPUT_TOKENS`
- `PRIMARY_LLM_TEMPERATURE`

说明：Primary 每个字段都按“`PRIMARY_*` 优先，否则回落到 `LLM_*`”解析。

### Flash Route (可选，主路由失败后的文本兜底)

- `FLASH_LLM_API_KEY`
- `FLASH_LLM_API_URL`
- `FLASH_LLM_MODEL`
- `FLASH_LLM_TIMEOUT_MS`
- `FLASH_LLM_MAX_OUTPUT_TOKENS`
- `FLASH_LLM_TEMPERATURE`

说明：如果 `FLASH_LLM_API_KEY` 为空，Flash 路由会被跳过，直接进入本地句库兜底。

### Multimodal Capture

- `MULTIMODAL_ENABLED`：默认 `1`
- `MULTIMODAL_CAPTURE_MODE`：`foreground` / `fullscreen`（会覆盖 `src/main/assets/capture.json`）
- `MULTIMODAL_IMAGE_MAX_SIDE`：默认 `720`
- `MULTIMODAL_IMAGE_MAX_BYTES`：默认 `180000`
- `MULTIMODAL_IMAGE_CODEC`：`jpeg`（默认）/ `png`
- `MULTIMODAL_JPEG_QUALITY`：默认 `72`
- `MULTIMODAL_DEBUG_DUMP`：`1/true` 时保存发送给 LLM 的压缩图
- `MULTIMODAL_DEBUG_DUMP_DIR`：debug 图输出目录（默认 `.debug/roast-captures`）

### Debug

- `DEBUG_LLM`：`1/true/yes` 开启详细日志（路由、stream 事件、tool call、capture debug）

## Runtime Flow

1. 热键触发后先检查冷却和 in-flight（防重入）。
2. 读取前台窗口上下文（`appName/title/bounds/id`）。
3. 按配置尝试截图。
4. 构造 prompt 并调用 Primary（可带图）。
5. Primary 失败后，剥离图片，使用 Flash 纯文本重试。
6. Flash 失败后，回退本地 `roastLocal`。
7. 首次缺 key 会额外提示一次：`未配置KEY，使用本地吐槽`。

## AI SDK / Function Calling

- LLM 调用使用 `@ai-sdk/openai` + `streamText`。
- 主流程消费 `fullStream`，逐块推送 toast 文本。
- 工具定义在 `src/main/roast/tools.ts`，当前包含：
  - `changeEmotion(emotion: 'happy' | 'sad' | 'angry' | 'smug')`
- 工具执行时会向 Overlay 窗口发送：`live2d:change-emotion`。

## Capture Design (DPI-safe)

截图逻辑位于 `src/main/roast/capture.ts`，已从坐标裁剪迁移为窗口源匹配：

- `desktopCapturer.getSources({ types: ['window'] })`
- 使用窗口 `id` 做精确匹配（`window:12345:0`）
- foreground 未命中时自动回退 `screen` 源
- 图片统一压缩/缩放后转 Base64 传给模型

## Project Structure

- `src/main/main.ts`：应用启动编排（load env / window / hotkey）
- `src/main/hotkeyHandler.ts`：热键、冷却、防重入、主调用入口
- `src/main/activeWindow.ts`：前台窗口采集与 Zod 清洗
- `src/main/roast/roast.ts`：编排层（Primary/Flash/Local 路由 + 日志）
- `src/main/roast/llmClient.ts`：AI SDK 客户端与 stream 配置
- `src/main/roast/capture.ts`：截图、压缩、debug dump
- `src/main/roast/tools.ts`：Function Calling 工具定义
- `src/main/assets/*.json`：prompt/roast/capture 配置
- `src/preload/preload.ts`：IPC 网关
- `src/renderer/overlay.ts`：toast 展示状态机

## Troubleshooting

- `electron-vite` not found：先执行 `pnpm install`，并确认在 PowerShell 中运行。
- 一直走 `LOCAL_FALLBACK`：打开 `DEBUG_LLM=1`，看 `[roast:error]` 的 `route/reason`。
- 报 `PRIMARY/FLASH text empty after stream`：通常是模型只返回 tool step 或空文本，检查模型兼容性与工具策略。
- 报 `Failed to start capture: -2147024809`：这是 Windows 图形捕获启动失败，先切 `MULTIMODAL_CAPTURE_MODE=fullscreen` 验证链路。

## Notes

- `.env` 和 `.env.local` 会自动加载；系统环境变量优先级最高。
- 本项目运行时目前只消费 `toast:show` 通道；流式效果通过重复发送更新后的完整文本实现。
