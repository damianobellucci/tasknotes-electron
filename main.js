const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const fs = require('fs/promises');
const path = require('path');
try {
  const _envPath = app.isPackaged
    ? path.join(process.resourcesPath, '.env')
    : path.join(__dirname, '.env');
  require('dotenv').config({ path: _envPath });
} catch {
  // dotenv is optional in packaged builds.
}
const { CognitoIdentityProviderClient, InitiateAuthCommand, RespondToAuthChallengeCommand } = require('@aws-sdk/client-cognito-identity-provider');

const DATA_FILE_NAME = 'task-manager-data.json';
const DATA_SOURCE_FILE_NAME = 'tasknotes-data-source.json';
const AUTH_SESSION_FILE_NAME = 'tasknotes-auth-session.json';
const APP_VERSION = 1;
const CLOUD_SYNC_URL = String(process.env.TASKNOTES_SYNC_URL || '').trim().replace(/\/+$/, '');
const CLOUD_SYNC_API_KEY = String(process.env.TASKNOTES_SYNC_API_KEY || '').trim();
const CLOUD_SYNC_TIMEOUT_MS = asInt(process.env.TASKNOTES_SYNC_TIMEOUT_MS, 12000);
const COGNITO_REGION = String(process.env.TASKNOTES_COGNITO_REGION || '').trim();
const COGNITO_CLIENT_ID = String(process.env.TASKNOTES_COGNITO_CLIENT_ID || '').trim();

// Cognito token storage in memory, with encrypted persistence in userData.
let cognitoTokens = null; // { idToken, accessToken, refreshToken, expiresAt, email }

let dataFilePath = '';
let defaultDataFilePath = '';
let dataSourceConfigPath = '';
let userDataPath = '';

function getDefaultDataSourceConfig() {
  return {
    dataFilePath: '',
    labels: {},
    updatedAt: toIsoNow()
  };
}

function defaultData() {
  return {
    tasks: [],
    notes: [],
    tags: [],
    settings: {
      taskSort: 'manual',
      noteSort: 'manual'
    },
    sync: {
      serverUpdatedAt: '',
      lastSyncedSnapshot: null
    },
    version: APP_VERSION
  };
}

function toIsoNow() {
  return new Date().toISOString();
}

function asInt(value, fallback = 0) {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeTag(rawTag) {
  return String(rawTag || '').trim().replace(/\s+/g, ' ').slice(0, 32);
}

function sanitizeTagList(rawTags) {
  if (!Array.isArray(rawTags)) {
    return [];
  }

  const seen = new Set();
  const tags = [];

  rawTags.forEach((tag) => {
    const normalized = normalizeTag(tag);
    if (!normalized) {
      return;
    }

    const dedupeKey = normalized.toLocaleLowerCase();
    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    tags.push(normalized);
  });

  return tags;
}

function sanitizeTask(task, index) {
  const now = toIsoNow();
  const priorityRaw = asInt(task?.priority, 5);
  const priority = Math.min(10, Math.max(1, priorityRaw));
  const isDeleted = Boolean(task?.isDeleted);

  return {
    id: typeof task?.id === 'string' && task.id.trim() ? task.id : `task-${Date.now()}-${index}`,
    type: 'task',
    text: typeof task?.text === 'string' ? task.text : '',
    done: Boolean(task?.done),
    priority,
    createdAt: typeof task?.createdAt === 'string' ? task.createdAt : now,
    updatedAt: typeof task?.updatedAt === 'string' ? task.updatedAt : now,
    editCount: Math.max(0, asInt(task?.editCount, 0)),
    manualOrder: asInt(task?.manualOrder, index),
    archived: Boolean(task?.archived),
    tags: sanitizeTagList(task?.tags),
    isDeleted,
    deletedAt: isDeleted && typeof task?.deletedAt === 'string' ? task.deletedAt : null
  };
}

function sanitizeNote(note, index) {
  const now = toIsoNow();
  const isDeleted = Boolean(note?.isDeleted);

  return {
    id: typeof note?.id === 'string' && note.id.trim() ? note.id : `note-${Date.now()}-${index}`,
    type: 'note',
    text: typeof note?.text === 'string' ? note.text : '',
    createdAt: typeof note?.createdAt === 'string' ? note.createdAt : now,
    updatedAt: typeof note?.updatedAt === 'string' ? note.updatedAt : now,
    editCount: Math.max(0, asInt(note?.editCount, 0)),
    manualOrder: asInt(note?.manualOrder, index),
    tags: sanitizeTagList(note?.tags),
    isDeleted,
    deletedAt: isDeleted && typeof note?.deletedAt === 'string' ? note.deletedAt : null
  };
}

function sanitizeSnapshot(rawData) {
  const base = defaultData();
  const tasks = Array.isArray(rawData?.tasks) ? rawData.tasks.map(sanitizeTask) : [];
  const notes = Array.isArray(rawData?.notes) ? rawData.notes.map(sanitizeNote) : [];
  const storedTags = sanitizeTagList(rawData?.tags);
  const usedTags = sanitizeTagList([
    ...tasks.flatMap((task) => task.tags || []),
    ...notes.flatMap((note) => note.tags || [])
  ]);
  const tags = sanitizeTagList([...storedTags, ...usedTags]);

  const settings = {
    taskSort: ['manual', 'created-desc', 'created-asc', 'priority-desc', 'priority-asc'].includes(rawData?.settings?.taskSort)
      ? rawData.settings.taskSort
      : base.settings.taskSort,
    noteSort: ['manual', 'created-desc', 'created-asc'].includes(rawData?.settings?.noteSort)
      ? rawData.settings.noteSort
      : base.settings.noteSort
  };

  return {
    tasks,
    notes,
    tags,
    settings,
    version: APP_VERSION
  };
}

function sanitizeSyncState(rawSync) {
  const lastSyncedSnapshot = rawSync?.lastSyncedSnapshot && typeof rawSync.lastSyncedSnapshot === 'object'
    ? sanitizeSnapshot(rawSync.lastSyncedSnapshot)
    : null;

  return {
    serverUpdatedAt: typeof rawSync?.serverUpdatedAt === 'string' ? rawSync.serverUpdatedAt : '',
    lastSyncedSnapshot
  };
}

function sanitizeData(rawData) {
  const snapshot = sanitizeSnapshot(rawData);
  return {
    ...snapshot,
    sync: sanitizeSyncState(rawData?.sync)
  };
}

async function backupCorruptedFile(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.corrupt-${stamp}.bak`;
  await fs.copyFile(filePath, backupPath);
}

async function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;
  const json = `${JSON.stringify(data, null, 2)}\n`;

  try {
    await fs.access(filePath);
    await fs.copyFile(filePath, bakPath);
  } catch {
    // First write: no previous file to back up.
  }

  await fs.writeFile(tmpPath, json, 'utf8');
  await fs.rename(tmpPath, filePath);
}

async function ensureJsonDataFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.access(filePath);
  } catch {
    await writeJsonAtomic(filePath, defaultData());
  }
}

async function readSelectedDataFilePath() {
  const config = await readDataSourceConfig();
  if (typeof config.dataFilePath === 'string' && config.dataFilePath.trim()) {
    return path.resolve(config.dataFilePath);
  }

  return defaultDataFilePath;
}

async function readDataSourceConfig() {
  try {
    const raw = await fs.readFile(dataSourceConfigPath, 'utf8');
    const parsed = JSON.parse(raw);

    return {
      dataFilePath: typeof parsed?.dataFilePath === 'string' ? parsed.dataFilePath : '',
      labels: parsed?.labels && typeof parsed.labels === 'object' ? parsed.labels : {},
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : toIsoNow()
    };
  } catch {
    return getDefaultDataSourceConfig();
  }
}

async function saveSelectedDataFilePath(filePath) {
  const config = await readDataSourceConfig();
  await writeJsonAtomic(dataSourceConfigPath, {
    dataFilePath: path.resolve(filePath),
    labels: config.labels || {},
    updatedAt: toIsoNow()
  });
}

async function saveDataSourceConfig(configPatch) {
  const current = await readDataSourceConfig();
  const next = {
    ...current,
    ...configPatch,
    labels: {
      ...(current.labels || {}),
      ...(configPatch?.labels || {})
    },
    updatedAt: toIsoNow()
  };

  await writeJsonAtomic(dataSourceConfigPath, next);
}

async function setActiveDataFile(filePath, persistSelection = true) {
  dataFilePath = path.resolve(filePath);
  await ensureJsonDataFile(dataFilePath);
  if (persistSelection) {
    await saveSelectedDataFilePath(dataFilePath);
  }
}

async function ensureDataFile() {
  userDataPath = app.getPath('userData');
  defaultDataFilePath = path.join(userDataPath, DATA_FILE_NAME);
  dataSourceConfigPath = path.join(userDataPath, DATA_SOURCE_FILE_NAME);

  await fs.mkdir(userDataPath, { recursive: true });

  if (!dataFilePath) {
    const selectedPath = await readSelectedDataFilePath();
    await setActiveDataFile(selectedPath, false);
  }
}

function getAuthSessionFilePath() {
  const basePath = userDataPath || app.getPath('userData');
  return path.join(basePath, AUTH_SESSION_FILE_NAME);
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
      return;
    }
  }
}

function isAllowedDataJsonName(fileName) {
  if (typeof fileName !== 'string') {
    return false;
  }

  if (!fileName.endsWith('.json')) {
    return false;
  }

  if (fileName.includes(path.sep) || fileName.includes('..')) {
    return false;
  }

  if (fileName === DATA_SOURCE_FILE_NAME) {
    return false;
  }

  return true;
}

function normalizeUserDataFileName(rawName) {
  const base = String(rawName || '')
    .trim()
    .replace(/\.json$/i, '')
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');

  return base ? `${base}.json` : '';
}

function normalizeUserDataFileLabel(rawName) {
  const base = String(rawName || '').trim().replace(/\.json$/i, '');
  return base;
}

async function listDataFileCandidates() {
  await ensureDataFile();
  const config = await readDataSourceConfig();
  const labels = config.labels || {};
  const entries = await fs.readdir(userDataPath, { withFileTypes: true });

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => isAllowedDataJsonName(name))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  return files.map((name) => {
    const filePath = path.join(userDataPath, name);
    const displayName = typeof labels[name] === 'string' && labels[name].trim()
      ? labels[name].trim()
      : name.replace(/\.json$/i, '');

    return {
      name,
      displayName,
      path: filePath,
      isCurrent: path.resolve(filePath) === path.resolve(dataFilePath),
      isDefault: path.resolve(filePath) === path.resolve(defaultDataFilePath)
    };
  });
}

async function createDataFileCandidate(rawName) {
  await ensureDataFile();
  const fileName = normalizeUserDataFileName(rawName);
  const displayName = normalizeUserDataFileLabel(rawName);

  if (!isAllowedDataJsonName(fileName)) {
    throw new Error('Invalid file name. Use a .json name without path separators.');
  }

  if (!displayName) {
    throw new Error('Invalid file name. Please type a visible label.');
  }

  const targetPath = path.join(userDataPath, fileName);
  await ensureJsonDataFile(targetPath);
  await setActiveDataFile(targetPath, true);
  await saveDataSourceConfig({ labels: { [fileName]: displayName } });
  const data = await loadData();
  return {
    ok: true,
    data,
    dataFilePath,
    defaultDataFilePath,
    ...(await getActiveDataSourceMeta()),
    candidates: await listDataFileCandidates()
  };
}

async function getActiveDataSourceMeta() {
  const candidates = await listDataFileCandidates();
  const current = candidates.find((item) => item.isCurrent);
  return {
    activeDataFileDisplayName: current?.displayName || path.basename(dataFilePath, '.json'),
    isDefaultDataFile: path.resolve(dataFilePath) === path.resolve(defaultDataFilePath)
  };
}

async function loadData() {
  await ensureDataFile();

  try {
    const raw = await fs.readFile(dataFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    const data = sanitizeData(parsed);

    // Normalize shape so older or malformed records are repaired.
    await writeJsonAtomic(dataFilePath, data);
    return data;
  } catch (error) {
    try {
      await backupCorruptedFile(dataFilePath);
    } catch {
      // Ignore backup errors to avoid blocking recovery.
    }

    const fresh = defaultData();
    await writeJsonAtomic(dataFilePath, fresh);
    return fresh;
  }
}

async function saveData(nextData) {
  await ensureDataFile();
  const sanitized = sanitizeData(nextData);
  await writeJsonAtomic(dataFilePath, sanitized);
  return { ok: true, savedAt: toIsoNow() };
}

function isCognitoConfigured() {
  return Boolean(COGNITO_REGION && COGNITO_CLIENT_ID);
}

function isCloudSyncEnabled() {
  return Boolean(CLOUD_SYNC_URL && (CLOUD_SYNC_API_KEY || isCognitoConfigured()));
}

function isCognitoTokenValid() {
  return Boolean(cognitoTokens?.idToken && cognitoTokens.expiresAt > Date.now() + 30000);
}

async function refreshCognitoToken() {
  if (!cognitoTokens?.refreshToken) return false;
  try {
    const client = new CognitoIdentityProviderClient({ region: COGNITO_REGION });
    const cmd = new InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: COGNITO_CLIENT_ID,
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

function makeCloudUrl(relativePath) {
  return `${CLOUD_SYNC_URL}${relativePath}`;
}

async function cloudFetch(relativePath, options = {}) {
  if (!CLOUD_SYNC_URL) {
    return { ok: false, error: 'Cloud sync is not configured' };
  }

  let authHeaders = {};
  if (isCognitoConfigured()) {
    const idToken = await getCognitoIdToken();
    if (!idToken) {
      return { ok: false, error: 'Not logged in', code: 'UNAUTHENTICATED' };
    }
    authHeaders = { Authorization: `Bearer ${idToken}` };
  } else if (CLOUD_SYNC_API_KEY) {
    authHeaders = { 'x-api-key': CLOUD_SYNC_API_KEY };
  } else {
    return { ok: false, error: 'Cloud auth not configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_SYNC_TIMEOUT_MS);

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

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

ipcMain.handle('data:load', async () => {
  const data = await loadData();
  return {
    ok: true,
    data,
    dataFilePath,
    defaultDataFilePath,
    ...(await getActiveDataSourceMeta())
  };
});

ipcMain.handle('data:save', async (_event, nextData) => {
  return saveData(nextData);
});

ipcMain.handle('app:info', async () => {
  await ensureDataFile();
  return {
    dataFilePath,
    defaultDataFilePath,
    ...(await getActiveDataSourceMeta()),
    userDataPath: app.getPath('userData'),
    platform: process.platform,
    appVersion: app.getVersion(),
    cloudSyncEnabled: isCloudSyncEnabled(),
    cloudSyncMode: isCognitoConfigured() ? 'cognito' : 'shared-api-key'
  };
});

ipcMain.handle('cloud:status', async () => {
  if (isCognitoConfigured() && !isCognitoTokenValid() && cognitoTokens?.refreshToken) {
    await refreshCognitoToken();
  }

  return {
    ok: true,
    enabled: isCloudSyncEnabled(),
    mode: isCognitoConfigured() ? 'cognito' : 'shared-api-key',
    apiUrl: CLOUD_SYNC_URL || '',
    cognitoConfigured: isCognitoConfigured(),
    loggedIn: isCognitoTokenValid(),
    email: cognitoTokens?.email || ''
  };
});

ipcMain.handle('auth:login', async (_event, { email, password }) => {
  if (!isCognitoConfigured()) {
    return { ok: false, error: 'Cognito is not configured' };
  }
  try {
    const client = new CognitoIdentityProviderClient({ region: COGNITO_REGION });
    const cmd = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
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
});

ipcMain.handle('auth:new-password', async (_event, { email, newPassword, session }) => {
  if (!isCognitoConfigured()) return { ok: false, error: 'Cognito non configurato' };
  try {
    const client = new CognitoIdentityProviderClient({ region: COGNITO_REGION });
    const cmd = new RespondToAuthChallengeCommand({
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ClientId: COGNITO_CLIENT_ID,
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
});

ipcMain.handle('auth:logout', async () => {
  cognitoTokens = null;
  await clearPersistedAuthSession();
  return { ok: true };
});

ipcMain.handle('auth:status', async () => {
  if (isCognitoConfigured() && !isCognitoTokenValid() && cognitoTokens?.refreshToken) {
    await refreshCognitoToken();
  }

  return {
    ok: true,
    cognitoConfigured: isCognitoConfigured(),
    loggedIn: isCognitoTokenValid(),
    email: cognitoTokens?.email || ''
  };
});

ipcMain.handle('cloud:push', async (_event, payload) => {
  const snapshot = sanitizeSnapshot(payload?.snapshot || payload?.data || payload || defaultData());
  const clientUpdatedAt = typeof payload?.clientUpdatedAt === 'string' ? payload.clientUpdatedAt : toIsoNow();
  const baseServerUpdatedAt = typeof payload?.baseServerUpdatedAt === 'string' ? payload.baseServerUpdatedAt : '';

  const result = await cloudFetch('/sync/push', {
    method: 'POST',
    body: JSON.stringify({
      snapshot,
      clientUpdatedAt,
      baseServerUpdatedAt
    })
  });

  if (result?.snapshot) {
    return {
      ...result,
      snapshot: sanitizeSnapshot(result.snapshot)
    };
  }

  return result;
});

ipcMain.handle('cloud:pull', async (_event, payload) => {
  const since = typeof payload?.since === 'string' ? payload.since : '';
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  const result = await cloudFetch(`/sync/pull${query}`, { method: 'GET' });

  if (!result?.ok) {
    return result;
  }

  if (result.snapshot) {
    return {
      ...result,
      snapshot: sanitizeSnapshot(result.snapshot)
    };
  }

  if (result.data) {
    return {
      ...result,
      data: sanitizeSnapshot(result.data)
    };
  }

  return result;
});

ipcMain.handle('data:select-file', async () => {
  const candidates = await listDataFileCandidates();
  return {
    ok: true,
    candidates,
    dataFilePath,
    defaultDataFilePath,
    ...(await getActiveDataSourceMeta())
  };
});

ipcMain.handle('data:activate-file', async (_event, fileName) => {
  await ensureDataFile();
  const safeName = String(fileName || '').trim();
  if (!isAllowedDataJsonName(safeName)) {
    return { ok: false, error: 'Invalid file name' };
  }

  const nextPath = path.join(userDataPath, safeName);
  await setActiveDataFile(nextPath, true);
  const data = await loadData();
  return {
    ok: true,
    data,
    dataFilePath,
    defaultDataFilePath,
    ...(await getActiveDataSourceMeta()),
    candidates: await listDataFileCandidates()
  };
});

ipcMain.handle('data:create-file', async (_event, fileName) => {
  try {
    return await createDataFileCandidate(fileName);
  } catch (error) {
    return { ok: false, error: error.message || 'Unable to create data file' };
  }
});

ipcMain.handle('data:use-default-file', async () => {
  await ensureDataFile();
  await setActiveDataFile(defaultDataFilePath, true);
  const data = await loadData();
  return {
    ok: true,
    data,
    dataFilePath,
    defaultDataFilePath,
    ...(await getActiveDataSourceMeta())
  };
});

ipcMain.handle('data:export', async (_event, payload) => {
  const defaultName = `tasknotes-export-${new Date().toISOString().slice(0, 10)}.json`;
  const result = await dialog.showSaveDialog({
    title: 'Export Data',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  const data = sanitizeData(payload);
  await fs.writeFile(result.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return { ok: true, filePath: result.filePath };
});

ipcMain.handle('data:import', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Import Data',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }

  const importPath = result.filePaths[0];
  const raw = await fs.readFile(importPath, 'utf8');
  const parsed = JSON.parse(raw);
  const importedData = sanitizeData(parsed);

  await saveData(importedData);
  return { ok: true, data: importedData, filePath: importPath };
});

app.whenReady().then(async () => {
  await ensureDataFile();
  await restorePersistedAuthSession();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
