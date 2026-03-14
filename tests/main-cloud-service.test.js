import { beforeEach, describe, expect, it, vi } from 'vitest';
import cloudServiceModule from '../src/main-cloud-service.js';

const { createCloudService } = cloudServiceModule;

describe('main-cloud-service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('returns unauthenticated when Cognito is configured but token is missing', async () => {
    const service = createCloudService({
      cloudSyncUrl: 'https://example.com',
      cloudSyncApiKey: '',
      cloudSyncTimeoutMs: 1000,
      authManager: {
        isCognitoConfigured: () => true,
        getCognitoIdToken: vi.fn().mockResolvedValue(null),
        ensureValidSession: vi.fn(),
        isCognitoTokenValid: () => false,
        getEmail: () => ''
      }
    });

    const result = await service.cloudFetch('/sync/pull');
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('uses shared api key when Cognito is not configured', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, snapshot: null })
    });

    const service = createCloudService({
      cloudSyncUrl: 'https://example.com',
      cloudSyncApiKey: 'secret-key',
      cloudSyncTimeoutMs: 1000,
      authManager: {
        isCognitoConfigured: () => false,
        getCognitoIdToken: vi.fn(),
        ensureValidSession: vi.fn(),
        isCognitoTokenValid: () => false,
        getEmail: () => ''
      }
    });

    await service.cloudFetch('/sync/pull');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/sync/pull',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'secret-key' })
      })
    );
  });

  it('maps non-200 responses into structured errors', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ error: 'Sync conflict', conflict: true })
    });

    const service = createCloudService({
      cloudSyncUrl: 'https://example.com',
      cloudSyncApiKey: 'secret-key',
      cloudSyncTimeoutMs: 1000,
      authManager: {
        isCognitoConfigured: () => false,
        getCognitoIdToken: vi.fn(),
        ensureValidSession: vi.fn(),
        isCognitoTokenValid: () => false,
        getEmail: () => ''
      }
    });

    const result = await service.cloudFetch('/sync/push', { method: 'POST' });
    expect(result).toMatchObject({ ok: false, status: 409, conflict: true, error: 'Sync conflict' });
  });

  it('reports cloud status from auth manager and configuration', async () => {
    const ensureValidSession = vi.fn();
    const service = createCloudService({
      cloudSyncUrl: 'https://example.com',
      cloudSyncApiKey: '',
      cloudSyncTimeoutMs: 1000,
      authManager: {
        isCognitoConfigured: () => true,
        getCognitoIdToken: vi.fn(),
        ensureValidSession,
        isCognitoTokenValid: () => true,
        getEmail: () => 'user@example.com'
      }
    });

    const status = await service.getStatus();
    expect(ensureValidSession).toHaveBeenCalled();
    expect(status).toMatchObject({ ok: true, enabled: true, mode: 'cognito', loggedIn: true, email: 'user@example.com' });
  });
});