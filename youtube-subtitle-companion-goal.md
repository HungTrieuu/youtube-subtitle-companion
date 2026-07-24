# /goal — Build `youtube-subtitle-companion`

## 1. Mục tiêu

Xây dựng một ứng dụng desktop đa nền tảng tên `youtube-subtitle-companion`, chạy trên Windows và Linux.

Ứng dụng cho phép:

- Người dùng mở YouTube trong Chrome/Edge/Brave.
- Video có thể chạy ở tab nền, cửa sổ khác hoặc màn hình khác.
- Subtitle hiện tại của YouTube được hiển thị dưới dạng overlay trong suốt, luôn nổi trên các ứng dụng khác.
- Người dùng có thể thao tác trực tiếp trên overlay để điều khiển video YouTube.
- Double-click vào subtitle để tua lùi 10 giây.
- Có global hotkey để play/pause, tua lùi, tua tiến và bật/tắt overlay.

Không sử dụng OCR trong MVP.

---

## 2. Kiến trúc bắt buộc

Ứng dụng gồm 3 phần:

```text
YouTube
   ↕
Chrome Extension
   ↕ WebSocket localhost
Electron Desktop App
   ↕ IPC
Overlay Renderer
```

### 2.1 Chrome Extension

Chrome Extension chịu trách nhiệm:

- Chạy trên trang `youtube.com/watch`.
- Tìm thẻ HTML `<video>`.
- Đọc subtitle hiện tại từ YouTube.
- Đọc trạng thái video:
  - currentTime
  - duration
  - paused / playing
  - playbackRate
  - video title
  - videoId
- Kết nối tới WebSocket Server do Electron mở tại localhost.
- Gửi subtitle và trạng thái video sang Electron.
- Nhận command từ Electron và thực thi trên video:
  - play
  - pause
  - toggle
  - seek relative
  - seek absolute
  - set playback rate

Extension phải tự reconnect khi WebSocket bị mất kết nối.

### 2.2 Electron Main Process

Electron Main Process chịu trách nhiệm:

- Khởi tạo ứng dụng desktop.
- Mở WebSocket Server tại:

```text
ws://127.0.0.1:8765
```

- Chỉ bind localhost, không expose ra mạng LAN.
- Nhận dữ liệu từ Chrome Extension.
- Gửi subtitle và player state sang Renderer thông qua IPC.
- Nhận interaction từ Renderer và gửi command ngược lại Extension.
- Quản lý:
  - overlay window
  - global hotkey
  - system tray
  - app config
  - auto-start tùy chọn
- Không cho Renderer truy cập Node.js trực tiếp.
- Dùng `contextIsolation: true`.
- Dùng preload script để expose API an toàn.

### 2.3 Overlay Renderer

Overlay Renderer chịu trách nhiệm:

- Hiển thị subtitle bằng HTML/CSS/TypeScript.
- Cửa sổ:
  - frameless
  - transparent
  - always on top
  - không hiện taskbar
  - có thể kéo vị trí
  - hỗ trợ Windows và Linux
- Subtitle dễ đọc trên nhiều background.
- Không dùng background hộp lớn.
- Có thể dùng text-shadow hoặc outline để tăng độ tương phản.
- Double-click vào subtitle gửi lệnh tua lùi 10 giây.
- Cho phép thay đổi:
  - font size
  - opacity
  - vị trí
  - text alignment
- Có chế độ click-through để không cản trở công việc.
- Có chế độ interaction để nhận chuột và kéo overlay.

---

## 3. Công nghệ

Sử dụng:

- TypeScript
- Electron
- Chrome Extension Manifest V3
- WebSocket package `ws`
- npm workspaces hoặc pnpm workspaces
- ESLint
- Prettier
- Vitest hoặc Jest cho unit test
- electron-builder để đóng gói

Ưu tiên pnpm nếu không có ràng buộc đặc biệt.

Không sử dụng:

- Python
- OCR
- backend cloud
- database server
- Docker
- OpenAI API trong MVP

---

## 4. Cấu trúc repository

Tạo monorepo:

```text
youtube-subtitle-companion/
├── apps/
│   ├── extension/
│   │   ├── manifest.json
│   │   ├── src/
│   │   │   ├── content.ts
│   │   │   ├── background.ts
│   │   │   ├── websocket-client.ts
│   │   │   ├── subtitle-reader.ts
│   │   │   ├── youtube-player.ts
│   │   │   └── types.ts
│   │   ├── public/
│   │   └── package.json
│   │
│   └── desktop/
│       ├── src/
│       │   ├── main/
│       │   │   ├── main.ts
│       │   │   ├── overlay-window.ts
│       │   │   ├── websocket-server.ts
│       │   │   ├── hotkeys.ts
│       │   │   ├── tray.ts
│       │   │   └── config-store.ts
│       │   ├── preload/
│       │   │   └── preload.ts
│       │   └── renderer/
│       │       ├── index.html
│       │       ├── overlay.ts
│       │       └── overlay.css
│       ├── assets/
│       ├── package.json
│       └── electron-builder.yml
│
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── protocol.ts
│       │   ├── schemas.ts
│       │   └── index.ts
│       └── package.json
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js
├── prettier.config.js
├── README.md
└── .gitignore
```

Có thể điều chỉnh cấu trúc nếu cần, nhưng phải giữ rõ ràng 3 phần:

- extension
- desktop
- shared protocol

---

## 5. WebSocket protocol

Tạo shared package định nghĩa message protocol.

Tất cả message phải có:

```ts
type BaseMessage = {
  type: string;
  timestamp: number;
};
```

### 5.1 Extension gửi sang Electron

#### Hello

```json
{
  "type": "extension.hello",
  "timestamp": 0,
  "clientId": "uuid",
  "version": "0.1.0"
}
```

#### Player state

```json
{
  "type": "player.state",
  "timestamp": 0,
  "videoId": "abc123",
  "title": "Video title",
  "currentTime": 125.4,
  "duration": 900,
  "playing": true,
  "playbackRate": 1
}
```

#### Subtitle update

```json
{
  "type": "subtitle.update",
  "timestamp": 0,
  "videoId": "abc123",
  "text": "Today we are going to talk about...",
  "currentTime": 125.4
}
```

#### Subtitle clear

```json
{
  "type": "subtitle.clear",
  "timestamp": 0,
  "videoId": "abc123"
}
```

### 5.2 Electron gửi sang Extension

#### Seek relative

```json
{
  "type": "player.command",
  "timestamp": 0,
  "command": "seek_relative",
  "seconds": -10
}
```

#### Seek absolute

```json
{
  "type": "player.command",
  "timestamp": 0,
  "command": "seek_absolute",
  "seconds": 120
}
```

#### Play

```json
{
  "type": "player.command",
  "timestamp": 0,
  "command": "play"
}
```

#### Pause

```json
{
  "type": "player.command",
  "timestamp": 0,
  "command": "pause"
}
```

#### Toggle

```json
{
  "type": "player.command",
  "timestamp": 0,
  "command": "toggle"
}
```

#### Playback rate

```json
{
  "type": "player.command",
  "timestamp": 0,
  "command": "set_playback_rate",
  "rate": 0.75
}
```

### 5.3 Validation

- Validate message runtime bằng Zod hoặc thư viện tương đương.
- Bỏ qua message không hợp lệ.
- Không để message malformed làm crash app.
- Log warning ở development mode.

---

## 6. Cách đọc subtitle

MVP ưu tiên đọc subtitle từ DOM YouTube.

Theo dõi:

```css
.ytp-caption-segment
```

Yêu cầu:

- Dùng MutationObserver.
- Gom toàn bộ caption segment đang hiển thị.
- Loại bỏ text trùng.
- Không gửi lặp lại cùng một subtitle.
- Khi caption biến mất thì gửi `subtitle.clear`.
- Khi YouTube SPA chuyển video mà không reload trang, extension vẫn phải hoạt động.
- Khi thẻ `<video>` bị thay thế, phải tìm lại video element.
- Không polling quá dày gây tốn CPU.

Thiết kế `SubtitleReader` thành abstraction để sau này có thể thay bằng caption track parser.

Ví dụ interface:

```ts
interface SubtitleReader {
  start(onSubtitle: (subtitle: SubtitlePayload | null) => void): void;
  stop(): void;
}
```

---

## 7. Điều khiển YouTube

Không dùng YouTube internal API nếu không cần.

Dùng HTMLMediaElement:

```ts
const video = document.querySelector<HTMLVideoElement>("video");
```

Thực thi:

```ts
video.play();
video.pause();
video.currentTime += seconds;
video.currentTime = seconds;
video.playbackRate = rate;
```

Yêu cầu:

- Clamp currentTime từ `0` tới `duration`.
- Bắt lỗi promise từ `video.play()`.
- Không crash nếu chưa tìm thấy video.
- Nếu YouTube thay video element, tự kết nối lại.

---

## 8. Overlay window

Electron BrowserWindow cấu hình cơ bản:

```ts
{
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: true,
  hasShadow: false,
  webPreferences: {
    preload,
    contextIsolation: true,
    nodeIntegration: false
  }
}
```

Yêu cầu UX:

- Mặc định ở giữa phía dưới màn hình chính.
- Chiều rộng mặc định khoảng 700px.
- Tự xuống dòng.
- Subtitle tối đa 2–3 dòng.
- Font mặc định khoảng 28px.
- Text màu trắng.
- Có text-shadow/outline đen.
- Không có background hoặc background gần như trong suốt.
- Không chiếm focus khi subtitle cập nhật.
- Không bật lên taskbar khi nội dung thay đổi.
- Lưu vị trí và kích thước qua các lần chạy.

### Interaction mode

Cần 2 trạng thái:

#### Click-through mode

- Overlay không nhận mouse event.
- Người dùng thao tác được ứng dụng phía sau.

Dùng:

```ts
window.setIgnoreMouseEvents(true, { forward: true });
```

#### Interactive mode

- Overlay nhận chuột.
- Có thể:
  - kéo cửa sổ
  - double-click subtitle
  - mở menu context
  - thay đổi font size

Cần có global hotkey để toggle giữa hai mode.

---

## 9. Tương tác bắt buộc

### Double-click subtitle

```text
Double-click subtitle
→ Renderer gửi IPC
→ Electron gửi WebSocket command
→ Extension nhận command
→ YouTube lùi 10 giây
```

### Global hotkeys mặc định

```text
Ctrl+Alt+Space  → Play/Pause
Ctrl+Alt+Left   → Lùi 5 giây
Ctrl+Alt+Right  → Tiến 5 giây
Ctrl+Alt+S      → Ẩn/hiện overlay
Ctrl+Alt+I      → Bật/tắt interaction mode
Ctrl+Alt+Up     → Tăng font
Ctrl+Alt+Down   → Giảm font
```

Trên Linux, nếu hotkey bị hệ điều hành chiếm, log cảnh báo và cho phép sửa trong config.

---

## 10. System tray

Tạo system tray menu:

```text
Show overlay
Hide overlay
Interaction mode
Click-through mode
Increase font
Decrease font
Start with system
Reconnect extension
Quit
```

Click Quit phải thoát hoàn toàn app.

Đóng overlay không được thoát app nếu tray đang hoạt động.

---

## 11. Config

Lưu config local bằng `electron-store` hoặc giải pháp tương đương.

Cấu hình gồm:

```ts
type AppConfig = {
  overlayVisible: boolean;
  clickThrough: boolean;
  fontSize: number;
  opacity: number;
  width: number;
  height: number;
  x?: number;
  y?: number;
  autoStart: boolean;
  hotkeys: {
    togglePlay: string;
    seekBack: string;
    seekForward: string;
    toggleOverlay: string;
    toggleInteraction: string;
    increaseFont: string;
    decreaseFont: string;
  };
};
```

Phải có default config.

Nếu config lỗi hoặc thiếu field, fallback an toàn về default.

---

## 12. Multi-tab behavior

Trong MVP chỉ điều khiển một tab YouTube active source.

Quy tắc chọn source:

- Tab có video đang playing được ưu tiên.
- Nếu nhiều tab cùng playing, dùng tab gửi player state gần nhất.
- Nếu không tab nào playing, dùng tab được kết nối gần nhất.
- Electron lưu connection tương ứng với source hiện tại.
- Command chỉ gửi tới source hiện tại.
- Hiển thị video title hiện tại trong debug log, không cần hiện trên overlay.

---

## 13. Reconnect và độ ổn định

### Extension

- Tự reconnect WebSocket.
- Exponential backoff:
  - 1s
  - 2s
  - 5s
  - tối đa 10s
- Khi Electron chưa mở, extension không spam console.
- Khi Electron mở lại, extension tự reconnect.

### Electron

- Chấp nhận extension kết nối/disconnect nhiều lần.
- Không crash khi client đóng bất ngờ.
- Hiển thị subtitle rỗng nếu source mất kết nối quá một khoảng thời gian hợp lý.
- Khi extension reconnect, hoạt động lại mà không cần reload YouTube.

---

## 14. Security

Bắt buộc:

- WebSocket chỉ bind `127.0.0.1`.
- Validate toàn bộ message.
- Không sử dụng `eval`.
- `nodeIntegration: false`.
- `contextIsolation: true`.
- Renderer chỉ gọi API được expose qua preload.
- Không expose object Node.js thô sang renderer.
- Chỉ cho extension chạy trên:
  - `https://www.youtube.com/*`
- Không yêu cầu permission không cần thiết.
- Không gửi dữ liệu ra internet.
- Không thu thập analytics.
- Không lưu lịch sử subtitle trong MVP.

---

## 15. Logging

Tạo logging đơn giản:

- Development:
  - connection
  - disconnect
  - active source
  - invalid message
  - hotkey registration failure
- Production:
  - chỉ log warning/error cần thiết

Không log subtitle liên tục trong production.

---

## 16. Testing

### Unit test

Viết test cho:

- Message schema validation.
- Seek clamp logic.
- Active source selection.
- Config default/fallback.
- Subtitle deduplication.
- Reconnect delay calculation.

### Manual test cases

Tạo checklist trong README:

1. Mở desktop app.
2. Load extension unpacked.
3. Mở YouTube có subtitle.
4. Bật CC.
5. Chuyển sang VS Code.
6. Subtitle vẫn chạy trên overlay.
7. Thu nhỏ Chrome.
8. Subtitle vẫn chạy.
9. Double-click overlay.
10. Video lùi 10 giây.
11. Global play/pause hoạt động.
12. Global seek hoạt động.
13. Toggle click-through hoạt động.
14. Restart Electron.
15. Extension tự reconnect.
16. Chuyển sang video khác trong YouTube SPA.
17. Subtitle tiếp tục hoạt động.
18. Test Windows.
19. Test Linux X11.
20. Ghi chú giới hạn nếu Linux Wayland có khác biệt.

---

## 17. Build và package

### Development scripts

Root package cần có:

```json
{
  "scripts": {
    "dev": "...",
    "dev:desktop": "...",
    "dev:extension": "...",
    "build": "...",
    "build:desktop": "...",
    "build:extension": "...",
    "test": "...",
    "lint": "...",
    "format": "...",
    "typecheck": "..."
  }
}
```

### Extension build

Output:

```text
dist/extension/
```

Có thể load unpacked trực tiếp vào Chrome.

### Desktop build

Dùng electron-builder.

Output ít nhất:

Windows:

```text
dist/desktop/*.exe
```

Linux:

```text
dist/desktop/*.AppImage
```

Có thể thêm `.deb` nếu thuận tiện.

Không bắt buộc code signing.

---

## 18. README bắt buộc

README phải có:

- Giới thiệu.
- Kiến trúc.
- Sơ đồ luồng dữ liệu.
- Yêu cầu môi trường.
- Cài dependencies.
- Chạy development.
- Load extension unpacked.
- Build extension.
- Build Windows.
- Build Linux.
- Danh sách hotkey.
- Cách bật subtitle YouTube.
- Cách thêm YouTube vào Chrome Memory Saver exception.
- Troubleshooting:
  - extension không kết nối
  - không thấy subtitle
  - global hotkey không hoạt động
  - Linux Wayland
  - overlay không click được
- Known limitations.

---

## 19. Phạm vi MVP

MVP phải hoàn thành:

- Extension đọc subtitle YouTube.
- WebSocket hai chiều.
- Electron overlay trong suốt.
- Always on top.
- Click-through.
- Interaction mode.
- Double-click lùi 10 giây.
- Global hotkeys.
- System tray.
- Config local.
- Windows build config.
- Linux build config.
- Unit tests cơ bản.
- README đầy đủ.

Không làm trong MVP:

- AI translate.
- Dictionary.
- OpenAI.
- Anki.
- Subtitle history.
- User account.
- Cloud sync.
- Mobile app.
- Netflix/Udemy/Coursera.
- Auto update server.
- Speech recognition.
- OCR.

---

## 20. Tiêu chí nghiệm thu

Task chỉ được coi là hoàn thành khi:

1. `pnpm install` chạy thành công.
2. `pnpm lint` chạy thành công.
3. `pnpm typecheck` chạy thành công.
4. `pnpm test` chạy thành công.
5. `pnpm build` chạy thành công.
6. Extension có thể load unpacked.
7. Electron app mở được.
8. Extension kết nối được với Electron qua localhost WebSocket.
9. Subtitle YouTube xuất hiện trên overlay.
10. Subtitle vẫn chạy khi:
    - tab YouTube không active
    - Chrome ở cửa sổ khác
    - Chrome bị minimize
    - người dùng đang dùng ứng dụng khác
11. Double-click subtitle làm YouTube lùi 10 giây.
12. Hotkey play/pause hoạt động.
13. Hotkey seek hoạt động.
14. Overlay luôn nổi.
15. Click-through hoạt động.
16. App không crash khi:
    - chưa mở YouTube
    - video không có subtitle
    - Electron khởi động trước extension
    - extension khởi động trước Electron
    - WebSocket disconnect/reconnect
17. Có hướng dẫn build Windows và Linux.
18. Không còn TODO quan trọng trong luồng MVP.

---

## 21. Cách Codex thực hiện

Hãy tự thực hiện toàn bộ theo thứ tự:

1. Khảo sát thư mục hiện tại.
2. Nếu repo trống, khởi tạo monorepo.
3. Tạo shared protocol.
4. Tạo Electron desktop app.
5. Tạo WebSocket server.
6. Tạo overlay window.
7. Tạo preload và IPC.
8. Tạo extension Manifest V3.
9. Tạo subtitle reader.
10. Tạo YouTube player controller.
11. Kết nối WebSocket hai chiều.
12. Thêm hotkeys.
13. Thêm tray.
14. Thêm config.
15. Thêm reconnect.
16. Thêm tests.
17. Thêm build scripts.
18. Viết README.
19. Chạy install/lint/typecheck/test/build.
20. Sửa toàn bộ lỗi phát hiện.
21. Báo cáo cuối cùng.

Không dừng lại để hỏi xác nhận cho các quyết định kỹ thuật nhỏ.

Nếu có nhiều phương án, ưu tiên:

- code đơn giản
- ít dependency
- type-safe
- dễ debug
- chạy được Windows và Linux
- hoàn thành MVP trước

Không mở rộng ngoài scope trước khi MVP chạy ổn.

---

## 22. Báo cáo cuối cùng của Codex

Khi hoàn thành, trả về:

### Files created

Liệt kê các file/thư mục chính đã tạo.

### Architecture

Tóm tắt luồng:

```text
YouTube → Extension → WebSocket → Electron → Overlay
Overlay → Electron → WebSocket → Extension → YouTube
```

### Commands

Liệt kê lệnh:

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

### Verification

Báo rõ kết quả:

- lint
- typecheck
- test
- build

### Manual steps

Nêu các bước người dùng cần làm:

- load extension unpacked
- mở Electron
- mở YouTube
- bật CC

### Remaining limitations

Chỉ liệt kê giới hạn thực tế còn lại, đặc biệt:

- YouTube DOM có thể thay đổi.
- Linux Wayland có thể hạn chế global hotkey hoặc always-on-top tùy compositor.
- Chrome có thể throttle tab nếu cấu hình tiết kiệm bộ nhớ.
