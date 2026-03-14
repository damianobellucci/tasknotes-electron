const { CognitoIdentityProviderClient, InitiateAuthCommand, RespondToAuthChallengeCommand } = require('@aws-sdk/client-cognito-identity-provider');

function createAuthSessionManager({
  app,
  fs,
  path,
  safeStorage,
  ensureDataFile,
  writeJsonAtomic,
  authSessionFileName,
  cognitoRegion,
  cognitoClientId
}) {
  let cognitoTokens = null;

  function isCognitoConfigured() {
    return Boolean(cognitoRegion && cognitoClientId);
  }

  function isCognitoTokenValid() {
    return Boolean(cognitoTokens?.idToken && cognitoTokens.expiresAt > Date.now() + 30000);
  }

  function getAuthSessionFilePath() {
    return path.join(app.getPath('userData'), authSessionFileName);
  }

  async function clearPersistedAuthSession() {
    try {
      await fs.unlink(getAuthSessionFilePath());
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async function persistAuthSession() {
    if (!cognitoTokens?.email || (!cognitoTokens?.idToken && !cognitoTokens?.refreshToken)) {
      await clearPersistedAuthSession();
      return;
    }

    await ensureDataFile();
    const payloadText = JSON.stringify({
      idToken: cognitoTokens.idToken || '',
      accessToken: cognitoTokens.accessToken || '',
      refreshToken: cognitoTokens.refreshToken || '',
      expiresAt: Number(cognitoTokens.expiresAt || 0),
      email: cognitoTokens.email || ''
    });

    const encrypted = safeStorage.isEncryptionAvailable();
    const record = encrypted
      ? {
        version: 1,
        encrypted: true,
        payload: safeStorage.encryptString(payloadText).toString('base64')
      }
      : {
        version: 1,
        encrypted: false,
        payload: payloadText
      };

    await writeJsonAtomic(getAuthSessionFilePath(), record);
  }

  async function readPersistedAuthSession() {
    await ensureDataFile();

    let raw;
    try {
      raw = await fs.readFile(getAuthSessionFilePath(), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    let payloadText = '';
    if (parsed?.encrypted) {
      if (!safeStorage.isEncryptionAvailable()) {
        return null;
      }
      try {
        payloadText = safeStorage.decryptString(Buffer.from(String(parsed.payload || ''), 'base64'));
      } catch {
        return null;
      }
    } else {
      payloadText = String(parsed?.payload || '');
    }

    try {
      const payload = JSON.parse(payloadText);
      return {
        idToken: typeof payload?.idToken === 'string' ? payload.idToken : '',
        accessToken: typeof payload?.accessToken === 'string' ? payload.accessToken : '',
        refreshToken: typeof payload?.refreshToken === 'string' ? payload.refreshToken : '',
        expiresAt: Number(payload?.expiresAt || 0),
        email: typeof payload?.email === 'string' ? payload.email : ''
      };
    } catch {
      return null;
    }
  }

  async function refreshCognitoToken() {
    if (!cognitoTokens?.refreshToken) return false;
    try {
      const client = new CognitoIdentityProviderClient({ region: cognitoRegion });
      const cmd = new InitiateAuthCommand({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: cognitoClientId,
        AuthParameters: { REFRESH_TOKEN: cognitoTokens.refreshToken }
      });
      const data = await client.send(cmd);
      if (!data?.AuthenticationResult?.IdToken) return false;
      cognitoTokens = {
        ...cognitoTokens,
        idToken: data.AuthenticationResult.IdToken,
        accessToken: data.AuthenticationResult.AccessToken,
        expiresAt: Date.now() + (data.AuthenticationResult.ExpiresIn || 3600) * 1000
      };
      await persistAuthSession();
      return true;
    } catch {
      return false;
    }
  }

  async function getCognitoIdToken() {
    if (isCognitoTokenValid()) return cognitoTokens.idToken;
    if (cognitoTokens?.refreshToken) {
      const refreshed = await refreshCognitoToken();
      if (refreshed) return cognitoTokens.idToken;
    }
    return null;
  }

  async function ensureValidSession() {
    if (isCognitoConfigured() && !isCognitoTokenValid() && cognitoTokens?.refreshToken) {
      await refreshCognitoToken();
    }
  }

  async function restorePersistedAuthSession() {
    if (!isCognitoConfigured()) {
      cognitoTokens = null;
      return;
    }

    const session = await readPersistedAuthSession();
    if (!session?.email || (!session?.idToken && !session?.refreshToken)) {
      cognitoTokens = null;
      return;
    }

    cognitoTokens = {
      idToken: session.idToken || '',
      accessToken: session.accessToken || '',
      refreshToken: session.refreshToken || '',
      expiresAt: Number(session.expiresAt || 0),
      email: session.email
    };

    if (!isCognitoTokenValid() && cognitoTokens.refreshToken) {
      const refreshed = await refreshCognitoToken();
      if (!refreshed) {
        cognitoTokens = null;
        await clearPersistedAuthSession();
      }
    }
  }

  async function login(email, password) {
    if (!isCognitoConfigured()) {
      return { ok: false, error: 'Cognito is not configured' };
    }
    try {
      const client = new CognitoIdentityProviderClient({ region: cognitoRegion });
      const cmd = new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: cognitoClientId,
        AuthParameters: { USERNAME: email, PASSWORD: password }
      });
      const data = await client.send(cmd);
      if (data?.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        return { ok: false, newPasswordRequired: true, session: data.Session, email };
      }
      const result = data?.AuthenticationResult;
      if (!result?.IdToken) {
        return { ok: false, error: `Risposta inattesa: ${data?.ChallengeName || 'nessun token'}` };
      }
      cognitoTokens = {
        idToken: result.IdToken,
        accessToken: result.AccessToken,
        refreshToken: result.RefreshToken,
        expiresAt: Date.now() + (result.ExpiresIn || 3600) * 1000,
        email
      };
      await persistAuthSession();
      return { ok: true, email };
    } catch (err) {
      const type = err?.name || '';
      let msg = err?.message || 'Login failed';
      if (type === 'NotAuthorizedException') msg = 'Email o password errati';
      if (type === 'UserNotFoundException') msg = 'Utente non trovato';
      if (type === 'UserNotConfirmedException') msg = 'Account non confermato';
      return { ok: false, error: msg };
    }
  }

  async function completeNewPassword(email, newPassword, session) {
    if (!isCognitoConfigured()) return { ok: false, error: 'Cognito non configurato' };
    try {
      const client = new CognitoIdentityProviderClient({ region: cognitoRegion });
      const cmd = new RespondToAuthChallengeCommand({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: cognitoClientId,
        Session: session,
        ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword }
      });
      const data = await client.send(cmd);
      const result = data?.AuthenticationResult;
      if (!result?.IdToken) return { ok: false, error: 'Risposta inattesa dopo cambio password' };
      cognitoTokens = {
        idToken: result.IdToken,
        accessToken: result.AccessToken,
        refreshToken: result.RefreshToken || cognitoTokens?.refreshToken,
        expiresAt: Date.now() + (result.ExpiresIn || 3600) * 1000,
        email
      };
      await persistAuthSession();
      return { ok: true, email };
    } catch (err) {
      return { ok: false, error: err?.message || 'Errore cambio password' };
    }
  }

  async function logout() {
    cognitoTokens = null;
    await clearPersistedAuthSession();
    return { ok: true };
  }

  async function getStatus() {
    await ensureValidSession();
    return {
      ok: true,
      cognitoConfigured: isCognitoConfigured(),
      loggedIn: isCognitoTokenValid(),
      email: cognitoTokens?.email || ''
    };
  }

  function getEmail() {
    return cognitoTokens?.email || '';
  }

  return {
    isCognitoConfigured,
    isCognitoTokenValid,
    getCognitoIdToken,
    ensureValidSession,
    restorePersistedAuthSession,
    login,
    completeNewPassword,
    logout,
    getStatus,
    getEmail
  };
}

module.exports = {
  createAuthSessionManager
};