# Changelog

All notable changes to this project are documented in this file.

## [1.1.2] - 2026-03-14

### Added
- Dedicated renderer utility modules for tag normalization, sync merge logic, and auth/cloud orchestration.
- Dedicated main-process modules for Cognito session management and cloud transport handling.
- Expanded technical documentation covering the refactored architecture and current testing status.

### Changed
- Reduced the size and responsibility surface of `renderer.js` by moving auth, sync, and utility logic into focused modules.
- Reduced the size and responsibility surface of `main.js` by moving session and cloud concerns into focused services.
- Updated the README to reflect the current project structure and documentation layout.

### Fixed
- Preserved runtime behavior while improving maintainability through incremental refactoring.

## [1.1.1] - 2026-03-14

### Added
- Persistent Cognito session across app restarts.
- Automatic session restore on app boot, including token refresh when possible.
- Session storage in user data using `safeStorage` encryption when available.

### Changed
- Improved multi-account behavior: logout now clears local workspace and sync baseline before the next login.
- First cloud pull after login now treats cloud data as authoritative when no baseline exists.

### Fixed
- Fixed silent session loss after app restart.
- Fixed cross-account data contamination after logout/login with a different user.

## [1.1.0] - 2026-03-14

### Added
- Three-way cloud sync conflict resolution with keep-both behavior.
- Lambda-side conflict detection via `baseServerUpdatedAt` and HTTP 409 conflict responses.
- Conflict payload support to return the latest remote snapshot for client-side merge.
- Cloud retry scheduling with backoff for throttling and transient failures.

### Changed
- Packaged app now includes `.env` as an extra resource.
- Packaged runtime loads `.env` from app resources.
- Local persisted state now stores sync metadata (`serverUpdatedAt`, `lastSyncedSnapshot`).

### Fixed
- Fixed DynamoDB `Decimal` JSON serialization in the sync Lambda.
- Reduced sync loops and unstable behavior when receiving HTTP 429.

## [1.0.9] - 2026-03-14

### Added
- Cognito authentication support for cloud sync.
- Auth status and login/logout flow in the desktop app.

### Changed
- Cloud sync can operate with Cognito identity instead of shared API key only.

## [1.0.8] - 2026-03-13

### Fixed
- Tag filter chips toggle behavior when no close button is used.
- General UX cleanup for tag filtering interactions.

## [1.0.7] - 2026-03-13

### Added
- Tag system for tasks and notes.
- Filter chips for tags.
- Per-card quick tag picker.
- Hidden tag delete action.

## [1.0.6] - 2026-03-13

### Added
- In-app data source picker.
- Active data source indicator.

## [1.0.5] - 2026-03-13

### Added
- Recoverable trash for deleted cards.

## [1.0.4] - 2026-03-13

### Changed
- CI release strategy adjusted to disable electron-builder auto-publish.
- GitHub Release creation delegated to release workflow tooling.

## [1.0.3] - 2026-03-13

### Fixed
- CI permissions updated to allow GitHub Release creation (`contents: write`).

## [1.0.2] - 2026-03-13

### Changed
- CI updated to auto-create GitHub Releases with macOS and Windows artifacts on tag push.

## [1.0.1] - 2026-03-13

### Added
- Desktop packaging setup.
- CI builds for macOS and Windows.

## [1.0.0] - 2026-03-13

### Added
- Initial Electron TaskNotes app.
- Local JSON persistence for tasks and notes.
