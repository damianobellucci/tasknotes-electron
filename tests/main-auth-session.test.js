import { beforeEach, describe, expect, it, vi } from 'vitest';
import authSessionModule from '../src/main-auth-session.js';

const { createAuthSessionManager } = authSessionModule;

function createManager(overrides = {}) {
  const send = vi.fn();
  const fs = {
    unlink: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  };
  const safeStorage = {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn()
  };
  const ensureDataFile = vi.fn().mockResolvedValue(undefined);
  const writeJsonAtomic = vi.fn().mockResolvedValue(undefined);

  const manager = createAuthSessionManager({
    app: { getPath: () => '/tmp/tasknotes' },
    fs,
    path: { join: (...parts) => parts.join('/') },
    safeStorage,
    ensureDataFile,
    writeJsonAtomic,
    authSessionFileName: 'auth-session.json',
    cognitoRegion: 'eu-west-1',
    cognitoClientId: 'client-id',
    createCognitoClient: () => ({ send }),
    createInitiateAuthCommand: (input) => ({ type: 'initiate', input }),
    createRespondToAuthChallengeCommand: (input) => ({ type: 'challenge', input }),
    ...overrides
  });

  return { manager, send, fs, safeStorage, ensureDataFile, writeJsonAtomic };
}

describe('main-auth-session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists session after successful login', async () => {
    const { manager, send, writeJsonAtomic } = createManager();

    send.mockResolvedValue({
      AuthenticationResult: {
        IdToken: 'id-token',
        AccessToken: 'access-token',
        RefreshToken: 'refresh-token',
        ExpiresIn: 3600
      }
    });

    const result = await manager.login('user@example.com', 'Password123!');
    expect(result).toMatchObject({ ok: true, email: 'user@example.com' });

    expect(writeJsonAtomic).toHaveBeenCalledTimes(1);
    const [filePath, record] = writeJsonAtomic.mock.calls[0];
    expect(filePath).toBe('/tmp/tasknotes/auth-session.json');
    expect(record.encrypted).toBe(false);

    const payload = JSON.parse(record.payload);
    expect(payload).toMatchObject({
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      email: 'user@example.com'
    });

    const status = await manager.getStatus();
    expect(status).toMatchObject({ loggedIn: true, email: 'user@example.com', cognitoConfigured: true });
  });

  it('restores persisted session and refreshes expired token', async () => {
    const expiredPayload = JSON.stringify({
      idToken: 'old-id',
      accessToken: 'old-access',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 60_000,
      email: 'user@example.com'
    });

    const { manager, fs, send, writeJsonAtomic } = createManager();
    fs.readFile.mockResolvedValue(
      JSON.stringify({ version: 1, encrypted: false, payload: expiredPayload })
    );

    send.mockResolvedValue({
      AuthenticationResult: {
        IdToken: 'new-id-token',
        AccessToken: 'new-access-token',
        ExpiresIn: 3600
      }
    });

    await manager.restorePersistedAuthSession();

    const token = await manager.getCognitoIdToken();
    expect(token).toBe('new-id-token');
    expect(send).toHaveBeenCalledTimes(1);
    expect(writeJsonAtomic).toHaveBeenCalledTimes(1);

    const status = await manager.getStatus();
    expect(status).toMatchObject({ loggedIn: true, email: 'user@example.com' });
  });

  it('clears persisted session when restore refresh fails', async () => {
    const expiredPayload = JSON.stringify({
      idToken: 'old-id',
      accessToken: 'old-access',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 60_000,
      email: 'user@example.com'
    });

    const { manager, fs, send } = createManager();
    fs.readFile.mockResolvedValue(
      JSON.stringify({ version: 1, encrypted: false, payload: expiredPayload })
    );
    send.mockRejectedValue(new Error('refresh failed'));

    await manager.restorePersistedAuthSession();

    const status = await manager.getStatus();
    expect(status).toMatchObject({ loggedIn: false, email: '' });
    expect(fs.unlink).toHaveBeenCalledWith('/tmp/tasknotes/auth-session.json');
  });

  it('logout clears auth state and persisted session file', async () => {
    const { manager, send, fs } = createManager();

    send.mockResolvedValue({
      AuthenticationResult: {
        IdToken: 'id-token',
        AccessToken: 'access-token',
        RefreshToken: 'refresh-token',
        ExpiresIn: 3600
      }
    });

    await manager.login('user@example.com', 'Password123!');
    await manager.logout();

    const status = await manager.getStatus();
    expect(status).toMatchObject({ loggedIn: false, email: '' });
    expect(fs.unlink).toHaveBeenCalledWith('/tmp/tasknotes/auth-session.json');
  });
});
