# Offline CEO Tools (Frontend-Only)

Offline CEO Tools is a React + Vite single-page app with privacy-first utility tools.

## Privacy Notice

- All processing happens locally in your browser.
- Files never leave your device.
- No uploads, no backend, no external APIs.

## Stack

- React 18 + Vite
- JavaScript only (no TypeScript)
- Browser APIs: Canvas, File API, Web Crypto, Web Workers
- Tauri (optional desktop installers for macOS/Windows/Linux)

## Main Tool Categories

- Image (convert/edit/filter/crop/compress/watermark/EXIF/GIF/sprite/favicon/SVG tools)
- PDF (merge/split/reorder/annotate/image<->PDF/text extract/form/signature)
- Text (case/count/cleanup/find-replace/diff/slug/lorem/markdown/handwriting/bionic)
- CSS (generators for gradient/shadow/radius/clip-path/pattern/bezier/loader/etc.)
- Color (HEX/RGBA/shades/mixer/palette extractor)
- Developer + Coding (encoding/hash/checksum/formatters/JWT/JSON tree/code-to-image/meta)
- Productivity + Misc (QR/barcode/unit/date/calculators/renamer/UTM/ICS/randomizers)
- WASM-heavy local tools (OCR + FFmpeg conversions and related utilities)

## Download Button Configuration (`download_linkf`)

The header download buttons read links from:

- `/public/download_linkf.json`

Edit this file and add your real repo/release links:

```json
{
  "repo": "https://github.com/your-user/your-repo",
  "releases": "https://github.com/your-user/your-repo/releases",
  "macos": "",
  "windows": "",
  "linux": ""
}
```

If a link is empty, its button stays disabled.
The "Download app" row is shown on web/dev hosting and hidden inside packaged desktop apps.

## Run Locally

```bash
npm install
npm run dev
```

## Web Build

Default build:

```bash
npm run build
npm run preview
```

Hostinger subfolder builds:

```bash
npm run build:hostinger
# base=/onlineceotools/

npm run build:hostinger:offline
# base=/offlineceotools/
```

Upload the **contents** of `dist/` to your target folder in `public_html`.

## Desktop App Build (Tauri)

### 1) Prerequisites

- Node.js + npm
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- OS build tools:
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools (C++ workload) + WebView2 runtime
  - Linux: GTK/WebKit2 and Tauri Linux deps

### 2) macOS build command

```bash
npm run tauri:build
```

Output examples:

- `src-tauri/target/release/bundle/macos/Offline CEO Tools.app`
- `src-tauri/target/release/bundle/dmg/*.dmg`

In desktop apps, generated result files use a native "Save As" dialog so the user chooses the exact destination path.

### 3) Windows build (step-by-step)

1. Clone repo on a Windows machine.
2. Install Node.js LTS.
3. Install Rust via `rustup`.
4. Install Visual Studio Build Tools (Desktop development with C++).
5. Run:

```bash
npm install
npm run tauri:build
```

6. Get installers from `src-tauri/target/release/bundle/` (`.msi` / `.exe`).

### 4) Linux build (step-by-step)

1. Clone repo on a Linux machine.
2. Install Node.js LTS + npm.
3. Install Rust via `rustup`.
4. Install Tauri Linux dependencies (GTK/WebKit2 packages for your distro).
5. Run:

```bash
npm install
npm run tauri:build
```

6. Get bundles from `src-tauri/target/release/bundle/` (`.AppImage`, `.deb`, etc. depending on distro/tooling).

### 5) Build all platforms via GitHub Actions

This repo includes:

- `.github/workflows/tauri-build.yml`

Push to GitHub, run the workflow, then download artifacts for macOS/Windows/Linux.

## Project Structure

```text
src/
  app/          router + layout + registry
  modules/      tool categories
  workers/      heavy browser workers
  components/   shared UI
  utils/        helper utilities
  styles/       CSS
  main.jsx
src-tauri/      Tauri desktop wrapper
```

## Notes / Limits

- `file://` opening (`double-click dist/index.html`) can show blank due to browser CORS/module restrictions.
  Use `npm run preview` or real hosting.
- Some “download from URL” features only work when the source allows browser CORS.
- Privacy-first rule is enforced: no backend and no file uploads.
