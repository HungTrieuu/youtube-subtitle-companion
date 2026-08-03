# AI Context

Read this before large code changes. Keep it short, current, and path-accurate.

## System Flow

```text
YouTube -> Extension -> WebSocket -> Electron Main -> preload/IPC -> Renderer
Renderer -> preload/IPC -> Electron Main -> WebSocket -> Extension -> YouTube
```

## Module Map

| Area | Responsibility | Public entry/API | Read these files when changing... |
| --- | --- | --- | --- |
| Shared protocol | WebSocket message schemas, helpers, capability negotiation, reconnect, speech commands | `packages/shared/src/index.ts` | `packages/shared/src/protocol.ts`, `schemas.ts`, `source-selection.ts` |
| Extension subtitles | Read captions, transcripts, fallback order, transcript parsing | `apps/extension/src/subtitle-reader.ts` | `apps/extension/src/subtitles/subtitle-reader.ts`, `transcript-parsers.ts`, `caption-track-selector.ts`, `dom-caption-source.ts`, `text-track-source.ts` |
| Extension player control | Read player state and apply incoming video commands | `apps/extension/src/youtube-player.ts` | `youtube-player.ts`, `content.ts` |
| Extension background | Chrome-only helpers: `chrome.tts`, content-script ping, reinjection on already-open YouTube tabs | `apps/extension/src/background.ts` | `background.ts`, `content.ts`, `manifest.json` |
| Desktop extension bridge | WebSocket transport, active source choice, timeline subtitle interpolation, command ACK | `apps/desktop/src/main/websocket-server.ts` | `apps/desktop/src/main/extension-bridge/*` |
| Desktop runtime state | Authoritative shared state for tray, renderer sync, hotkeys, bridge | `apps/desktop/src/main/state/desktop-runtime-store.ts` | `desktop-runtime-store.ts`, `sync-runtime-state.ts`, `actions/app-actions.ts` |
| Electron bootstrap | Create context, register lifecycle, cleanup | `apps/desktop/src/main/main.ts` | `bootstrap/register-app-lifecycle.ts`, `create-app-context.ts`, `shutdown.ts` |
| IPC / preload | Typed renderer ↔ main bridge for overlay, learning, dictionary, and subtitle speech | `apps/desktop/src/common/ipc.ts` and `apps/desktop/src/preload/preload.ts` | `common/ipc.ts`, `common/types.ts`, `common/learning.ts`, `common/tts.ts`, `main/ipc/register-ipc-handlers.ts` |
| Overlay window | Native Electron overlay behavior, interaction mode, popup reserve bounds | `apps/desktop/src/main/overlay-window.ts` | `overlay-window.ts` |
| Overlay renderer | Overlay DOM, status text, popup word lookup, sentence translation, subtitle speech | `apps/desktop/src/renderer/overlay.ts` | `overlay.ts`, `overlay-app.ts`, `interaction-state.ts` |
| Dictionary | Word lookup, sentence translation cache, provider timeout policy | `apps/desktop/src/main/dictionary.ts` | `dictionary.ts`, `common/learning.ts` |
| Subtitle speech | Validate speech requests, capability-check `speech.tts`, dispatch `speak_text` to the active extension | `apps/desktop/src/main/tts-service.ts` | `tts-service.ts`, `common/tts.ts`, `main/ipc/register-ipc-handlers.ts` |
| Learning storage | Save/list/delete local JSON learning items with queued writes and optional translations | `apps/desktop/src/main/learning-store.ts` | `learning-store.ts`, `common/learning.ts` |
| Saved words UI | List saved items, render stored translations, delete items | `apps/desktop/src/main/saved-words-window.ts` | `saved-words-window.ts`, `renderer/saved-words.ts` |
| Config / hotkeys | Persisted config, hotkey registration, tray actions | `apps/desktop/src/main/config.ts` | `config.ts`, `config-store.ts`, `hotkeys.ts`, `tray.ts` |

## State Ownership
- Electron Main owns shared runtime state used by tray, hotkeys, overlay window, IPC initial state, and WebSocket bridge.
- Renderer owns ephemeral UI state only: popup loading/result, current DOM selection, in-flight speech state, and visual timers.
- Extension content scripts own page-scoped YouTube state: player, caption tracks, transcript observation, and page bridge coordination.
- Extension background owns browser-only helpers such as `chrome.tts` and content-script reinjection.
- `DesktopConfigStore` owns persisted settings.
- `LearningStore` owns persisted saved-word JSON.
- Do not create another authoritative copy of the same state in a different layer.

## Contracts
- Cross-workspace protocol is in `packages/shared/src/schemas.ts` and `protocol.ts`, including optional capability-gated commands such as `speak_text`.
- Desktop IPC payloads are in `apps/desktop/src/common/ipc.ts`, `types.ts`, `learning.ts`, and `tts.ts`.
- Runtime schemas are the source of truth. Infer TypeScript types from schemas whenever possible.
- Validate every `unknown` payload at the boundary before calling domain logic.
- Learning JSON keeps backward-compatible optional fields for `wordTranslation` and `sentenceTranslation`.

## Change Recipes
- Add an Extension → Desktop message:
  Read `packages/shared/src/schemas.ts`, `protocol.ts`, then `apps/extension/src/content.ts` and `apps/desktop/src/main/extension-bridge/extension-bridge.ts`. Run `pnpm test`.
- Add a Renderer → Main IPC call:
  Read `apps/desktop/src/common/ipc.ts`, the related schema module in `apps/desktop/src/common/*`, `preload/preload.ts`, and `main/ipc/register-ipc-handlers.ts`. Run `pnpm typecheck`.
- Add a config field:
  Read `apps/desktop/src/common/types.ts`, `main/config.ts`, `config-store.ts`, and any renderer consumer. Run `pnpm test && pnpm typecheck`.
- Add a subtitle source or parser:
  Read `apps/extension/src/subtitles/*` and `apps/extension/tests/transcript-parser.test.ts`. Run `pnpm test`.
- Add an overlay action:
  Read `apps/desktop/src/main/actions/app-actions.ts`, `tray.ts`, `common/ipc.ts`, and `renderer/overlay-app.ts`. Restart `pnpm dev:desktop`.
- Add a learning item field:
  Read `apps/desktop/src/common/learning.ts`, `main/learning-store.ts`, `renderer/overlay-app.ts`, and `renderer/saved-words.ts`. Keep JSON backward-compatible and prefer optional fields. Run `pnpm test`.
- Add a dictionary provider:
  Read `apps/desktop/src/main/dictionary.ts` and `common/learning.ts`. Keep provider/network logic separate from IPC, and implement `translateText` separately from word lookup when sentence translation is supported.
- Add subtitle speech / TTS:
  Read `packages/shared/src/schemas.ts`, `protocol.ts`, `apps/desktop/src/common/tts.ts`, `main/tts-service.ts`, `main/ipc/register-ipc-handlers.ts`, `apps/extension/src/background.ts`, and `apps/extension/src/content.ts`. Run `pnpm test && pnpm typecheck`.

## Invariants
- WebSocket only binds `127.0.0.1`.
- Renderer has no Node access and preload must expose a narrow typed API only.
- Do not expose raw `ipcRenderer`.
- Validate every payload crossing process boundaries.
- Learning writes must stay serialized and atomic.
- `speech.tts` must be capability-gated before dispatching `speak_text`.
- YouTube SPA navigation must keep working after subtitle-reader changes.
- Extension reload should keep content-script reinjection and stale-context recovery working on already-open YouTube tabs.
- Protocol ACK must fall back safely when an older extension does not advertise `player.command-ack`.
- Do not change learning JSON shape, optional translation fields, or app data path without compatible migration.

## Validation Commands
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`
