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
- `src/tag-utils.js`
- `src/sync-merge.js`
- `src/auth-sync-controller.js`
- `src/main-auth-session.js`
- `src/main-cloud-service.js`
- `docs/BUSINESS_REQUIREMENTS.md`
- `docs/TECHNICAL_REQUIREMENTS_RND.md`

## Documentation

- Business requirements: `docs/BUSINESS_REQUIREMENTS.md`
- Technical requirements: `docs/TECHNICAL_REQUIREMENTS_RND.md`
- Release history: `CHANGELOG.md`

## Automated Tests

The project now includes an initial automated test suite powered by `Vitest`.

Available commands:

```bash
npm test
npm run test:run
```

Current coverage focus:

- `src/tag-utils.js`
- `src/sync-merge.js`
- `src/main-cloud-service.js`

The first suite validates core utility behavior, sync merge logic, and cloud transport error/status handling.

## Install

```bash
npm install
```

## Run

```bash
npm start
```

## AWS Cloud Sync

TaskNotes supports optional cloud sync against an AWS backend.
The recommended setup uses Cognito login so each user syncs their own dataset.

Set these environment variables before launching the app:

```bash
export TASKNOTES_SYNC_URL="https://your-api-id.execute-api.eu-west-1.amazonaws.com/prod"
export TASKNOTES_COGNITO_REGION="eu-west-1"
export TASKNOTES_COGNITO_CLIENT_ID="your-cognito-app-client-id"
export TASKNOTES_SYNC_TIMEOUT_MS="12000"
npm start
```

Legacy shared API key mode is still supported for migration scenarios:

```bash
export TASKNOTES_SYNC_API_KEY="your-shared-key"
```

Expected backend endpoints:

- `POST /sync/push` with body `{ snapshot, clientUpdatedAt }`
- `GET /sync/pull?since=<iso-date>`

Expected response payloads:

- push: `{ ok: true, serverUpdatedAt }`
- pull: `{ ok: true, snapshot, serverUpdatedAt }`

If cloud variables are not set, the app keeps working in local-only mode.
Local `.env` files are ignored by git and should not be committed.

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

The repository includes workflows at `.github/workflows/build.yml` and `.github/workflows/test.yml`.

The test workflow runs:

- on push to `main`
- on pull requests

The build/release workflow runs:

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

- `main.js`: Electron lifecycle and IPC registration/orchestration.
- `src/main-auth-session.js`: Cognito auth lifecycle, token refresh, session persistence.
- `src/main-cloud-service.js`: authenticated cloud transport and cloud status handling.
- `preload.js`: limited API exposure via `contextBridge`.
- `renderer.js`: primary UI state, rendering, inline editing, sorting, drag/drop, auto-save.
- `src/tag-utils.js`: tag normalization and deduplication helpers.
- `src/sync-merge.js`: sync merge utilities and unsynced-change helpers.
- `src/auth-sync-controller.js`: auth modal and cloud sync orchestration for the renderer.

## Testing Status

- The project now includes an initial Vitest-based automated suite.
- Refactoring work is validated with syntax checks, automated tests, and manual app smoke tests.
- Current suites cover merge logic, tag utilities, cloud service, auth session manager, and auth-sync controller.
- Recommended next step: extend to Electron end-to-end smoke coverage with a staging Cognito user.

Security defaults:

- `contextIsolation: true`
- `nodeIntegration: false`
- no direct filesystem access from renderer
