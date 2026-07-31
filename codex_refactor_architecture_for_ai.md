# Codex Goal — Refactor kiến trúc để dễ bảo trì và tối ưu context cho AI

Bạn đang đứng **trong thư mục project local hiện tại** của `youtube-subtitle-companion`.

Đây là task refactor kiến trúc trên source đang phát triển, không phải tạo project mới.

## Nguyên tắc bắt buộc

- Trước tiên chạy `git status` và đọc `AGENTS.md`, `README.md`, workspace config, package scripts và các entry point.
- Không clone repo.
- Không `git reset`, không checkout/revert file của người dùng, không xóa thay đổi local không liên quan.
- Không thay đổi hành vi sản phẩm ngoài những điểm được mô tả rõ trong task.
- Không đổi format dữ liệu learning hiện tại nếu không có migration tương thích.
- Không đưa React/Vue/Redux hoặc framework UI mới vào project.
- Không tạo backend, database hoặc cloud service.
- Không nâng dependency hàng loạt nếu không cần thiết.
- Giữ TypeScript strict; không dùng `any` để né type.
- Sau khi lập kế hoạch ngắn, **thực thi liên tục toàn bộ task**, không dừng để chờ xác nhận.
- Refactor theo từng phase nhỏ; sau mỗi phase chạy test/typecheck liên quan trước khi sang phase tiếp theo.
- Nếu source local khác nhánh GitHub, source local là nguồn sự thật.

---

# Mục tiêu chính

Tái cấu trúc project để:

1. Mỗi file/module có một trách nhiệm rõ ràng.
2. AI ở các task sau không cần đọc các file 500–1.100 dòng để hiểu một thay đổi nhỏ.
3. Có một tài liệu context ngắn, chính xác, chỉ rõ:
   - hệ thống chạy thế nào;
   - state thuộc về đâu;
   - contract nằm ở đâu;
   - muốn sửa tính năng nào thì đọc file nào.
4. Contract runtime và TypeScript dùng chung một nguồn định nghĩa.
5. Transport, business logic, state và UI không bị trộn lẫn.
6. Có test bảo vệ các luồng quan trọng trước các refactor tiếp theo.
7. Build kiểm tra source được tách khỏi đóng gói installer.

## Kết quả mong muốn cho task AI sau này

Một AI mới chỉ cần đọc tối đa:

```text
AGENTS.md
docs/AI_CONTEXT.md
public API hoặc index của module cần sửa
các file trực tiếp liên quan đến task
```

Không cần đọc toàn bộ `main.ts`, `overlay.ts`, `subtitle-reader.ts` hoặc `websocket-server.ts`.

---

# Kiến trúc đích

Giữ nguyên kiến trúc cấp cao:

```text
YouTube
  ↕
Chrome Extension
  ↕ localhost WebSocket
Electron Main
  ↕ typed IPC through preload
Overlay / Saved Words renderers
```

Giữ nguyên workspace:

```text
apps/extension
apps/desktop
packages/shared
```

Không viết lại toàn bộ ứng dụng. Tách dần các file hiện có, giữ public API ổn định khi hợp lý.

---

# Phase 0 — Baseline và safety net

Trước khi chỉnh code:

1. Chạy:
   - `git status`;
   - lint;
   - typecheck;
   - test;
   - build compile phù hợp với repo.
2. Ghi nhận lỗi baseline nếu đã tồn tại.
3. Xác định:
   - entry point Electron Main;
   - preload;
   - overlay renderer;
   - saved words renderer;
   - extension content/background/page bridge;
   - protocol và schemas;
   - config;
   - learning storage;
   - dictionary;
   - test hiện có.
4. Không package `.exe`/`.AppImage` ở bước baseline trừ khi build script hiện tại bắt buộc.
5. Nếu thiếu test cho behavior cần refactor, bổ sung characterization test trước.

---

# Phase 1 — Tạo context ngắn dành cho AI

## 1.1 Cập nhật `AGENTS.md`

Giữ `AGENTS.md` ngắn và có tính chỉ dẫn, không biến nó thành tài liệu kiến trúc dài.

Nội dung cần có:

- commands chuẩn;
- quy tắc không phá local changes;
- module boundaries;
- nơi đặt contract/schema;
- yêu cầu validation tại boundary;
- quy tắc Main/Renderer/Extension;
- checklist trước khi hoàn thành;
- link sang `docs/AI_CONTEXT.md`.

Mục tiêu mềm: không quá khoảng 150–200 dòng.

## 1.2 Tạo `docs/AI_CONTEXT.md`

Đây là tài liệu đầu tiên AI phải đọc ở task sau. Nội dung phải ngắn, ổn định, không copy code dài.

Bắt buộc gồm:

### System flow

```text
YouTube -> Extension -> WebSocket -> Electron Main -> preload/IPC -> Renderer
Renderer -> preload/IPC -> Electron Main -> WebSocket -> Extension -> YouTube
```

### Module map

Dùng bảng ngắn với các cột:

```text
Area | Responsibility | Public entry/API | Read these files when changing...
```

Ít nhất có:

- shared protocol/contracts;
- extension subtitle extraction;
- extension player control;
- desktop extension bridge;
- desktop state;
- overlay window;
- overlay renderer;
- dictionary;
- learning storage;
- saved words;
- config/hotkeys;
- IPC/preload.

### State ownership

Nêu rõ:

- Electron Main là source of truth cho runtime state dùng chung.
- Renderer chỉ giữ ephemeral UI state như popup loading, selected DOM anchor, scroll.
- Extension giữ state gắn với YouTube page/player.
- Config store giữ persisted settings.
- Learning store giữ persisted learning data.
- Không tạo thêm bản sao authoritative của cùng một state ở nhiều tầng.

### Contracts

Nêu:

- cross-workspace protocol nằm trong `packages/shared`;
- desktop IPC contracts nằm ở module common/contracts tương ứng;
- schema runtime là nguồn sự thật;
- TypeScript type phải được infer từ schema khi có thể.

### Change recipes

Viết các mục rất ngắn:

- thêm message Extension → Desktop;
- thêm IPC Renderer → Main;
- thêm config;
- thêm subtitle source/parser;
- thêm action overlay;
- thêm field learning item;
- thêm provider dictionary.

Mỗi recipe chỉ rõ file/module cần đọc và test cần chạy.

### Invariants

Ví dụ:

- WebSocket chỉ bind localhost.
- Renderer không có Node access.
- Không expose toàn bộ `ipcRenderer`.
- Mọi dữ liệu ngoài process phải validate.
- Click từ chỉ hoạt động khi overlay active và player paused.
- Learning write phải serialized và atomic.
- Extension navigation phải chịu được YouTube SPA.

### Validation commands

Chỉ ghi các command chính xác sau khi đã xác minh từ package scripts.

## 1.3 Chống tài liệu lỗi thời

- Không lặp cùng một thông tin chi tiết ở README, AGENTS và AI_CONTEXT.
- README dành cho người dùng/chạy app.
- AGENTS dành cho quy tắc làm việc.
- AI_CONTEXT dành cho kiến trúc và code map.
- Khi đổi path/module trong task này, cập nhật AI_CONTEXT ngay.

---

# Phase 2 — Tách Electron Main bootstrap

File `apps/desktop/src/main/main.ts` hiện đang giữ quá nhiều trách nhiệm. Tách để `main.ts` chỉ còn nhiệm vụ bootstrap và lifecycle cấp cao.

Kiến trúc có thể tương đương:

```text
apps/desktop/src/main/
├── main.ts
├── app-context.ts
├── bootstrap/
│   ├── create-app-context.ts
│   ├── register-app-lifecycle.ts
│   └── shutdown.ts
├── ipc/
│   ├── register-ipc-handlers.ts
│   ├── overlay-ipc.ts
│   ├── player-ipc.ts
│   ├── learning-ipc.ts
│   └── dictionary-ipc.ts
├── actions/
│   ├── overlay-actions.ts
│   ├── player-actions.ts
│   └── config-actions.ts
└── menus/
    └── overlay-context-menu.ts
```

Không bắt buộc dùng đúng tên nếu convention local phù hợp hơn.

## Yêu cầu

- Tạo một `AppContext` có typed dependencies thay cho các biến global rời rạc.
- Không dùng service locator động.
- Dependency được tạo tại composition root.
- IPC handler chỉ:
  1. validate input;
  2. gọi service/action;
  3. map kết quả;
  4. log lỗi phù hợp.
- Không đặt business logic dài trong IPC callback.
- Hotkey callback gọi action dùng chung; không duplicate logic với tray/context menu.
- Tray, hotkey và IPC phải dùng cùng action/service cho cùng một hành vi.
- Shutdown cleanup tập trung, idempotent.
- Giữ nguyên behavior hiện tại.

## Mục tiêu kích thước mềm

- `main.ts`: khoảng dưới 150 dòng.
- File đăng ký IPC tổng: ưu tiên dưới 250–300 dòng; tách theo domain nếu lớn.
- Không chia file chỉ để đạt số dòng; boundary trách nhiệm quan trọng hơn.

---

# Phase 3 — Central runtime state trong Electron Main

Tạo một store nhỏ, typed, không cần Redux.

Có thể tương đương:

```ts
interface DesktopRuntimeState {
  config: AppConfig;
  overlay: OverlayUiState;
  connection: OverlayConnectionState;
  player: PlayerStateMessage | null;
  subtitle: SubtitleUpdateMessage | null;
  activeSource: ActiveSourceSummary | null;
}
```

API tối thiểu:

```ts
getState(): Readonly<DesktopRuntimeState>
update(updater): void
subscribe(listener): unsubscribe
```

Hoặc action/reducer nhẹ nếu phù hợp hơn.

## Quy tắc

- Main là source of truth cho state được chia sẻ giữa window, tray, hotkey và extension bridge.
- Không bắt renderer trở thành source of truth cho active/move/click-through mode.
- `OverlayWindowController` thực thi window behavior nhưng state mode authoritative nằm ở Main store hoặc được đồng bộ duy nhất qua một action.
- Tray render từ snapshot state, không tự ghép config và runtime từ nhiều nguồn.
- Khi player/subtitle/connection đổi, update store rồi notify subscribers.
- Tránh chuỗi gọi thủ công lặp lại kiểu:
  - `sendConfig`;
  - `sendUiState`;
  - `refreshTray`;
  ở nhiều nơi.
- Có selector hoặc coordinator nhỏ để đồng bộ state sang renderer/tray.
- Renderer vẫn được giữ state UI cục bộ không cần chia sẻ.

Bổ sung unit test cho:

- transition overlay mode;
- player state update;
- subtitle/source update;
- tray/renderer subscriber nhận snapshot đúng;
- unsubscribe;
- không mutation state bên ngoài.

---

# Phase 4 — Tách overlay renderer

Tách `apps/desktop/src/renderer/overlay.ts` thành các module theo trách nhiệm, không thêm framework.

Kiến trúc có thể tương đương:

```text
renderer/
├── overlay.ts
├── overlay-app.ts
├── state/
│   ├── overlay-state.ts
│   └── overlay-reducer.ts
├── subtitle/
│   ├── subtitle-renderer.ts
│   ├── subtitle-tokenizer.ts
│   └── karaoke-controller.ts
├── learning/
│   ├── learning-controller.ts
│   ├── word-popup-controller.ts
│   └── word-selection.ts
├── ui/
│   ├── toast-controller.ts
│   ├── connection-status.ts
│   └── dom.ts
└── ipc/
    └── bind-overlay-events.ts
```

## Boundary

- `overlay.ts`: lấy DOM root, tạo app/controller, start.
- `overlay-app`: orchestration.
- `subtitle-renderer`: render cue/token/segments; không gọi IPC.
- `karaoke-controller`: tính và cập nhật highlight.
- `word-selection`: normalize token và điều kiện được chọn.
- `word-popup-controller`: popup positioning, open/close/loading/result.
- `learning-controller`: lookup/save orchestration qua typed preload API.
- `toast-controller`: chỉ quản lý toast.
- `bind-overlay-events`: map preload events thành action/state update.

## Yêu cầu

- Giữ nguyên DOM/CSS behavior hiện tại.
- Không phá karaoke, resize, alignment, opacity, double-click seek, popup, toast.
- Không để module UI gọi trực tiếp `window` API ở nhiều nơi; inject một typed bridge/API khi hợp lý.
- Mọi event listener phải có lifecycle cleanup rõ.
- Không để circular dependency.
- Public API của mỗi module nhỏ và explicit.
- Không tạo barrel export `export *` tràn lan; export có chủ đích.

## Test

- tokenizer/word normalization;
- điều kiện Active + Paused;
- popup lifecycle;
- cue đổi đóng popup;
- player resume đóng popup;
- dictionary loading/error/result;
- save success/duplicate/error;
- reducer/state transition nếu có.

---

# Phase 5 — Tách extension subtitle extraction

Tách `apps/extension/src/subtitle-reader.ts` nhưng giữ entry/public behavior hiện tại.

Kiến trúc có thể tương đương:

```text
apps/extension/src/subtitles/
├── subtitle-reader.ts
├── subtitle-coordinator.ts
├── subtitle-context.ts
├── sources/
│   ├── dom-caption-source.ts
│   ├── text-track-source.ts
│   └── transcript-source.ts
├── parsers/
│   ├── json3-parser.ts
│   ├── srv3-parser.ts
│   ├── xml-parser.ts
│   └── vtt-parser.ts
├── caption-track-selector.ts
├── cue-normalizer.ts
└── transcript-cache.ts
```

Có thể dùng interface tương đương:

```ts
interface SubtitleSource {
  readonly id: string;
  read(context: SubtitleContext): Promise<SubtitleSourceResult | null>;
}
```

## Boundary

- Source chịu trách nhiệm lấy raw data hoặc cue từ một nguồn.
- Parser chỉ parse input → typed cues; không đọc DOM/network.
- Selector chỉ chọn caption track.
- Normalizer chỉ chuẩn hóa cue/segment.
- Coordinator quyết định fallback/order/retry.
- Cache không trộn với parser.
- Entry `subtitle-reader` giữ API dùng bởi content script để giảm thay đổi call site.

## Yêu cầu

- Giữ nguyên thứ tự ưu tiên/fallback hiện tại.
- Không làm giảm khả năng chạy khi YouTube background throttling.
- Không thay đổi output protocol không cần thiết.
- Parser phải test độc lập bằng fixture nhỏ.
- Các fixture lớn không inline trong test nếu làm file khó đọc; đặt trong `tests/fixtures`.
- Không đọc toàn bộ YouTube internals ở nhiều source; dùng context/helper chung.
- SPA navigation cleanup/reinitialize phải rõ.

---

# Phase 6 — Tách WebSocket transport khỏi domain logic

Tách `apps/desktop/src/main/websocket-server.ts`.

Kiến trúc có thể tương đương:

```text
main/extension-bridge/
├── extension-bridge.ts
├── websocket-transport.ts
├── extension-client-registry.ts
├── active-source-manager.ts
├── subtitle-timeline-engine.ts
├── command-dispatcher.ts
└── bridge-events.ts
```

Có thể giữ `LocalWebSocketServer` làm façade mỏng hoặc migration adapter để tránh sửa call site quá rộng.

## Boundary

- `websocket-transport`: listen/connect/disconnect/send raw text; không biết subtitle timeline.
- `extension-client-registry`: clients, metadata, last seen, capabilities.
- `active-source-manager`: chọn tab/source active.
- `subtitle-timeline-engine`: timeline, cue lookup, local clock interpolation.
- `command-dispatcher`: gửi command, requestId, ACK/timeout.
- `extension-bridge`: façade typed cho Main.

## Yêu cầu

- Transport không import renderer/window.
- Timeline engine test được không cần WebSocket.
- Active source manager sử dụng shared source-selection logic nếu đã có.
- Disconnect source active phải chọn fallback đúng.
- Không duplicate state giữa bridge và Main store; bridge phát typed events, Main cập nhật state.
- Timer phải cleanup khi shutdown.
- Không leak promise/request pending khi client disconnect.

---

# Phase 7 — Chuẩn hóa contracts và validation bằng schema

Hiện có chỗ dùng Zod, có chỗ dùng type guard thủ công. Chuẩn hóa:

## Quy tắc nguồn sự thật

```ts
export const requestSchema = z.object(...);
export type Request = z.infer<typeof requestSchema>;
```

Không duy trì cùng lúc interface thủ công và schema tương đương, trừ khi có lý do được ghi rõ.

## Phạm vi

- Extension ↔ Desktop protocol: `packages/shared`.
- Renderer ↔ Electron Main IPC: đặt ở desktop common/contracts hoặc module chung phù hợp.
- Learning save/delete requests.
- Dictionary lookup request/result nếu qua IPC.
- Popup/context menu metrics.
- Config patch/update payload.
- Saved words actions.
- Mọi payload `unknown` từ process khác.

## Yêu cầu

- Parse/validate tại boundary.
- Code domain bên trong nhận typed value đã validate.
- Trả lỗi có cấu trúc, không throw raw validation details ra UI.
- Không expose Zod object vào renderer bundle nếu build hiện tại không phù hợp; khi đó đặt schema ở common package dùng được cả hai phía.
- Không duplicate channel name string; giữ một registry typed.
- Preload chỉ expose API cụ thể, không expose `ipcRenderer`.

Bổ sung tests cho valid/invalid payload và backward compatibility.

---

# Phase 8 — Protocol ACK và capability negotiation

Mở rộng protocol theo hướng backward-compatible.

## Hello/capabilities

Extension hello nên hỗ trợ optional:

```ts
capabilities?: string[];
```

Ví dụ:

```text
subtitle.current
subtitle.timeline
player.toggle
player.seek
player.rate
video.metadata
player.command-ack
```

Không hardcode logic rải rác; định nghĩa capability constants/type trong shared.

## Player command

Thêm `requestId` vào command mới hoặc optional để tương thích client cũ.

Thêm message result tương đương:

```ts
type PlayerCommandResultMessage = {
  type: "player.command_result";
  requestId: string;
  success: boolean;
  error?: string;
  timestamp: number;
};
```

## Behavior

- Nếu client khai báo `player.command-ack`, dispatcher chờ ACK với timeout.
- Nếu client cũ không có capability, fallback về behavior fire-and-forget hiện tại.
- Pending request được clear khi:
  - nhận ACK;
  - timeout;
  - client disconnect;
  - app shutdown.
- Không để ACK làm UI treo.
- Log phân biệt:
  - send failed;
  - timeout;
  - extension rejected;
  - success.
- Duy trì API đơn giản cho action layer; action không xử lý raw socket message.

## Test

- capability parse;
- client cũ không capabilities;
- command ACK success;
- ACK failure;
- timeout;
- disconnect while pending;
- ACK sai requestId bị bỏ qua an toàn.

---

# Phase 9 — Learning và dictionary module boundaries

Các implementation hiện có cần giữ behavior tốt như queue, atomic write, cache và timeout, nhưng tách public API rõ.

Có thể tương đương:

```text
main/learning/
├── learning-store.ts
├── learning-schema.ts
├── learning-path.ts
└── index.ts

main/dictionary/
├── dictionary-service.ts
├── dictionary-provider.ts
├── free-dictionary-provider.ts
├── dictionary-cache.ts
└── index.ts
```

## Learning

- Store không biết IPC/UI.
- Path/date logic tách và test được.
- Atomic write giữ nguyên.
- Queue/serialization giữ nguyên.
- Duplicate rule nằm một chỗ.
- Corrupt file behavior rõ và có test.
- Public API nhỏ: save/list/delete hoặc đúng chức năng hiện tại.

## Dictionary

- Provider interface tách khỏi service.
- Network provider chỉ fetch/parse.
- Service chịu cache, in-flight dedupe, timeout policy.
- Main IPC chỉ gọi service.
- Không thêm provider thứ hai nếu không cần.
- Không đổi provider hiện tại nếu đang hoạt động ổn.

---

# Phase 10 — Build, test và CI

## 10.1 Tách compile khỏi package

Root scripts phải phân biệt:

```text
build       = compile/bundle source để xác minh code
package:*   = tạo installer/AppImage/exe
```

Tên cụ thể theo convention repo, ví dụ:

```json
{
  "scripts": {
    "build": "...shared...extension...desktop app...",
    "package:desktop": "...electron-builder...",
    "package:win": "...",
    "package:linux": "..."
  }
}
```

Yêu cầu:

- `pnpm build` không tự tạo installer nặng.
- Các command package cũ được giữ alias nếu tránh phá workflow.
- README cập nhật command chính xác.
- Không thay đổi output path không cần thiết.

## 10.2 Integration tests

Tạo integration test không cần Chrome thật:

```text
Fake Extension WebSocket client
  -> hello
  -> player.state
  -> subtitle.timeline/update
  -> ExtensionBridge
  -> Main state/event subscriber
```

Test tối thiểu:

- connect/hello;
- active source selection;
- subtitle/current player propagation;
- timeline local interpolation;
- multiple tabs;
- disconnect fallback;
- command route đúng client;
- command ACK nếu supported.

Renderer test có thể dùng DOM environment hiện có; không bắt buộc Playwright nếu repo chưa có.

## 10.3 GitHub Actions

Tạo `.github/workflows/ci.yml`:

- install đúng Node/pnpm từ project;
- `pnpm install --frozen-lockfile`;
- lint;
- typecheck;
- test;
- build compile;
- không tạo installer trong CI mặc định.

Có thể dùng cache pnpm nếu cấu hình đơn giản và ổn định.

---

# Phase 11 — README và security documentation

Cập nhật README để đúng với sản phẩm hiện tại.

Sửa thông tin cũ tương đương:

```text
No ... subtitle history storage is used.
```

thành nội dung chính xác:

- Không có cloud subtitle history/analytics/backend.
- Chỉ learning items do người dùng chủ động lưu được ghi local dưới dạng JSON.
- Tra nghĩa có thể gửi từ được chọn tới dictionary provider bên ngoài.
- WebSocket chỉ bind `127.0.0.1`.
- Renderer sandbox/security config được giữ đúng.

README chỉ giữ:

- mô tả sản phẩm;
- quick start;
- commands;
- hotkeys;
- learning flow;
- storage location;
- security/privacy;
- troubleshooting;
- link `docs/AI_CONTEXT.md` trong phần Development Architecture nếu phù hợp.

Không đưa internal code map dài vào README.

---

# Phase 12 — Enforce module boundaries nhẹ

Cấu hình ESLint `no-restricted-imports` hoặc cơ chế tương đương để ngăn các dependency sai rõ ràng:

- renderer không import `main/*`;
- main không import renderer implementation;
- extension không import desktop;
- shared không import apps;
- domain/service không import UI;
- parser không import network/DOM nếu parser phải pure.

Không tạo rule quá phức tạp làm developer khó làm việc.

Bổ sung architecture rule vào `AGENTS.md` và `AI_CONTEXT.md`.

---

# Quy chuẩn tối ưu token cho AI

Áp dụng các nguyên tắc sau trong code mới/refactor:

1. **Entry point mỏng**  
   Entry file chỉ compose/start, không chứa business logic.

2. **Một trách nhiệm chính mỗi file**  
   Không tách file vụn chỉ có 5 dòng nếu không tạo boundary có ý nghĩa.

3. **Public API nhỏ**  
   Mỗi module có một entry hoặc export explicit; tránh yêu cầu AI đọc toàn folder để tìm API.

4. **Tên file nói đúng trách nhiệm**  
   Tránh tên chung chung như `utils.ts`, `helpers.ts`, `manager.ts` nếu có thể đặt tên domain cụ thể.

5. **Không duplicate type/schema/state**  
   Một nguồn sự thật cho contract và authoritative state.

6. **Pure function cho logic khó**  
   Parser, selection, normalization, duplicate detection, timeline calculation nên là pure và có unit test.

7. **Dependency direction rõ**  
   UI → application action/service → domain/persistence/transport; không import ngược.

8. **Comment giải thích “why”, không kể lại code**.

9. **Không file khổng lồ**  
   Mục tiêu mềm:
   - entry/bootstrap: dưới ~150–200 dòng;
   - controller/service: ưu tiên dưới ~300–400 dòng;
   - parser/provider: ưu tiên dưới ~250–300 dòng.
   Nếu vượt, đánh giá trách nhiệm; không chia giả tạo chỉ để đạt số dòng.

10. **Context doc ngắn và cập nhật**  
    `docs/AI_CONTEXT.md` phải đủ để định tuyến task, không phải tài liệu mô tả từng function.

11. **Test gần logic**  
    Test path/name giúp AI tìm nhanh module liên quan; dùng fixture riêng khi dữ liệu dài.

12. **Không export nội bộ không cần thiết**  
    Giảm surface area và giảm số file AI phải xem.

---

# Compatibility và migration

- Giữ config hiện tại và custom hotkey của người dùng.
- Giữ learning JSON hiện tại.
- Giữ IPC/preload API hiện tại khi có thể; nếu đổi, update tất cả consumer trong cùng phase.
- Protocol mới phải nhận được message cũ hợp lệ.
- Extension mới phải hoạt động với desktop mới; nếu hỗ trợ desktop/extension lệch version thì ghi rõ fallback.
- Không đổi port localhost hoặc app data path.
- Không đổi UX/copy ngoài sửa tài liệu hoặc lỗi bắt buộc.
- Không xóa feature hiện có.

---

# Acceptance criteria

Task chỉ được coi là hoàn thành khi:

1. `main.ts` là bootstrap mỏng.
2. `overlay.ts` không còn chứa toàn bộ state/render/popup/learning/IPC logic.
3. `subtitle-reader.ts` được tách thành coordinator, sources và parsers có test.
4. WebSocket transport tách khỏi registry/source/timeline/command logic.
5. Main có runtime state ownership rõ và subscriber/sync path thống nhất.
6. IPC/protocol payload dùng schema làm nguồn sự thật, loại bỏ type guards thủ công tương đương.
7. Capability negotiation và command ACK có fallback client cũ.
8. Learning/dictionary có module boundaries rõ, giữ behavior hiện tại.
9. `pnpm build` chỉ compile/bundle; packaging dùng command riêng.
10. Có integration test fake extension.
11. Có CI lint/typecheck/test/build.
12. README chính xác về local learning data và external dictionary lookup.
13. Có `docs/AI_CONTEXT.md` và `AGENTS.md` ngắn, chính xác.
14. Module boundaries được enforce nhẹ.
15. Không còn circular dependency mới.
16. Tất cả validation pass hoặc lỗi baseline được ghi rõ và không tăng thêm.

---

# Validation cuối

Chạy command thực tế của repo, tối thiểu tương đương:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Ngoài ra chạy package-specific tests/build nếu root script chưa bao phủ.

Không cần tạo `.exe` hoặc `.AppImage` để hoàn thành task, trừ khi có thay đổi trực tiếp vào electron-builder config. Khi đó chỉ chạy packaging nếu môi trường hỗ trợ; nếu không, validate config và ghi rõ.

Kiểm tra thêm:

- `git diff --check`;
- tìm import cycle bằng tool hiện có hoặc inspection phù hợp;
- kiểm tra không có generated output/binary vô tình được commit;
- kiểm tra `git status` để liệt kê đúng file thay đổi;
- kiểm tra AGENTS/AI_CONTEXT không trỏ path sai.

---

# Cách báo cáo cuối

Trả về báo cáo ngắn, không paste toàn bộ source:

## Architecture result

- module mới;
- boundary và state ownership;
- cách future AI định tuyến task.

## Files

- file tạo mới;
- file chỉnh sửa;
- file cũ được giữ làm façade/migration adapter.

## Compatibility

- protocol cũ;
- config;
- learning JSON;
- IPC/preload.

## Validation

Ghi kết quả chính xác cho:

```text
lint
typecheck
unit tests
integration tests
build
git diff --check
```

## Remaining risks

Chỉ nêu vấn đề thực tế còn lại, không ghi TODO chung chung.

## Hướng dẫn task AI sau

Nêu một ví dụ rất ngắn:

```text
Để sửa word popup:
1. đọc AGENTS.md;
2. đọc docs/AI_CONTEXT.md phần Overlay Learning;
3. đọc public API của renderer/learning;
4. sửa module + test tương ứng.
```

Không báo hoàn thành khi chưa chạy validation hoặc còn lỗi mới chưa giải thích.
