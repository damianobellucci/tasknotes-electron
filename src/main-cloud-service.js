function createCloudService({
  cloudSyncUrl,
  cloudSyncApiKey,
  cloudSyncTimeoutMs,
  authManager
}) {
  function isCloudSyncEnabled() {
    return Boolean(cloudSyncUrl && (cloudSyncApiKey || authManager.isCognitoConfigured()));
  }

  function getMode() {
    return authManager.isCognitoConfigured() ? 'cognito' : 'shared-api-key';
  }

  function makeCloudUrl(relativePath) {
    return `${cloudSyncUrl}${relativePath}`;
  }

  async function cloudFetch(relativePath, options = {}) {
    if (!cloudSyncUrl) {
      return { ok: false, error: 'Cloud sync is not configured' };
    }

    let authHeaders = {};
    if (authManager.isCognitoConfigured()) {
      const idToken = await authManager.getCognitoIdToken();
      if (!idToken) {
        return { ok: false, error: 'Not logged in', code: 'UNAUTHENTICATED' };
      }
      authHeaders = { Authorization: `Bearer ${idToken}` };
    } else if (cloudSyncApiKey) {
      authHeaders = { 'x-api-key': cloudSyncApiKey };
    } else {
      return { ok: false, error: 'Cloud auth not configured' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cloudSyncTimeoutMs);

    try {
      const response = await fetch(makeCloudUrl(relativePath), {
        ...options,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...authHeaders,
          ...(options.headers || {})
        }
      });

      const text = await response.text();
      let payload = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { raw: text };
        }
      }

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: payload?.error || `HTTP ${response.status}`,
          ...payload
        };
      }

      return {
        ok: true,
        status: response.status,
        ...payload
      };
    } catch (error) {
      const timeoutError = error?.name === 'AbortError';
      return {
        ok: false,
        error: timeoutError ? 'Cloud request timed out' : (error?.message || 'Cloud request failed')
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function getStatus() {
    await authManager.ensureValidSession();
    return {
      ok: true,
      enabled: isCloudSyncEnabled(),
      mode: getMode(),
      apiUrl: cloudSyncUrl || '',
      cognitoConfigured: authManager.isCognitoConfigured(),
      loggedIn: authManager.isCognitoTokenValid(),
      email: authManager.getEmail()
    };
  }

  return {
    isCloudSyncEnabled,
    getMode,
    cloudFetch,
    getStatus
  };
}

module.exports = {
  createCloudService
};