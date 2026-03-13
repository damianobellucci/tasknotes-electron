const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const DATA_FILE_NAME = 'task-manager-data.json';
const APP_VERSION = 1;

let dataFilePath = '';

function defaultData() {
  return {
    tasks: [],
    notes: [],
    settings: {
      taskSort: 'manual',
      noteSort: 'manual'
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

function sanitizeTask(task, index) {
  const now = toIsoNow();
  const priorityRaw = asInt(task?.priority, 5);
  const priority = Math.min(10, Math.max(1, priorityRaw));

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
    archived: Boolean(task?.archived)
  };
}

function sanitizeNote(note, index) {
  const now = toIsoNow();

  return {
    id: typeof note?.id === 'string' && note.id.trim() ? note.id : `note-${Date.now()}-${index}`,
    type: 'note',
    text: typeof note?.text === 'string' ? note.text : '',
    createdAt: typeof note?.createdAt === 'string' ? note.createdAt : now,
    updatedAt: typeof note?.updatedAt === 'string' ? note.updatedAt : now,
    editCount: Math.max(0, asInt(note?.editCount, 0)),
    manualOrder: asInt(note?.manualOrder, index)
  };
}

function sanitizeData(rawData) {
  const base = defaultData();
  const tasks = Array.isArray(rawData?.tasks) ? rawData.tasks.map(sanitizeTask) : [];
  const notes = Array.isArray(rawData?.notes) ? rawData.notes.map(sanitizeNote) : [];

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
    settings,
    version: APP_VERSION
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

async function ensureDataFile() {
  const userDataPath = app.getPath('userData');
  dataFilePath = path.join(userDataPath, DATA_FILE_NAME);

  await fs.mkdir(userDataPath, { recursive: true });

  try {
    await fs.access(dataFilePath);
  } catch {
    await writeJsonAtomic(dataFilePath, defaultData());
  }
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
    dataFilePath
  };
});

ipcMain.handle('data:save', async (_event, nextData) => {
  return saveData(nextData);
});

ipcMain.handle('app:info', async () => {
  await ensureDataFile();
  return {
    dataFilePath,
    userDataPath: app.getPath('userData'),
    platform: process.platform,
    appVersion: app.getVersion()
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

app.whenReady().then(() => {
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
