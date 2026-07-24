# Project Knowledge

## Purpose
- `youtube-subtitle-companion` is a local-only YouTube subtitle overlay.
- Runtime flow:
  - `apps/extension` reads YouTube player state and captions.
  - `apps/desktop` listens on `ws://127.0.0.1:8765`, selects the active source, and renders the overlay.
  - `packages/shared` owns protocol, validation, timeline types, reconnect policy, and source selection logic.

## Commands
- Install: `pnpm install`
- Dev all: `pnpm dev`
- Dev desktop only: `pnpm dev:desktop`
- Dev extension only: `pnpm dev:extension`
- Validate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Current Architecture Notes
- Extension subtitle ingestion is no longer DOM-only.
- Current extension pipeline, in order:
  - read live caption DOM (`.ytp-caption-segment`)
  - read `textTracks` and active cues when available
  - read caption track metadata from page context through `page-bridge.ts`
  - intercept YouTube `timedtext` network responses from page context
  - parse transcript payloads into a subtitle timeline
  - extrapolate playback time when the YouTube tab is backgrounded
- Desktop can now consume both immediate subtitle updates and subtitle timeline data.
- Overlay IPC bootstrap was previously failing because handlers were registered too late; that was fixed by registering IPC before `overlayWindow.load()`.

## Important Desktop Behavior
- Desktop overlay logic is centered in `apps/desktop/src/main/main.ts` and `apps/desktop/src/main/overlay-window.ts`.
- `setOverlayVisible()` should be the main path for show/hide behavior. Do not reintroduce ad hoc `updateConfig({ overlayVisible: ... })` flows without checking reveal behavior.
- On launch, the app forces `overlayVisible: true` so a previously hidden overlay does not make the app appear "not running".
- Overlay visibility on Linux is handled more reliably by keeping the window alive and shrinking it when logically hidden, instead of relying only on native `hide()/show()`.
- `Ctrl+Alt+Y` currently toggles a move mode:
  - enter move mode
  - drag the overlay
  - exit with `Ctrl+Alt+Y` again, `Esc`, or blur
- Renderer has an `X` button that hides the overlay. Re-show should go through desktop logic, not renderer-local hacks.

## Hotkeys
- Default hotkeys:
  - `Ctrl+Alt+Space`: play/pause
  - `Ctrl+Backtick`: play/pause the active Linux media session
  - `Ctrl+Alt+Left`: seek back
  - `Ctrl+Alt+Right`: seek forward
  - `Ctrl+Alt+S`: show/hide overlay
  - `Ctrl+Alt+I`: toggle interaction mode
  - `Ctrl+Alt+Y`: toggle move-overlay mode
  - `Ctrl+Alt+Up` / `Ctrl+Alt+Down`: font size
- Hotkeys are registered in `apps/desktop/src/main/hotkeys.ts`.
- `main.ts` uses cooldown guards to avoid auto-repeat loops on toggle actions.
- Hotkeys should only be re-registered when the hotkey mapping changes. A fingerprint guard was added for this.
- `Ctrl+Backtick` is implemented in `apps/desktop/src/main/system-media.ts`.
  - preferred backend: `playerctl play-pause`
  - fallback backend: MPRIS via `dbus-send`
  - last-resort backend: `xdotool key XF86AudioPlay`

## Linux and Windowing
- This project is materially more reliable on true `X11` than on `Wayland`.
- The desktop app defaults to `ozone-platform=x11` on Linux unless `YSC_FORCE_WAYLAND=1` is set.
- User-observed behavior on `Wayland + Unity`:
  - `globalShortcut.register()` reported success
  - hotkeys triggered while the desktop app was focused
  - the same hotkeys produced no trigger logs once focus moved to another app
- Treat that as a compositor/session limitation first, not as an app logic bug.
- If hotkeys or always-on-top fail under Linux, verify `echo $XDG_SESSION_TYPE`. Prefer testing under a real `x11` session before changing code again.

## Logging to Use During Debugging
- Desktop logs:
  - `[desktop:bootstrap]`
  - `[desktop:hotkeys]`
  - `[desktop:overlay]`
  - `[desktop:ws]`
- Extension logs:
  - `[yt-sub-companion:extension]`
- Overlay renderer errors:
  - `[yt-sub-companion:overlay]`

## User Environment Notes
- The user's machine had two `node` binaries:
  - `/usr/local/bin/node` -> older version
  - `/snap/bin/node` -> newer version
- If dependency installation behaves inconsistently, check `which -a node`, `which -a npx`, and `echo $PATH`.
- The repo currently targets `Node.js >= 20.12.0`, but local PATH confusion can still affect Electron installs and scripts.

## Current Known State
- Subtitle overlay is working.
- Background subtitle progression was implemented through transcript timeline fallback plus playback-time extrapolation.
- Move-overlay mode is working after the recent desktop changes.
- Show/hide overlay logic is improved, but reliable global re-show from another app still depends on whether the Linux session actually delivers global shortcuts.
- If a future task is about "hotkey does not work when another app is focused", reproduce under real `X11` before making more code changes.

## Good Next Checks Before Large Changes
- Read:
  - `README.md`
  - `apps/desktop/src/main/main.ts`
  - `apps/desktop/src/main/overlay-window.ts`
  - `apps/extension/src/content.ts`
  - `apps/extension/src/subtitle-reader.ts`
  - `apps/extension/src/page-bridge.ts`
- If touching desktop runtime behavior, restart `pnpm dev:desktop`. The current dev flow does not hot-restart Electron for all main-process changes.
