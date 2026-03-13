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

## Build Packaging (basic)

This template is ready to be packaged with tools such as `electron-builder` or `electron-forge`.

Typical steps:

1. Add packager dependency (for example `electron-builder`).
2. Add build config in `package.json`.
3. Add scripts like `build:mac` and `build:win`.
4. Run platform-specific build commands.

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
