# YouTube Subtitle Companion

`youtube-subtitle-companion` is a local-first desktop subtitle overlay for YouTube.

It uses a Chrome-compatible extension to read the active YouTube player and captions, sends that data over a localhost WebSocket, and renders subtitles in a transparent Electron overlay that can stay visible while Chrome is in the background or minimized. The overlay popup can look up a word, translate the full subtitle sentence, save both translations locally, and ask the connected browser extension to speak the current sentence.

## Quick Start

```bash
pnpm install
pnpm build
pnpm dev:desktop
```

In another terminal:

```bash
pnpm dev:extension
```

Then:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `dist/extension`
5. Open a normal YouTube watch page with `CC` enabled

If you reload the unpacked extension after rebuilding, the background worker will try to reinject the content script into already-open YouTube tabs. Refresh the tab if commands still report an old extension context.

## Commands

```bash
pnpm dev
pnpm dev:desktop
pnpm dev:extension
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm package:desktop
pnpm package:linux
pnpm package:win
```

`pnpm build` only compiles/bundles source. Packaging installers is separate.

## Hotkeys

- `Ctrl+Alt+Space`: play or pause
- `Ctrl+Backtick`: play or pause the active system media session
- `Ctrl+Alt+Z`: seek back 10 seconds
- `Ctrl+Alt+X`: seek forward 10 seconds
- `Ctrl+Alt+S`: show or hide overlay
- `Ctrl+Alt+A`: toggle active overlay for word lookup
- `Ctrl+Alt+Y`: toggle move-overlay mode
- `Ctrl+Alt+W`: temporarily dim subtitle text
- `Ctrl+Alt+Up`: increase font size
- `Ctrl+Alt+Down`: decrease font size

## Learning Flow

1. Pause the YouTube video.
2. Press `Ctrl+Alt+A`.
3. Click a word in the current subtitle cue.
4. The popup opens with the current sentence, dictionary meanings, and a sentence translation when available.
5. Click `Nghe câu` to ask the connected extension to speak the current subtitle sentence with Chrome TTS.
6. Click `Lưu câu` to save the word, sentence, and any available translations locally.
7. Open `Saved words` from the tray or overlay context menu to review or delete saved items.

## Storage

Desktop settings are stored with `electron-store`.

Typical config paths:

- Windows: `%APPDATA%/youtube-subtitle-companion/config.json`
- Linux: `~/.config/youtube-subtitle-companion/config.json`

Learning items that the user explicitly saves are stored locally as JSON files under the app data directory:

- Windows: `%APPDATA%/youtube-subtitle-companion/learning-data`
- Linux: `~/.config/youtube-subtitle-companion/learning-data`

Saved learning items can now include optional `wordTranslation` and `sentenceTranslation` fields. The learning JSON format remains local-only, append/delete based, and backward-compatible with older saved files. There is no cloud sync or backend.

## Security and Privacy

- WebSocket listens only on `ws://127.0.0.1:8765`.
- There is no cloud subtitle history, analytics service, or backend.
- Only learning items that the user explicitly saves are written to disk.
- Dictionary lookup may send the selected word and current subtitle sentence to the configured external dictionary/translation provider.
- Subtitle speech is delegated to the Chrome extension through `chrome.tts`; actual voice availability depends on the browser, OS, and installed speech engines.
- The extension requests `tts` and `scripting` permissions to support subtitle speech and reinject content scripts into existing YouTube tabs after reload.
- Renderer stays sandboxed with `contextIsolation: true` and no Node integration.
- Preload exposes a narrow typed API instead of raw `ipcRenderer`.

## Troubleshooting

### The extension does not connect

- Start the desktop app first.
- Reload the unpacked extension after rebuilding.
- The background worker now tries to reinject the content script into already-open YouTube tabs, but refresh the tab if playback or speech commands still report an old extension context.

### Subtitle updates stop in the background

- Keep YouTube out of browser memory saver.
- The extension already uses transcript timeline fallback, but aggressive throttling can still reduce update quality.

### Global hotkeys do not work

- Another app or desktop environment may already own the shortcut.
- On Linux, test again in a real `x11` session before changing code.

### The `Nghe câu` button does not work

- Reload the unpacked extension if the overlay says the connected extension does not support subtitle speech.
- On Linux, Chrome may report no usable TTS voices; install or enable a speech engine or voice backend and try again.
- Speech is sent through the active YouTube extension connection, so it will fail while the desktop app is disconnected.

### The overlay is visible but cannot be clicked

- It is probably in click-through mode.
- Pause the video and press `Ctrl+Alt+A` to activate word selection.
- Press `Ctrl+Alt+Y` to enter move mode if you want to drag the overlay.

## Development Architecture

Start with [AGENTS.md](./AGENTS.md) and [docs/AI_CONTEXT.md](./docs/AI_CONTEXT.md) before large code changes.
