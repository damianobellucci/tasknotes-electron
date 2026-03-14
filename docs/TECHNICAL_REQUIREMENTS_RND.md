# TaskNotes - Technical Requirements Document (R&D)

Document owner: Engineering
Primary stakeholders: Product, QA, DevOps, Security
Status: Active
Last updated: 2026-03-14

## 1. Purpose and Scope
This document defines technical requirements for TaskNotes across architecture, data model, authentication, synchronization, reliability, security, observability, quality, and release operations.

Scope includes:
- Runtime architecture and module responsibilities
- Data and sync contracts
- Auth and session persistence requirements
- Error handling and resiliency behavior
- Performance and non-functional requirements
- Testing strategy and release readiness

Out of scope:
- UI copywriting details
- Sprint-level task breakdown
- Vendor legal and billing agreements

## 2. System Context
TaskNotes is an Electron desktop application with local-first persistence and optional cloud synchronization.

Main components:
- Desktop app (Electron main process + renderer process)
- Secure bridge layer (preload IPC exposure)
- Sync backend (AWS Lambda Python handler)
- Cloud datastore (DynamoDB)
- Identity provider (Amazon Cognito)

## 3. Technology Stack
- Desktop container: Electron
- Runtime: Node.js
- UI layer: HTML/CSS/JS in renderer process
- Main process: IPC handlers, file I/O, auth lifecycle, cloud bridge
- Backend API: AWS Lambda (Python)
- Datastore: DynamoDB
- Authentication: Cognito JWT, optional shared API key fallback in hybrid mode

## 4. High-Level Architecture
### 4.1 Main process responsibilities
- Owns all local data read/write operations
- Owns auth token/session lifecycle
- Owns cloud fetch and request signing/headers
- Owns validation and sanitization before persistence

Current module split:
- `main.js`: Electron lifecycle, IPC registration, top-level orchestration
- `src/main-auth-session.js`: Cognito login/logout/new-password flow, token refresh, session persistence, session restore
- `src/main-cloud-service.js`: cloud status, authenticated fetch, sync transport abstraction

### 4.2 Renderer responsibilities
- Owns UI state and interactions
- Owns save scheduling and local change detection
- Owns sync orchestration calls through exposed IPC APIs
- Owns three-way merge strategy for conflict scenarios

Current module split:
- `src/renderer.js`: primary UI state, rendering, CRUD, data-source UX, app coordination
- `src/tag-utils.js`: tag normalization and deduplication helpers
- `src/sync-merge.js`: pure snapshot merge and unsynced-change utilities
- `src/auth-sync-controller.js`: auth modal flow, logout flow, cloud sync orchestration, retry handling

### 4.3 Backend responsibilities
- Accepts push and pull sync requests
- Resolves authorization mode
- Detects write conflicts using baseServerUpdatedAt
- Returns structured conflict payload for client merge

### 4.4 Refactoring principles
- Keep behavior stable while moving logic behind explicit module boundaries.
- Prefer pure utility modules for merge and normalization logic.
- Keep Electron-specific wiring at the edges (`main.js`, `renderer.js`).
- Make future automated tests target extracted modules first.

## 5. Data Model Requirements
### 5.1 Snapshot model
A snapshot must include:
- tasks array
- notes array
- tags array
- settings object
- version number

### 5.2 Local persisted sync metadata
Local data payload must include:
- sync.serverUpdatedAt
- sync.lastSyncedSnapshot

### 5.3 Item identity requirements
- Every task/note item must have a stable unique id.
- Updated timestamps must reflect effective last change.
- Merge logic must use identity plus content deltas.

## 6. Local Persistence Requirements
### TR-01 Atomic writes
All save operations must use atomic write pattern to reduce corruption risk.

### TR-02 Schema sanitization
Incoming payloads must be sanitized in the main process before disk write.

### TR-03 Corruption recovery
If local data is unreadable, system should recover gracefully (backup/fresh default behavior) without crash.

### TR-04 Restart consistency
After close/restart, the app must load the latest valid persisted state.

## 7. Authentication and Session Requirements
### TR-05 Auth modes
System must support:
- Cognito mode
- Shared key mode
- Hybrid mode with Cognito preference when configured

### TR-06 Session persistence
When Cognito is enabled and login succeeds:
- Session tokens must be persisted in user data
- Encryption must use safe storage facilities when available
- Session must restore automatically at app startup

### TR-07 Session invalidation
On explicit logout:
- In-memory tokens are cleared
- Persisted session record is removed
- Status endpoints reflect logged-out state immediately

### TR-08 Token refresh behavior
If id token is near or past expiry and refresh token exists:
- Attempt refresh automatically
- Persist updated token payload
- Fail safely to logged-out state if refresh fails permanently

## 8. Sync Protocol Requirements
### TR-09 Push request contract
Push must include:
- snapshot payload
- clientUpdatedAt timestamp
- baseServerUpdatedAt revision marker

### TR-10 Pull request contract
Pull may include since parameter derived from local cloudServerUpdatedAt.

### TR-11 Conflict response contract
On conflict, server returns:
- ok false
- conflict true
- serverUpdatedAt
- latest remote snapshot

### TR-12 Structured errors
All errors should use consistent shape with explicit status/error fields.

## 9. Conflict Resolution Requirements
### TR-13 Three-way merge
Merge inputs:
- base snapshot
- local current snapshot
- remote snapshot

Expected behavior:
- Non-overlapping changes merge automatically
- Overlapping edits preserve data using keep-both strategy
- No silent data discard in conflict paths

### TR-14 First-pull authority rule
If no baseline exists (for example after login/account switch), first pull must treat remote cloud snapshot as authoritative.

### TR-15 Account isolation
After logout/login with different account, previous account data must not bleed into new account context.

## 10. Logout and Account Transition Requirements
### TR-16 Unsynced warning
If unsynced local changes exist on logout, user confirmation is required before destructive transition.

### TR-17 Logout reset state
Logout must reset:
- auth state
- sync baseline metadata
- local working dataset intended for active account context

### TR-18 Next-login consistency
After next login, cloud pull must establish clean baseline for that account before normal merge cycles continue.

## 11. Retry and Resilience Requirements
### TR-19 Backoff policy
- HTTP 429: short retry window
- transient network/server errors: longer retry window
- prevent unbounded aggressive retry loops

### TR-20 In-flight protections
System must prevent overlapping sync operations that can corrupt state or produce race conditions.

### TR-21 Offline tolerance
Local usage must continue even when cloud auth or network is unavailable.

## 12. IPC Contract Requirements
### 12.1 Renderer to main channels
- auth login/logout/status/new password
- cloud status/push/pull
- data load/save/import/export/select/activate/create

### 12.2 Contract quality requirements
- Request payload validation in main process
- Stable response format with explicit success/error fields
- Non-throwing error paths where possible

### 12.3 Compatibility requirements
IPC changes must preserve backward compatibility or include versioned migration plan.

### 12.4 Module boundary requirements
- Renderer utility modules must not call Electron APIs directly.
- Auth/session concerns must remain isolated from data persistence concerns in the main process.
- Cloud transport concerns must not own UI-facing merge policy.

## 13. Backend Requirements (Lambda)
### TR-22 Authorization resolution
Lambda must resolve identity according to configured mode and reject unauthorized requests.

### TR-23 Conflict-safe writes
Write flow must compare current server revision and client base revision before overwrite.

### TR-24 Serialization compatibility
Responses must serialize DynamoDB numeric values correctly.

### TR-25 Pull optimization
Pull with since should return null snapshot when no newer server data exists.

## 14. Security Requirements
### TR-26 Secret handling
No secrets in source code. Runtime environment values only.

### TR-27 Packaged environment handling
Packaged app must load runtime configuration from bundled resources path.

### TR-28 Session protection
Persisted auth session must be encrypted when platform support exists.

### TR-29 Least privilege
Cloud and release credentials should be scoped minimally and rotated per policy.

### TR-30 Auditability
Critical auth/sync transitions should be diagnosable through structured logs.

## 15. Performance and NFR Requirements
### TR-31 Startup performance
Perceived startup should be fast on baseline consumer hardware.

### TR-32 Interaction performance
Core CRUD and search interactions should feel immediate on medium datasets.

### TR-33 Reliability targets
No known reproducible data-loss path in nominal user workflows.

### TR-34 Platform support
Build and run support for current macOS and Windows targets.

## 16. Observability and Diagnostics
### TR-35 UI status visibility
UI must expose meaningful sync/auth status for user confidence.

### TR-36 Error diagnostics
Main process and backend should emit structured error contexts for troubleshooting.

### TR-37 Supportability
Operational issues must be reproducible using logs, status codes, and deterministic flow checkpoints.

## 17. Test Strategy Requirements
### 17.1 Unit-level focus areas
- Sanitization functions
- Merge logic and conflict copy behavior
- Tag normalization and deduplication
- Auth/session state transitions in extracted session manager
- Cloud transport error mapping in extracted cloud service

### 17.2 Integration-level focus areas
- login then restart then auto-restored session
- logout then restart then login required
- account A to logout to account B isolation
- push and pull nominal path
- conflict 409 path and merge outcome
- retry and backoff behavior for 429 and timeouts
- renderer-to-main IPC continuity after module extraction

### 17.3 Manual smoke requirements
- task/note create edit delete restore
- tag assign/filter/search flows
- import/export round trip
- packaged app env and auth setup validation

### 17.4 Regression gates
Release candidate is blocked if any of these fail:
- session persistence behavior
- account isolation behavior
- conflict no-data-loss behavior
- startup local persistence integrity

### 17.5 Current testing status
- Syntax-level checks are currently used as a lightweight guardrail during refactoring.
- Manual smoke tests are required after each structural extraction.
- A dedicated automated test framework is not yet installed and remains a recommended next step.

## 18. Build and Release Requirements
### TR-38 Versioning
Semantic versioning must be maintained in package metadata.

### TR-39 Changelog discipline
Every release must include an English changelog with user-visible and technical highlights.

### TR-40 CI publishing pipeline
Tag-based workflow must build platform artifacts and create release entry with assets.

### TR-41 Reproducibility
Build scripts should clear stale artifacts before packaging.

## 19. Operational Readiness
- Pre-release checklist must include auth/session/sync scenarios.
- Release notes must include behavior changes and migration notes.
- Support handoff must include known issues and troubleshooting tips.

## 20. Technical Debt and Roadmap
- Improve conflict UX with dedicated review screen
- Add stronger automated end-to-end coverage for multi-account transitions
- Evaluate encrypted fallback strategy where safe storage is unavailable
- Add optional telemetry for reliability metrics and bottleneck analysis
- Continue reducing renderer and main orchestration size through targeted extractions only when boundaries are clear.
- Introduce unit tests around extracted modules before further major architectural changes.

## 21. Acceptance Criteria Summary
A release is technically acceptable only if:
- session persists across restart after successful login
- logout always clears persisted session and requires re-login
- account switch does not leak prior account data
- sync conflict path preserves data with deterministic outcome
- retry behavior is bounded and stable
- no critical regressions on local persistence flows

## 22. Revision History
- 2026-03-14: Expanded technical requirements to comprehensive R&D specification format.
