# Build hướng dẫn đóng gói Database Manager thành file .vsix

Hướng dẫn này mô tả cách build extension thành một file `.vsix` hoàn chỉnh để cài trực tiếp vào VS Code (mà không cần deploy lên Marketplace).

## Tổng quan quy trình

```
[ source code ] → check-types + lint → build webview → esbuild bundle → vsce package → dist/*.vsix
```

Toàn bộ các bước tự động chạy khi gọi `yarn run package:vsix` (thông qua hook `vscode:prepublish`).

## 1. Yêu cầu hệ thống

- **Node.js ≥ 22.5** (extension dùng `node:sqlite` built-in cho SQLite). Khuyến nghị Node 22.13+ hoặc 24+.
- **VS Code ≥ 1.85** (hỗ trợ từ bản 1.85 trở lên, bao gồm cả 1.132).
- **yarn 1** (`corepack enable` hoặc cài tại https://yarnpkg.com) — package manager chính của repo.
- **npm** (dùng cho phần webview bên trong `webview/`).

## 2. Cài phụ thuộc

Mở terminal ở thư mục gốc của extension:

```bash
# Dependencies cho extension (mysql2, pg, typescript, esbuild, vsce…)
yarn install

# Dependencies cho giao diện webview (Vue, Vite, Tailwind)
npm --prefix webview install
```

> Nếu có sẵn `node_modules` rồi có thể bỏ qua bước này.

## 3. Build (đóng gói thành .vsix)

Chỉ một lệnh:

```bash
yarn run package:vsix
```

Lệnh này lần lượt:

1. `tsc --noEmit` — kiểm tra type.
2. `eslint src` — kiểm tra lint.
3. `npm --prefix webview run build` — build Vue webview vào `dist/webview/` (bundle production, tên asset có hash).
4. `node esbuild.js --production` — bundle toàn bộ `src/` (kể cả `mysql2`, `pg`, driver SQLite) vào một file duy nhất `dist/extension.js` (minify).
5. `vsce package --out dist/` — đóng gói thành file:

```
dist/database-manager-0.0.1.vsix
```

`.vscodeignore` đã được cấu hình để gói **chỉ** chứa:

- `package.json`, `README.md`, `CHANGELOG.md`
- `dist/extension.js` (bundle tự chứa mọi dependency Node)
- `dist/webview/**` (UI đã build sẵn)
- `resources/icons/database.svg` (icon activity bar)

`node_modules`, mã nguồn `src/`, webview source, docs… đều bị loại — gói chỉ ~450 KB.

## 4. Cài .vsix vào VS Code

### Cách 1 — Command Palette

1. Mở VS Code.
2. `Ctrl+Shift+P` → chạy lệnh **Extensions: Install from VSIX...**.
3. Chọn file `dist/database-manager-0.0.1.vsix`.
4. Cài xong, mở lại cửa sổ (`Ctrl+Shift+P` → **Developer: Reload Window**).

### Cách 2 — CLI

```bash
code --install-extension dist/database-manager-0.0.2.vsix
```

### Kiểm tra hoạt động

- Mới cài xong sẽ thấy icon **Database Manager** (hình database màu xanh) ở Activity Bar.
- Mở **Connection Manager** → **New** → nhập host/port/user/pass hoặc chọn file SQLite → **Test Connection** → **Save Connection** → **Connect**.
- Sau khi connect, duyệt databases → tables → columns ở view **Connections**.

## 5. Chế độ phát triển (debug, không cần .vsix)

Để chạy thử khi phát triển:

```bash
# Chạy webview + esbuild watchsong song
yarn run watch
```

Rồi nhấn `F5` trong VS Code (hoặc chạy launch config **Run Extension**) để mở Extension Development Host với extension đã load.

## Lưu ý quan trọng

- **Đừng chạy `npm run compile` / `npm run build` trước khi đóng gói** — script `compile` dùng `tsc` ghi đè `dist/extension.js` bằng bản *không bundle* (vẫn `require("mysql2")` từ node_modules). File như vậy sẽ chạy được khi debug nhưng **không chạy trong .vsix đã cài** (vì `node_modules` bị loại khỏi gói). Script `package:vsix` luôn build lại bundle từ đầu nên an toàn.
- `esbuild` giữ `vscode` và các module built-in của Node (`node:sqlite`, `node:fs`…) là external nên không phát sinh lỗi thiếu dependency khi chạy thật.
- Cảnh báo `The file extension/dist/extension.js is large` từ `vsce` là bình thường (bundle `pg` + `mysql2` ~1 MB), không phải lỗi.
- Mật khẩu kết nối được lưu trong **SecretStorage** của VS Code, không nằm trong .vsix hay trên đĩa dạng plaintext.

## 6. (Tùy chọn) Nâng version & đóng gói lại

Khi sửa code:

```bash
# Sửa trường "version" trong package.json (ví dụ 0.0.2)
# rồi đóng gói lại — output mới có tên chứa version mới:
yarn run package:vsix
```

## 7. (Tùy chọn) Đăng lên VS Code Marketplace

Không bắt buộc nếu chỉ muốn cài cục bộ. Nếu muốn publish:

1. Khởi tạo publisher: `npx vsce create-publisher <tên>` (hoặc dùng account Azure DevOps có PAT).
2. Đăng nhập: `npx vsce login <publisher>`.
3. Publish: `npx vsce publish` (lệnh này tự chạy `vscode:prepublish` rồi đẩy lên marketplace).

> Trước khi publish quốc tế nên thay trường `"publisher": "local-dev"` trong `package.json` bằng tên publisher thật của bạn.

## Danh sách lệnh tiện ích

| Lệnh | Công dụng |
| --- | --- |
| `yarn install` | Cài dependencies extension |
| `npm --prefix webview install` | Cài dependencies webview |
| `yarn run check-types` | Kiểm tra TypeScript |
| `yarn run lint` | Kiểm tra ESLint |
| `yarn run build:webview` | Build UI Vue vào `dist/webview/` |
| `node esbuild.js --production` | Bundle extension vào `dist/extension.js` |
| `yarn run package:vsix` | Build toàn bộ + tạo file `.vsix` |
| `npx vsce ls` | Xem trước danh sách file sẽ bị đóng gói |