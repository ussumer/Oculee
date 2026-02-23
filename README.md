# Electron M3 Multimodal Overlay (Windows Only)

Transparent always-on-top overlay with global hotkey roast generation.

Current behavior:

- click-through overlay, no taskbar, top-right fixed position
- toast show/update/fade handled by renderer (3s + fade)
- hotkey `Ctrl+Alt+T`
- 5s cooldown unchanged
- roast pipeline: multimodal (screenshot + context) -> fallback local roast
- relaxed chat mode: toast up to 100 chars, emoji/颜文字 allowed

## Requirements

- Windows 10/11
- Node.js 20+
- Run install/dev/build from Windows PowerShell

## Install

```powershell
cd C:\dev\desktop_banter_bot
npm install
```

## Config

```powershell
Copy-Item .env.example .env.local
```

Edit `.env.local`, then run:

```powershell
npm run dev
```

`src/main/loadEnv.ts` auto-loads `.env` and `.env.local` (existing system env vars still take priority).

## Environment Variables

Required:

- `LLM_API_KEY`

OpenAI-compatible endpoint:

- `LLM_API_URL` (full URL, default `https://api.openai.com/v1/chat/completions`)

Common:

- `LLM_MODEL` (default `gpt-4o-mini`)
- `LLM_TIMEOUT_MS` (default `5000`)
- `LLM_MAX_OUTPUT_TOKENS` (default `180`)
- `LLM_TEMPERATURE` (default `1.1`)
- `DEBUG_LLM` (`1/true` to print non-sensitive stats)

Multimodal:

- `MULTIMODAL_ENABLED` (default `1`)
- `MULTIMODAL_IMAGE_MAX_SIDE` (default `720`)
- `MULTIMODAL_IMAGE_MAX_BYTES` (default `180000`)
- `MULTIMODAL_IMAGE_CODEC` (`jpeg` default, or `png`)
- `MULTIMODAL_JPEG_QUALITY` (default `72`)
- `MULTIMODAL_SCREEN_ID` (optional, choose monitor)
- `MULTIMODAL_CAPTURE_MODE` (optional override: `foreground` / `fullscreen`)

Capture mode file:

- `src/main/assets/capture.json`
  - `captureMode`: `foreground` (按前台窗口裁剪) 或 `fullscreen`（整屏）
  - `fallbackToFullscreen`: 前台裁剪失败时是否回退整屏

## Qwen Example (.env.local)

```env
LLM_API_KEY=your_qwen_key
LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
LLM_MODEL=qwen-plus
LLM_TIMEOUT_MS=15000
LLM_MAX_OUTPUT_TOKENS=180
LLM_TEMPERATURE=1.1
DEBUG_LLM=1
MULTIMODAL_ENABLED=1
MULTIMODAL_IMAGE_MAX_SIDE=720
MULTIMODAL_IMAGE_MAX_BYTES=180000
MULTIMODAL_IMAGE_CODEC=jpeg
MULTIMODAL_JPEG_QUALITY=72
```

## Fallback Rules

Fallback to local roast if any of the following happens:

- missing key
- timeout
- request/network failure
- empty model text
- screenshot capture failure (then degrades to text-only model call or local fallback)

First missing-key trigger also shows once:

- `未配置KEY，使用本地吐槽`

## Smoke Check

1. Start app: toast shows `MM chat mode ready: Ctrl+Alt+T`
2. No key: hotkey still gives local roast
3. With key: hotkey gives model roast (longer chat tone, up to 100 chars)
4. During cooldown (5s): only `冷却中 ...`
5. Bubble supports longer multiline text
6. Foreground capture test:
   - set `src/main/assets/capture.json` -> `"captureMode": "foreground"`
   - focus a window that is not full-screen and press hotkey
   - screenshot input should follow the focused window bounds, not full-screen

## Build

```powershell
npm run build
```
