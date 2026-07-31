# Project Knowledge

## Commands
- Install: `pnpm install`
- Dev all: `pnpm dev`
- Dev desktop only: `pnpm dev:desktop`
- Dev extension only: `pnpm dev:extension`
- Validate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- Package desktop: `pnpm package:desktop`
- Package Linux AppImage: `pnpm package:linux`
- Package Windows installer: `pnpm package:win`

## Working Rules
- Start with `git status`, read `README.md`, and read [docs/AI_CONTEXT.md](docs/AI_CONTEXT.md).
- Do not reset, revert, or overwrite unrelated local changes.
- Source local hiện tại là nguồn sự thật nếu lệch với GitHub hoặc packaged output.
- Keep TypeScript strict. Do not use `any` to bypass contracts.
- Validate external input at the boundary with schemas before domain logic runs.
- Restart `pnpm dev:desktop` after changing `apps/desktop/src/main/*` or `apps/desktop/src/preload/*`.

## Module Boundaries
- `packages/shared`: cross-workspace protocol, schemas, source-selection, reconnect, player helpers.
- `apps/desktop/src/common`: desktop IPC and renderer/main shared contracts.
- `apps/desktop/src/main`: Electron main, runtime state, bridge, tray, persistence, IPC handlers.
- `apps/desktop/src/preload`: typed bridge only. Never expose raw `ipcRenderer`.
- `apps/desktop/src/renderer`: overlay and saved-words UI only. Never import `main/*`.
- `apps/extension/src`: YouTube page integration, subtitle extraction, websocket client. Never import desktop code.

## Main / Renderer / Extension Rules
- Electron Main is the source of truth for shared desktop runtime state.
- Renderer keeps ephemeral UI state only: popup loading, DOM anchor, scroll, transient selection.
- Extension keeps page-scoped player and subtitle state only.
- Keep transport, business logic, state, and UI in separate modules where possible.
- Use shared actions for the same behavior across tray, hotkeys, and IPC.
- WebSocket must stay on `127.0.0.1`.
- Renderer must stay sandboxed with no Node access.

## Contracts
- Extension ↔ Desktop protocol lives in `packages/shared/src/*`.
- Desktop IPC contracts live in `apps/desktop/src/common/*`.
- Runtime schema is the source of truth. Infer TypeScript types from schemas where practical.
- Learning JSON shape and app data paths must stay backward-compatible.

## Validation Checklist
- `git diff --check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- If packaging changes were touched, validate the packaging config and package command if the environment supports it.
