# YouTube Subtitle Companion

`youtube-subtitle-companion` is a local-first desktop subtitle overlay for YouTube.

It uses a Chrome-compatible extension to read the active YouTube player and captions, sends that data over a localhost WebSocket, and renders subtitles in a transparent Electron overlay that can stay visible while Chrome is in the background, minimized, or on another monitor.

## What It Does

- Shows current YouTube subtitles in a transparent desktop overlay.
- Keeps the overlay visible above other apps.
- Lets the overlay send commands back to YouTube.
- Supports play or pause, seek, show or hide overlay, interaction mode, and overlay move mode.
- Handles YouTube SPA navigation and reconnects automatically.
- Uses transcript timeline fallback so subtitle updates can keep working better when the YouTube tab is backgrounded.
- Uses segment-level transcript timing when YouTube exposes it, so the overlay can animate karaoke-style highlighting locally on the desktop side.

## Architecture

```text
YouTube -> Extension -> WebSocket -> Electron -> Overlay
Overlay -> Electron -> WebSocket -> Extension -> YouTube
```

Workspaces:

- `apps/extension`: Manifest V3 extension for `https://www.youtube.com/*`
- `apps/desktop`: Electron app, tray, overlay window, WebSocket server, hotkeys, config
- `packages/shared`: protocol contracts, validation, source selection, timeline types, tests

## Requirements

- Node.js `>= 20.12.0`
- pnpm `>= 9`
- Chrome, Edge, or Brave
- Windows 10/11, or Linux

Linux note:

- The desktop app defaults to `X11/XWayland` on Linux because transparent always-on-top overlays and global shortcuts are more reliable there.
- Native `Wayland` can work partially, but some compositors may block global hotkeys or interfere with always-on-top behavior.
- If you want the most reliable Linux experience, test in a real `x11` session.

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
5. Open a normal YouTube watch page: `https://www.youtube.com/watch?...`
6. Turn `CC` on

## Development

Start both sides together:

```bash
pnpm dev
```

Or run them separately:

```bash
pnpm dev:desktop
pnpm dev:extension
```

Important dev note:

- `pnpm dev:desktop` does not hot-restart Electron for every main-process change.
- After changing `apps/desktop/src/main/*` or `apps/desktop/src/preload/*`, restart the desktop process manually.

## Build

Build everything:

```bash
pnpm build
```

Build individual targets:

```bash
pnpm build:shared
pnpm build:extension
pnpm build:desktop
pnpm --filter @youtube-subtitle-companion/desktop build:linux
pnpm --filter @youtube-subtitle-companion/desktop build:win
```

Expected outputs:

- Extension: `dist/extension/`
- Desktop packages: `dist/desktop/`
- Linux package: `dist/desktop/*.AppImage`
- Windows package: `dist/desktop/*.exe`

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## How To Use

1. Start the desktop app first.
2. Load the unpacked extension from `dist/extension`.
3. Open a YouTube watch page with captions.
4. Turn `CC` on.
5. The subtitle overlay should appear near the lower center of the screen.
6. Double-click subtitle text to seek back 10 seconds.
7. Use interaction mode or move mode when you need to click or drag the overlay.

## Hotkeys

- `Ctrl+Alt+Space`: play or pause
- `Ctrl+Backtick`: play or pause the active system media session
- `Ctrl+Alt+Left`: seek back 5 seconds
- `Ctrl+Alt+Right`: seek forward 5 seconds
- `Ctrl+Alt+S`: show or hide overlay
- `Ctrl+Alt+I`: toggle interaction mode
- `Ctrl+Alt+Y`: toggle move-overlay mode
- `Ctrl+Alt+D`: temporarily dim subtitle text for 2 seconds
- `Ctrl+Alt+Up`: increase font size
- `Ctrl+Alt+Down`: decrease font size

Overlay UI:

- `X` button on the overlay hides it
- Use `Ctrl+Alt+S` or the tray menu to show it again

## Extension Loading

1. Run `pnpm dev:extension` or `pnpm build:extension`
2. Open `chrome://extensions`, `edge://extensions`, or `brave://extensions`
3. Enable `Developer mode`
4. Click `Load unpacked`
5. Select `dist/extension`

If you rebuilt the extension, click `Reload` on the extensions page and refresh the YouTube tab.

## Config Storage

Desktop settings are stored with `electron-store`.

Typical locations:

- Windows: `%APPDATA%/youtube-subtitle-companion/config.json`
- Linux: `~/.config/youtube-subtitle-companion/config.json`

This file stores:

- overlay size and position
- opacity
- alignment
- auto-start
- hotkey overrides

## Troubleshooting

### The extension does not connect

- Start the desktop app first.
- Confirm the app is listening on `ws://127.0.0.1:8765`.
- Reload the unpacked extension after rebuilding.
- Refresh the YouTube tab if it was already open before the extension loaded.

### The overlay says it is waiting for subtitles

- Confirm the page is a normal `youtube.com/watch` page.
- Confirm the video actually has captions.
- Confirm `CC` is enabled in the YouTube player.
- Seek once or pause and resume once to force caption activity.

### Subtitle updates stop when YouTube is in the background

- Keep YouTube out of browser memory saver.
- In Chrome, add `https://www.youtube.com` to `Performance -> Memory Saver -> Always keep these sites active`.
- This project already uses transcript timeline fallback, but aggressive browser throttling can still reduce update quality in some setups.

### Global hotkeys do not work

- Another app or your desktop environment may already own the shortcut.
- Check desktop logs for `Failed to register ... hotkey`.
- On Linux Wayland, global hotkeys may only work while the app is focused, depending on the compositor.
- If Linux hotkeys are important, test again in a real `x11` session before changing code.

### `Ctrl+Backtick` does not pause or resume other apps

- This hotkey is implemented through Linux media-session backends, not by changing volume.
- `playerctl` is the preferred backend when installed.
- If `playerctl` is missing, the app falls back to MPRIS over `dbus-send`.
- Browser tabs or players that do not expose an MPRIS media session cannot be controlled by this hotkey.

### The overlay is visible but cannot be clicked

- It is probably in click-through mode.
- Press `Ctrl+Alt+I` to switch to interaction mode.
- Press `Ctrl+Alt+Y` to enter move mode if you want to drag it.

### The overlay does not come back after hiding it

- Try the tray menu first.
- On Linux Wayland, this can be limited by compositor behavior if global hotkeys are not truly global.
- On Linux, `x11` is the recommended session for this app.

## Manual Test Checklist

1. Start the desktop app.
2. Load the extension.
3. Open a YouTube video with captions.
4. Turn captions on.
5. Switch to another app.
6. Confirm the overlay stays visible.
7. Minimize Chrome.
8. Confirm subtitles still update.
9. Double-click subtitle text.
10. Confirm the video seeks back 10 seconds.
11. Test play or pause hotkey.
12. Test seek hotkeys.
13. Test `Ctrl+Alt+S`.
14. Test `Ctrl+Alt+I`.
15. Test `Ctrl+Alt+Y`.
16. Restart the desktop app.
17. Confirm the extension reconnects.
18. Navigate to another YouTube video in the same tab.
19. Confirm subtitles continue after SPA navigation.
20. Test on Linux `x11` if you need reliable global hotkeys.

## Known Limitations

- YouTube can change its DOM or player internals and break subtitle extraction.
- Linux `Wayland` behavior depends heavily on the compositor.
- Browser memory-saving features can still throttle background subtitle updates.
- The desktop dev script does not auto-restart Electron for all main-process changes.
- Auto-start behavior can vary across Linux desktop environments.

## Security

- The desktop WebSocket server binds only to `127.0.0.1`.
- Renderer and extension messages are validated before use.
- `nodeIntegration` is disabled.
- `contextIsolation` is enabled.
- No OCR, cloud backend, analytics, or subtitle history storage is used.

## License

MIT. See [LICENSE](./LICENSE).
