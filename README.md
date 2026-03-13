# TaskNotes Electron

TaskNotes is a fast local desktop app for managing work tasks and notes with auto-save and JSON filesystem persistence.

## Features

- Cross-platform desktop app with Electron (macOS and Windows).
- Two sections: Tasks and Notes.
- Inline text editing with no save button.
- Automatic debounce save to local JSON file.
- Task done toggle, priority (1..10), and visible metadata.
- Manual drag and drop ordering with persistence.
- Temporary sorting modes without losing manual order.
- Compact task summary panel: open tasks and counts by priority.
- Delete with Undo toast.
- JSON import/export.
- Safe persistence strategy with `.tmp` atomic write and `.bak` backup.

## Project Structure

- `package.json`
- `main.js`
- `preload.js`
- `src/index.html`
- `src/styles.css`
- `src/renderer.js`

## Install

```bash
npm install
```

## Run

```bash
npm start
```

## Data File Location

The app stores data in Electron user data path:

- filename: `task-manager-data.json`
- location: `app.getPath('userData')`

Examples:

- macOS: `~/Library/Application Support/tasknotes-electron/task-manager-data.json`
- Windows: `%APPDATA%/tasknotes-electron/task-manager-data.json`

A backup file is also maintained as:

- `task-manager-data.json.bak`

If a malformed JSON is found, the app tries to back it up as `.corrupt-<timestamp>.bak` and recreates a clean file.

## Build Packaging

The project is configured for `electron-builder` and outputs packaged apps into `dist/`.

Install dependencies:

```bash
npm install
```

Build macOS app:

```bash
npm run build:mac
```

Expected output includes a macOS app bundle and installer, for example:

- `dist/TaskNotes.app`
- `dist/TaskNotes-1.0.0.dmg`

Build Windows package:

```bash
npm run build:win
```

Expected output includes Windows artifacts such as:

- `dist/TaskNotes Setup 1.0.0.exe`
- `dist/TaskNotes 1.0.0.exe`

Important note about Windows builds from macOS:

- `electron-builder` can package some Windows targets from macOS, but Windows installers are most reliable when built on Windows or on CI.
- If `build:win` fails on macOS, the recommended solution is to run the same command on a Windows machine, GitHub Actions runner, or VM.

To put the app on Desktop after packaging:

- macOS: drag `dist/TaskNotes.app` to Desktop or Applications.
- Windows: use the generated installer `.exe`, or place the portable `.exe` on Desktop.

## GitHub Actions

The repository includes a workflow at `.github/workflows/build.yml`.

It runs:

- on manual trigger from GitHub Actions
- automatically when a tag like `v1.0.0` is pushed

Produced artifacts:

- macOS: `.dmg`, `.zip`
- Windows: installer `.exe`, portable `.exe`

## Keyboard Shortcuts

- `Cmd/Ctrl + N`: new task or note (depends on current tab)
- `Cmd/Ctrl + S`: show auto-save status message
- `Esc`: exit current text editing focus

## Notes on Architecture

- `main.js`: Electron lifecycle, secure IPC handlers, file I/O, import/export dialogs.
- `preload.js`: limited API exposure via `contextBridge`.
- `renderer.js`: UI state, rendering, inline editing, sorting, drag/drop, auto-save.

Security defaults:

- `contextIsolation: true`
- `nodeIntegration: false`
- no direct filesystem access from renderer
