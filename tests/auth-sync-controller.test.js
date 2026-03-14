import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import controllerModule from '../src/auth-sync-controller.js';

const { create } = controllerModule;

function createDeps(overrides = {}) {
  const loginModal = {
    classList: { add: vi.fn(), remove: vi.fn() },
    setAttribute: vi.fn()
  };

  const state = {
    authLoggedIn: true,
    authEmail: 'user@example.com',
    cloudSyncEnabled: true,
    cloudSyncTimer: null,
    cloudRetryTimer: null,
    tasks: [{ id: '1' }],
    notes: [{ id: 'n1' }],
    tags: [{ id: 't1' }],
    deletedSnapshot: { tasks: [] },
    cloudServerUpdatedAt: '2025-01-01T00:00:00.000Z',
    cloudBaseSnapshot: { tasks: [] },
    cloudLastSnapshotHash: 'hash',
    cloudLastSyncAt: '2025-01-01T00:00:00.000Z'
  };

  const deps = {
    state,
    refs: {
      loginModal,
      loginError: { textContent: '' },
      loginEmailInput: { value: '', focus: vi.fn() },
      loginPasswordInput: { value: '' },
      loginNewPasswordRow: { style: { display: 'none' } },
      loginNewPasswordInput: { value: '', focus: vi.fn() },
      loginSubmitButton: { textContent: '', disabled: false },
      loginButton: { style: { display: '' } },
      logoutButton: { style: { display: '' }, textContent: '' }
    },
    electronAPI: {
      getCloudSyncStatus: vi.fn().mockResolvedValue({ enabled: true, cognitoConfigured: true }),
      authGetStatus: vi.fn().mockResolvedValue({ loggedIn: false }),
      authLogout: vi.fn().mockResolvedValue({ ok: true }),
      cloudPull: vi.fn().mockResolvedValue({ ok: true }),
      cloudPush: vi.fn().mockResolvedValue({ ok: true })
    },
    cloudSyncIntervalMs: 30000,
    hasUnsyncedLocalChanges: vi.fn(() => false),
    getSerializableState: vi.fn(() => ({ tasks: [], notes: [], tags: [] })),
    persistStateToDisk: vi.fn().mockResolvedValue(undefined),
    cloneSnapshot: vi.fn((x) => structuredClone(x)),
    mergeSnapshots: vi.fn(),
    applyLoadedData: vi.fn(),
    render: vi.fn(),
    showToast: vi.fn(),
    setStatus: vi.fn(),
    formatDate: vi.fn(() => '-')
  };

  return { ...deps, ...overrides };
}

describe('auth-sync-controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens login modal when Cognito is configured and user is not logged in', async () => {
    const deps = createDeps();
    const controller = create(deps);

    await controller.initAuth();

    expect(deps.electronAPI.authGetStatus).toHaveBeenCalled();
    expect(deps.refs.loginModal.classList.add).toHaveBeenCalledWith('visible');
    expect(deps.refs.loginModal.setAttribute).toHaveBeenCalledWith('aria-hidden', 'false');
  });

  it('does not logout if user cancels unsynced changes confirmation', async () => {
    const deps = createDeps({
      hasUnsyncedLocalChanges: vi.fn(() => true)
    });
    const controller = create(deps);
    global.confirm = vi.fn(() => false);

    await controller.onLogout();

    expect(global.confirm).toHaveBeenCalled();
    expect(deps.electronAPI.authLogout).not.toHaveBeenCalled();
  });

  it('clears local workspace after confirmed logout', async () => {
    const deps = createDeps({
      hasUnsyncedLocalChanges: vi.fn(() => true),
      state: {
        authLoggedIn: true,
        authEmail: 'user@example.com',
        cloudSyncEnabled: true,
        cloudSyncTimer: 123,
        cloudRetryTimer: 456,
        tasks: [{ id: '1' }],
        notes: [{ id: 'n1' }],
        tags: [{ id: 't1' }],
        deletedSnapshot: { tasks: [] },
        cloudServerUpdatedAt: '2025-01-01T00:00:00.000Z',
        cloudBaseSnapshot: { tasks: [] },
        cloudLastSnapshotHash: 'hash',
        cloudLastSyncAt: '2025-01-01T00:00:00.000Z'
      }
    });
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout').mockImplementation(() => {});
    global.confirm = vi.fn(() => true);

    const controller = create(deps);
    await controller.onLogout();

    expect(deps.electronAPI.authLogout).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(123);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(456);
    expect(deps.state.tasks).toEqual([]);
    expect(deps.state.notes).toEqual([]);
    expect(deps.state.tags).toEqual([]);
    expect(deps.state.cloudBaseSnapshot).toBeNull();
    expect(deps.persistStateToDisk).toHaveBeenCalledTimes(1);
    expect(deps.render).toHaveBeenCalledTimes(1);
    expect(deps.setStatus).toHaveBeenCalledWith('Disconnesso');
  });
});
