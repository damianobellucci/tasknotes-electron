const SAVE_DEBOUNCE_MS = 450;
const UNDO_TIMEOUT_MS = 5000;
const CLOUD_SYNC_INTERVAL_MS = 30000;

const state = {
  tasks: [],
  notes: [],
  settings: {
    taskSort: 'manual',
    noteSort: 'manual'
  },
  version: 1,
  view: 'tasks',
  taskFilter: 'all',
  tagFilter: 'all',
  search: '',
  tags: [],
  dataFilePath: '',
  defaultDataFilePath: '',
  activeDataFileDisplayName: '',
  isDefaultDataFile: false,
  dataFileCandidates: [],
  saveTimer: null,
  saveInFlight: false,
  pendingSave: false,
  deletedSnapshot: null,
  undoTimer: null,
  toastTimer: null,
  dragItemId: null,
  cloudSyncEnabled: false,
  cloudSyncInFlight: false,
  cloudSyncPendingPush: false,
  cloudSyncTimer: null,
  cloudRetryTimer: null,
  cloudLastSyncAt: '',
  cloudServerUpdatedAt: '',
  cloudLastSnapshotHash: '',
  cloudBaseSnapshot: null,
  authLoggedIn: false,
  authEmail: ''
};

const refs = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindRefs();
  bindStaticEvents();
  await loadInitialData();
  await initAuth();
  render();
}

function bindRefs() {
  refs.tabTasks = document.getElementById('tabTasks');
  refs.tabNotes = document.getElementById('tabNotes');
  refs.tabTrash = document.getElementById('tabTrash');
  refs.newItemButton = document.getElementById('newItemButton');
  refs.sortSelect = document.getElementById('sortSelect');
  refs.taskFilterWrap = document.getElementById('taskFilterWrap');
  refs.taskFilterSelect = document.getElementById('taskFilterSelect');
  refs.searchInput = document.getElementById('searchInput');
  refs.tagFilterSelect = document.getElementById('tagFilterSelect');
  refs.newTagInput = document.getElementById('newTagInput');
  refs.addTagButton = document.getElementById('addTagButton');
  refs.globalTagsBar = document.getElementById('globalTagsBar');
  refs.exportButton = document.getElementById('exportButton');
  refs.importButton = document.getElementById('importButton');
  refs.selectDataFileButton = document.getElementById('selectDataFileButton');
  refs.defaultDataFileButton = document.getElementById('defaultDataFileButton');
  refs.loginButton = document.getElementById('loginButton');
  refs.logoutButton = document.getElementById('logoutButton');
  refs.loginModal = document.getElementById('loginModal');
  refs.loginEmailInput = document.getElementById('loginEmailInput');
  refs.loginPasswordInput = document.getElementById('loginPasswordInput');
  refs.loginError = document.getElementById('loginError');
  refs.loginSubmitButton = document.getElementById('loginSubmitButton');
  refs.loginSkipButton = document.getElementById('loginSkipButton');
  refs.loginNewPasswordRow = document.getElementById('loginNewPasswordRow');
  refs.loginNewPasswordInput = document.getElementById('loginNewPasswordInput');
  refs.activeDataHint = document.getElementById('activeDataHint');
  refs.taskStats = document.getElementById('taskStats');
  refs.listContainer = document.getElementById('listContainer');
  refs.statusText = document.getElementById('statusText');
  refs.dataPathText = document.getElementById('dataPathText');
  refs.toast = document.getElementById('toast');
  refs.toastMessage = document.getElementById('toastMessage');
  refs.toastUndo = document.getElementById('toastUndo');
  refs.dataPickerModal = document.getElementById('dataPickerModal');
  refs.dataPickerList = document.getElementById('dataPickerList');
  refs.newDataFileInput = document.getElementById('newDataFileInput');
  refs.createDataFileButton = document.getElementById('createDataFileButton');
  refs.closeDataPickerButton = document.getElementById('closeDataPickerButton');
}

function bindStaticEvents() {
  refs.tabTasks.addEventListener('click', () => switchView('tasks'));
  refs.tabNotes.addEventListener('click', () => switchView('notes'));
  refs.tabTrash.addEventListener('click', () => switchView('trash'));

  refs.newItemButton.addEventListener('click', () => {
    if (state.view === 'tasks') {
      createTask();
      return;
    }
    createNote();
  });

  refs.sortSelect.addEventListener('change', () => {
    if (state.view === 'tasks') {
      state.settings.taskSort = refs.sortSelect.value;
    } else {
      state.settings.noteSort = refs.sortSelect.value;
    }
    queueSave();
    render();
  });

  refs.taskFilterSelect.addEventListener('change', () => {
    state.taskFilter = refs.taskFilterSelect.value;
    render();
  });

  refs.searchInput.addEventListener('input', () => {
    state.search = refs.searchInput.value.toLowerCase().trim();
    render();
  });

  refs.tagFilterSelect.addEventListener('change', () => {
    state.tagFilter = refs.tagFilterSelect.value;
    render();
  });

  refs.addTagButton.addEventListener('click', onCreateGlobalTag);
  refs.newTagInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCreateGlobalTag();
    }
  });

  refs.exportButton.addEventListener('click', onExportData);
  refs.importButton.addEventListener('click', onImportData);
  refs.selectDataFileButton.addEventListener('click', onSelectDataFile);
  refs.defaultDataFileButton.addEventListener('click', onUseDefaultDataFile);
  refs.createDataFileButton.addEventListener('click', onCreateDataFile);
  refs.closeDataPickerButton.addEventListener('click', closeDataPicker);

  refs.loginButton.addEventListener('click', openLoginModal);
  refs.logoutButton.addEventListener('click', onLogout);
  refs.loginSubmitButton.addEventListener('click', onLoginSubmit);
  refs.loginSkipButton.addEventListener('click', closeLoginModal);
  refs.loginPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onLoginSubmit();
  });

  refs.toastUndo.addEventListener('click', undoDelete);

  document.addEventListener('keydown', onGlobalKeyDown);
}

async function loadInitialData() {
  try {
    const result = await window.electronAPI.loadData();
    if (!result?.ok) {
      throw new Error('Data load failed');
    }

    applyLoadedData(result.data);
    applyDataSourceInfo(result);

    const appInfo = await window.electronAPI.getAppInfo();
    applyDataSourceInfo(appInfo || {});
    refreshDataSourceUI();
    setStatus('Data loaded');
  } catch (error) {
    setStatus(`Load fallback: ${error.message}`);
  }
}

function switchView(view) {
  state.view = view;
  refs.tabTasks.classList.toggle('active', view === 'tasks');
  refs.tabNotes.classList.toggle('active', view === 'notes');
  refs.tabTrash.classList.toggle('active', view === 'trash');
  refs.tabTasks.setAttribute('aria-selected', String(view === 'tasks'));
  refs.tabNotes.setAttribute('aria-selected', String(view === 'notes'));
  refs.tabTrash.setAttribute('aria-selected', String(view === 'trash'));

  const isTrash = view === 'trash';
  refs.newItemButton.style.display = isTrash ? 'none' : 'inline-flex';
  refs.sortSelect.closest('.control').style.display = isTrash ? 'none' : 'flex';
  refs.newItemButton.textContent = view === 'tasks' ? '+ New Task' : '+ New Note';
  render();
}

function render() {
  renderSortControls();
  renderTagFilterControls();
  renderStats();
  renderGlobalTagsBar();
  renderList();
}

function renderTagFilterControls() {
  const options = ['<option value="all">All tags</option>'];

  state.tags.forEach((tag) => {
    const usageCount = getTagUsageCount(tag);
    const disabledAttr = usageCount === 0 ? ' disabled' : '';
    options.push(`<option value="${escapeHtml(tag)}"${disabledAttr}>${escapeHtml(tag)}${usageCount > 0 ? ` (${usageCount})` : ''}</option>`);
  });

  refs.tagFilterSelect.innerHTML = options.join('');
  const selectedTagAvailable = state.tags.includes(state.tagFilter) && getTagUsageCount(state.tagFilter) > 0;
  refs.tagFilterSelect.value = selectedTagAvailable ? state.tagFilter : 'all';
  if (!selectedTagAvailable) {
    state.tagFilter = 'all';
  }
}

function renderSortControls() {
  const isTasks = state.view === 'tasks';
  const isTrash = state.view === 'trash';
  refs.taskFilterWrap.style.display = isTasks ? 'flex' : 'none';

  if (isTrash) {
    return;
  }

  const options = isTasks
    ? [
        { value: 'manual', label: 'Manual' },
        { value: 'created-desc', label: 'Creation newest first' },
        { value: 'created-asc', label: 'Creation oldest first' },
        { value: 'priority-desc', label: 'Priority highest first' },
        { value: 'priority-asc', label: 'Priority lowest first' }
      ]
    : [
        { value: 'manual', label: 'Manual' },
        { value: 'created-desc', label: 'Creation newest first' },
        { value: 'created-asc', label: 'Creation oldest first' }
      ];

  refs.sortSelect.innerHTML = options
    .map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
    .join('');

  refs.sortSelect.value = isTasks ? state.settings.taskSort : state.settings.noteSort;
}

function renderStats() {
  if (state.view === 'trash') {
    const deletedCount = getVisibleTrashItems().length;
    refs.taskStats.style.visibility = 'visible';
    refs.taskStats.innerHTML = `
      <div class="stats-title">Trash items: ${deletedCount}</div>
      <div class="stats-grid"><div>Recoverable: ${deletedCount}</div></div>
    `;
    return;
  }

  if (state.view !== 'tasks') {
    refs.taskStats.style.visibility = 'hidden';
    refs.taskStats.innerHTML = '';
    return;
  }

  refs.taskStats.style.visibility = 'visible';
  const openTasks = state.tasks.filter((task) => !task.done && !task.isDeleted);
  const counts = Array.from({ length: 10 }, (_, i) => {
    const priority = i + 1;
    const count = openTasks.filter((task) => task.priority === priority).length;
    return { priority, count };
  });

  const cells = counts
    .map((item) => `<div>P${item.priority}: ${item.count}</div>`)
    .join('');

  refs.taskStats.innerHTML = `
    <div class="stats-title">Open tasks: ${openTasks.length}</div>
    <div class="stats-grid">${cells}</div>
  `;
}

function renderList() {
  const items = state.view === 'tasks'
    ? getVisibleTasks()
    : state.view === 'notes'
      ? getVisibleNotes()
      : getVisibleTrashItems();

  if (!items.length) {
    refs.listContainer.innerHTML = `
      <div class="empty-state">
        <p>No ${state.view} to show with current filters.</p>
        <p>Use the new button to add your first one.</p>
      </div>
    `;
    return;
  }

  refs.listContainer.innerHTML = items.map((item) => renderCard(item)).join('');
  bindDynamicEvents(items);
}

function renderCard(item) {
  if (state.view === 'trash') {
    return renderTrashCard(item);
  }

  const isTask = item.type === 'task';
  const canReorder = canManualReorder();

  return `
    <article class="card ${isTask && item.done ? 'done' : ''}" data-id="${escapeHtml(item.id)}" draggable="${canReorder}">
      <div class="left-col">
        <div class="drag-handle ${canReorder ? '' : 'disabled'}" title="${canReorder ? 'Drag to reorder' : 'Switch to manual sort and clear filters to reorder'}">::</div>
        ${
          isTask
            ? `<input class="done-checkbox" type="checkbox" data-action="toggle-done" ${item.done ? 'checked' : ''} aria-label="Mark task done" />`
            : ''
        }
      </div>

      <div class="main-col">
        <textarea class="text-input" data-action="edit-text" placeholder="${isTask ? 'Task text...' : 'Note text...'}">${escapeHtml(item.text)}</textarea>
        <div class="tag-editor">
          ${renderItemTagPills(item)}
          ${renderTagQuickPicker(item)}
          <input type="text" data-action="add-tag-input" placeholder="add tag" />
          <button class="ghost" data-action="add-tag">Add</button>
        </div>
        <div class="meta-row">
          ${isTask ? `<span>Priority: P${item.priority}</span>` : ''}
          <span>Created: ${formatDate(item.createdAt)}</span>
          <span>Updated: ${formatDate(item.updatedAt)}</span>
          <span>Edits: ${item.editCount || 0}</span>
        </div>
      </div>

      <div class="side-col">
        ${
          isTask
            ? `<label class="priority-control">P
                 <select data-action="priority">
                  ${Array.from({ length: 10 }, (_, i) => i + 1)
                    .map((p) => `<option value="${p}" ${p === item.priority ? 'selected' : ''}>${p}</option>`)
                    .join('')}
                 </select>
               </label>`
            : ''
        }
        <button class="delete-btn" data-action="delete">Move to Trash</button>
      </div>
    </article>
  `;
}

function renderTrashCard(item) {
  const kind = item.type === 'task' ? 'Task' : 'Note';
  return `
    <article class="card trash-card" data-id="${escapeHtml(item.id)}">
      <div class="main-col">
        <textarea class="text-input" readonly>${escapeHtml(item.text)}</textarea>
        <div class="tag-editor">${renderItemTagPills(item, true)}</div>
        <div class="meta-row">
          <span>Type: ${kind}</span>
          <span>Deleted: ${formatDate(item.deletedAt)}</span>
          <span>Created: ${formatDate(item.createdAt)}</span>
        </div>
      </div>

      <div class="side-col">
        <button class="restore-btn" data-action="restore">Restore</button>
      </div>
    </article>
  `;
}

function renderItemTagPills(item, readOnly = false) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  if (!tags.length) {
    return '<span class="data-picker-meta">No tags</span>';
  }

  return tags
    .map((tag) => {
      if (readOnly) {
        return `<span class="tag-pill">${escapeHtml(tag)}</span>`;
      }

      return `<span class="tag-pill">${escapeHtml(tag)} <button title="Remove tag" data-action="remove-tag" data-tag="${escapeHtml(tag)}">x</button></span>`;
    })
    .join('');
}

function renderTagQuickPicker(item) {
  const assigned = new Set((item.tags || []).map((tag) => String(tag).toLowerCase()));
  const candidates = state.tags.filter((tag) => !assigned.has(String(tag).toLowerCase()));

  if (!candidates.length) {
    return '';
  }

  return `
    <select data-action="quick-tag-select" title="Quick add existing tag">
      <option value="">+ tag</option>
      ${candidates.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join('')}
    </select>
  `;
}

function bindDynamicEvents(items) {
  const itemMap = new Map(items.map((i) => [i.id, i]));

  if (state.view === 'trash') {
    refs.listContainer.querySelectorAll('.card').forEach((card) => {
      const id = card.dataset.id;
      const data = itemMap.get(id);
      if (!data) {
        return;
      }

      const restoreButton = card.querySelector('[data-action="restore"]');
      restoreButton.addEventListener('click', () => restoreItem(data.type, id));
    });
    refs.listContainer.removeEventListener('dragover', listDragOverHandler);
    refs.listContainer.removeEventListener('drop', listDropHandler);
    return;
  }

  refs.listContainer.querySelectorAll('.card').forEach((card) => {
    const id = card.dataset.id;
    const data = itemMap.get(id);
    if (!data) {
      return;
    }

    const textInput = card.querySelector('[data-action="edit-text"]');
    textInput.addEventListener('focus', () => {
      textInput.dataset.initialValue = textInput.value;
    });

    textInput.addEventListener('input', () => {
      updateItemText(id, textInput.value, false);
      autoResizeTextarea(textInput);
    });

    textInput.addEventListener('blur', () => {
      const changed = textInput.value !== (textInput.dataset.initialValue || '');
      updateItemText(id, textInput.value, changed);
    });

    autoResizeTextarea(textInput);

    const doneCheckbox = card.querySelector('[data-action="toggle-done"]');
    if (doneCheckbox) {
      doneCheckbox.addEventListener('change', () => {
        toggleTaskDone(id, doneCheckbox.checked);
      });
    }

    const priority = card.querySelector('[data-action="priority"]');
    if (priority) {
      priority.addEventListener('change', () => {
        updateTaskPriority(id, priority.value);
      });
    }

    const deleteButton = card.querySelector('[data-action="delete"]');
    deleteButton.addEventListener('click', () => deleteItem(data.type, id));

    const addTagInput = card.querySelector('[data-action="add-tag-input"]');
    const addTagButton = card.querySelector('[data-action="add-tag"]');
    const quickTagSelect = card.querySelector('[data-action="quick-tag-select"]');
    const addTag = () => {
      const value = addTagInput.value;
      addTagToItem(data.type, id, value);
      addTagInput.value = '';
    };

    addTagButton.addEventListener('click', addTag);
    addTagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addTag();
      }
    });

    if (quickTagSelect) {
      quickTagSelect.addEventListener('change', () => {
        const selectedTag = quickTagSelect.value;
        if (!selectedTag) {
          return;
        }

        addTagToItem(data.type, id, selectedTag);
      });
    }

    card.querySelectorAll('[data-action="remove-tag"]').forEach((removeButton) => {
      removeButton.addEventListener('click', () => {
        removeTagFromItem(data.type, id, removeButton.dataset.tag);
      });
    });

    if (canManualReorder()) {
      card.addEventListener('dragstart', (event) => {
        state.dragItemId = id;
        card.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        state.dragItemId = null;
        card.classList.remove('dragging');
      });

      card.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });

      card.addEventListener('drop', (event) => {
        event.preventDefault();
        const targetId = card.dataset.id;
        if (!state.dragItemId || !targetId || state.dragItemId === targetId) {
          return;
        }
        reorderByDrop(state.view, state.dragItemId, targetId);
      });
    }
  });

  if (canManualReorder()) {
    refs.listContainer.addEventListener('dragover', listDragOverHandler);
    refs.listContainer.addEventListener('drop', listDropHandler);
  } else {
    refs.listContainer.removeEventListener('dragover', listDragOverHandler);
    refs.listContainer.removeEventListener('drop', listDropHandler);
  }
}

function listDragOverHandler(event) {
  event.preventDefault();
}

function listDropHandler(event) {
  event.preventDefault();
  const card = event.target.closest('.card');
  if (card) {
    return;
  }

  const list = state.view === 'tasks' ? state.tasks : state.notes;
  if (!state.dragItemId) {
    return;
  }

  const currentIndex = list.findIndex((item) => item.id === state.dragItemId);
  if (currentIndex < 0) {
    return;
  }

  const [moved] = list.splice(currentIndex, 1);
  list.push(moved);
  resequenceManualOrder(list);
  queueSave();
  render();
}

function createTask() {
  const now = new Date().toISOString();
  const task = {
    id: generateId('task'),
    type: 'task',
    text: '',
    done: false,
    priority: 5,
    createdAt: now,
    updatedAt: now,
    editCount: 0,
    manualOrder: nextHeadOrder(state.tasks),
    archived: false,
    isDeleted: false,
    deletedAt: null
  };

  state.tasks.unshift(task);
  queueSave();
  render();
  focusItem(task.id);
}

function createNote() {
  const now = new Date().toISOString();
  const note = {
    id: generateId('note'),
    type: 'note',
    text: '',
    createdAt: now,
    updatedAt: now,
    editCount: 0,
    manualOrder: nextHeadOrder(state.notes),
    isDeleted: false,
    deletedAt: null
  };

  state.notes.unshift(note);
  queueSave();
  render();
  focusItem(note.id);
}

function updateItemText(id, nextText, shouldIncrementEditCount) {
  const item = findItemById(state.view, id);
  if (!item) {
    return;
  }

  if (item.text === nextText && !shouldIncrementEditCount) {
    return;
  }

  item.text = nextText;
  item.updatedAt = new Date().toISOString();
  if (shouldIncrementEditCount) {
    item.editCount = (item.editCount || 0) + 1;
  }

  queueSave();
  renderMetadataFor(id, item);
}

function renderMetadataFor(id, item) {
  const card = refs.listContainer.querySelector(`.card[data-id="${cssEscape(id)}"]`);
  if (!card) {
    return;
  }

  const metaRow = card.querySelector('.meta-row');
  if (!metaRow) {
    return;
  }

  const pieces = [];
  if (item.type === 'task') {
    pieces.push(`<span>Priority: P${item.priority}</span>`);
  }
  pieces.push(`<span>Created: ${formatDate(item.createdAt)}</span>`);
  pieces.push(`<span>Updated: ${formatDate(item.updatedAt)}</span>`);
  pieces.push(`<span>Edits: ${item.editCount || 0}</span>`);
  metaRow.innerHTML = pieces.join('');
}

function toggleTaskDone(id, done) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) {
    return;
  }

  task.done = Boolean(done);
  task.updatedAt = new Date().toISOString();
  queueSave();
  render();
}

function updateTaskPriority(id, priorityValue) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) {
    return;
  }

  const parsed = Number.parseInt(priorityValue, 10);
  const safe = Number.isFinite(parsed) ? Math.min(10, Math.max(1, parsed)) : 5;
  task.priority = safe;
  task.updatedAt = new Date().toISOString();
  queueSave();
  render();
}

function deleteItem(type, id) {
  const list = type === 'task' ? state.tasks : state.notes;
  const item = list.find((entry) => entry.id === id);
  if (!item || item.isDeleted) {
    return;
  }

  state.deletedSnapshot = {
    type,
    id,
    prevIsDeleted: Boolean(item.isDeleted),
    prevDeletedAt: item.deletedAt || null
  };
  item.isDeleted = true;
  item.deletedAt = new Date().toISOString();
  item.updatedAt = item.deletedAt;
  queueSave();
  render();
  showToast(`${type === 'task' ? 'Task' : 'Note'} moved to Trash`, true);

  clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(() => {
    state.deletedSnapshot = null;
    hideToast();
  }, UNDO_TIMEOUT_MS);
}

function undoDelete() {
  if (!state.deletedSnapshot) {
    return;
  }

  const { type, id, prevIsDeleted, prevDeletedAt } = state.deletedSnapshot;
  const list = type === 'task' ? state.tasks : state.notes;
  const item = list.find((entry) => entry.id === id);
  if (!item) {
    state.deletedSnapshot = null;
    hideToast();
    return;
  }

  item.isDeleted = prevIsDeleted;
  item.deletedAt = prevDeletedAt;
  item.updatedAt = new Date().toISOString();
  queueSave();
  render();
  state.deletedSnapshot = null;
  hideToast();
  setStatus('Delete undone');
}

function restoreItem(type, id) {
  const list = type === 'task' ? state.tasks : state.notes;
  const item = list.find((entry) => entry.id === id);
  if (!item || !item.isDeleted) {
    return;
  }

  item.isDeleted = false;
  item.deletedAt = null;
  item.updatedAt = new Date().toISOString();
  queueSave();
  render();
  showToast(`${type === 'task' ? 'Task' : 'Note'} restored`, false);
  setStatus('Item restored from Trash');
}

function reorderByDrop(view, movingId, targetId) {
  const list = view === 'tasks' ? state.tasks : state.notes;
  const from = list.findIndex((item) => item.id === movingId);
  const to = list.findIndex((item) => item.id === targetId);

  if (from < 0 || to < 0 || from === to) {
    return;
  }

  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  resequenceManualOrder(list);
  queueSave();
  render();
}

function resequenceManualOrder(list) {
  list.forEach((item, index) => {
    item.manualOrder = index;
  });
}

function nextHeadOrder(list) {
  if (!list.length) {
    return 0;
  }
  const min = Math.min(...list.map((item) => Number.isFinite(item.manualOrder) ? item.manualOrder : 0));
  return min - 1;
}

function queueSave() {
  setStatus('Saving...');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    saveNow();
  }, SAVE_DEBOUNCE_MS);
}

async function saveNow() {
  const payload = getPersistedState();
  const snapshot = getSerializableState();

  if (state.saveInFlight) {
    state.pendingSave = true;
    return;
  }

  state.saveInFlight = true;
  try {
    await window.electronAPI.saveData(payload);
    queueCloudPush(snapshot);
    setStatus('All changes saved');
  } catch (error) {
    setStatus(`Save error: ${error.message}`);
  } finally {
    state.saveInFlight = false;
    if (state.pendingSave) {
      state.pendingSave = false;
      queueSave();
    }
  }
}

async function onExportData() {
  try {
    const result = await window.electronAPI.exportData(getSerializableState());
    if (result?.canceled) {
      setStatus('Export canceled');
      return;
    }
    setStatus(result?.ok ? `Exported to ${result.filePath}` : 'Export failed');
  } catch (error) {
    setStatus(`Export error: ${error.message}`);
  }
}

async function onImportData() {
  try {
    const result = await window.electronAPI.importData();
    if (result?.canceled) {
      setStatus('Import canceled');
      return;
    }

    if (!result?.ok || !result.data) {
      setStatus('Import failed');
      return;
    }

    applyLoadedData(result.data);

    render();
    queueSave();
    setStatus(`Imported from ${result.filePath}`);
  } catch (error) {
    setStatus(`Import error: ${error.message}`);
  }
}

async function onSelectDataFile() {
  try {
    await flushPendingSave();
    const result = await window.electronAPI.selectDataFile();

    if (!result?.ok) {
      setStatus('Unable to load data file list');
      return;
    }

    state.dataFileCandidates = Array.isArray(result.candidates) ? result.candidates : [];
    renderDataPickerList();
    openDataPicker();
    setStatus('Choose a data file from app list');
  } catch (error) {
    setStatus(`Switch error: ${error.message}`);
  }
}

async function onActivateDataFile(fileName) {
  try {
    await flushPendingSave();
    const result = await window.electronAPI.activateDataFile(fileName);

    if (!result?.ok || !result?.data) {
      setStatus(result?.error || 'Unable to switch data file');
      return;
    }

    applyLoadedData(result.data);
    applyDataSourceInfo(result);
    state.dataFileCandidates = Array.isArray(result.candidates) ? result.candidates : state.dataFileCandidates;
    refreshDataSourceUI();
    render();
    closeDataPicker();
    setStatus('Data source changed');
    showToast('Now using selected data file', false);
  } catch (error) {
    setStatus(`Activation error: ${error.message}`);
  }
}

async function onCreateDataFile() {
  const name = refs.newDataFileInput.value.trim().replace(/\.json$/i, '');
  if (!name) {
    setStatus('Type a new data file name first');
    return;
  }

  try {
    await flushPendingSave();
    const result = await window.electronAPI.createDataFile(name);
    if (!result?.ok || !result?.data) {
      setStatus(result?.error || 'Unable to create data file');
      return;
    }

    applyLoadedData(result.data);
    applyDataSourceInfo(result);
    state.dataFileCandidates = Array.isArray(result.candidates) ? result.candidates : state.dataFileCandidates;
    refreshDataSourceUI();
    refs.newDataFileInput.value = '';
    render();
    closeDataPicker();
    showToast('New data file created and selected', false);
    setStatus('Data file created');
  } catch (error) {
    setStatus(`Create file error: ${error.message}`);
  }
}

function renderDataPickerList() {
  if (!state.dataFileCandidates.length) {
    refs.dataPickerList.innerHTML = '<p class="modal-subtitle">No data JSON files found yet.</p>';
    return;
  }

  refs.dataPickerList.innerHTML = state.dataFileCandidates
    .map((item) => {
      const displayName = (item.displayName || item.name || '').replace(/\.json$/i, '');
      const tags = [item.isCurrent ? 'Current' : '', item.isDefault ? 'Default' : ''].filter(Boolean).join(' • ');
      return `
        <div class="data-picker-item">
          <div>
            <strong>${escapeHtml(displayName)}</strong>
            <div class="data-picker-meta">${escapeHtml(tags || 'TaskNotes data file')}</div>
          </div>
          <button class="ghost" data-action="pick-data-file" data-file-name="${escapeHtml(item.name)}">Use</button>
        </div>
      `;
    })
    .join('');

  refs.dataPickerList.querySelectorAll('[data-action="pick-data-file"]').forEach((button) => {
    button.addEventListener('click', () => {
      onActivateDataFile(button.dataset.fileName);
    });
  });
}

function openDataPicker() {
  refs.dataPickerModal.classList.add('visible');
  refs.dataPickerModal.setAttribute('aria-hidden', 'false');
}

function closeDataPicker() {
  refs.dataPickerModal.classList.remove('visible');
  refs.dataPickerModal.setAttribute('aria-hidden', 'true');
}

async function onUseDefaultDataFile() {
  try {
    await flushPendingSave();
    const result = await window.electronAPI.useDefaultDataFile();
    if (!result?.ok || !result?.data) {
      setStatus('Unable to switch to default data file');
      return;
    }

    applyLoadedData(result.data);
    applyDataSourceInfo(result);
    refreshDataSourceUI();
    render();
    setStatus('Using default data file');
    showToast('Switched to default data file', false);
  } catch (error) {
    setStatus(`Default switch error: ${error.message}`);
  }
}

async function flushPendingSave() {
  clearTimeout(state.saveTimer);

  if (!state.saveInFlight) {
    await saveNow();
  }

  await waitForSaveIdle();

  if (state.pendingSave) {
    state.pendingSave = false;
    await saveNow();
    await waitForSaveIdle();
  }
}

async function waitForSaveIdle() {
  while (state.saveInFlight) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

async function initAuth() {
  try {
    const status = await window.electronAPI.getCloudSyncStatus();
    if (!status?.cognitoConfigured) {
      // Cognito not configured → skip login, start cloud sync with API key if available
      await initCloudSync();
      return;
    }

    const authStatus = await window.electronAPI.authGetStatus();
    if (authStatus?.loggedIn) {
      state.authLoggedIn = true;
      state.authEmail = authStatus.email || '';
      updateAuthUI();
      await initCloudSync();
    } else {
      openLoginModal();
    }
  } catch {
    await initCloudSync();
  }
}

function openLoginModal() {
  refs.loginModal.classList.add('visible');
  refs.loginModal.setAttribute('aria-hidden', 'false');
  refs.loginError.textContent = '';
  refs.loginEmailInput.value = '';
  refs.loginPasswordInput.value = '';
  refs.loginNewPasswordRow.style.display = 'none';
  refs.loginNewPasswordInput.value = '';
  refs.loginSubmitButton.textContent = 'Accedi';
  state._loginSession = null;
  setTimeout(() => refs.loginEmailInput.focus(), 50);
}

function closeLoginModal() {
  refs.loginModal.classList.remove('visible');
  refs.loginModal.setAttribute('aria-hidden', 'true');
}

async function onLoginSubmit() {
  // If we're in the NEW_PASSWORD_REQUIRED step, handle that
  if (state._loginSession) {
    await onNewPasswordSubmit();
    return;
  }

  const email = refs.loginEmailInput.value.trim();
  const password = refs.loginPasswordInput.value;
  if (!email || !password) {
    refs.loginError.textContent = 'Inserisci email e password.';
    return;
  }

  refs.loginSubmitButton.disabled = true;
  refs.loginSubmitButton.textContent = 'Accesso…';
  refs.loginError.textContent = '';

  try {
    const result = await window.electronAPI.authLogin(email, password);
    if (result?.newPasswordRequired) {
      // Show new password field
      state._loginSession = result.session;
      state._loginEmail = result.email;
      refs.loginNewPasswordRow.style.display = 'flex';
      refs.loginNewPasswordInput.focus();
      refs.loginError.textContent = 'Primo accesso: imposta una nuova password permanente.';
      refs.loginSubmitButton.textContent = 'Imposta password';
      return;
    }
    if (!result?.ok) {
      refs.loginError.textContent = result?.error || 'Login fallito.';
      return;
    }
    await onLoginSuccess(result.email || email);
  } finally {
    refs.loginSubmitButton.disabled = false;
    if (!state._loginSession) refs.loginSubmitButton.textContent = 'Accedi';
  }
}

async function onNewPasswordSubmit() {
  const newPassword = refs.loginNewPasswordInput.value;
  if (!newPassword || newPassword.length < 8) {
    refs.loginError.textContent = 'La password deve essere di almeno 8 caratteri.';
    return;
  }
  refs.loginSubmitButton.disabled = true;
  refs.loginSubmitButton.textContent = 'Salvataggio…';
  refs.loginError.textContent = '';
  try {
    const result = await window.electronAPI.authNewPassword(state._loginEmail, newPassword, state._loginSession);
    if (!result?.ok) {
      refs.loginError.textContent = result?.error || 'Errore cambio password.';
      return;
    }
    state._loginSession = null;
    await onLoginSuccess(result.email || state._loginEmail);
  } finally {
    refs.loginSubmitButton.disabled = false;
  }
}

async function onLoginSuccess(email) {
  state.authLoggedIn = true;
  state.authEmail = email;
  updateAuthUI();
  closeLoginModal();
  if (state.cloudSyncTimer) clearInterval(state.cloudSyncTimer);
  await initCloudSync();
  setStatus(`Connesso come ${email}`);
}

function setCloudSyncedStatus() {
  const formattedSyncTime = formatDate(state.cloudLastSyncAt);
  setStatus(formattedSyncTime === '-' ? 'Cloud sincronizzato' : `Cloud sincronizzato ${formattedSyncTime}`);
}

async function onLogout() {
  // Warn if there is local data that hasn't been pushed to the cloud yet.
  // After logout the workspace is cleared so the next user starts clean.
  if (hasUnsyncedLocalChanges()) {
    const confirmed = window.confirm(
      'Hai modifiche locali non ancora sincronizzate con il cloud.\nSe esci ora andranno perse. Continuare?'
    );
    if (!confirmed) return;
  }

  await window.electronAPI.authLogout();
  state.authLoggedIn = false;
  state.authEmail = '';
  state.cloudSyncEnabled = false;
  clearCloudRetry();
  if (state.cloudSyncTimer) {
    clearInterval(state.cloudSyncTimer);
    state.cloudSyncTimer = null;
  }
  // Clear all user data and sync metadata so the next login (same or different
  // account) always starts with a clean local state and pulls fresh from cloud.
  state.tasks = [];
  state.notes = [];
  state.tags = [];
  state.deletedSnapshot = null;
  state.cloudServerUpdatedAt = '';
  state.cloudBaseSnapshot = null;
  state.cloudLastSnapshotHash = '';
  state.cloudLastSyncAt = '';
  await persistStateToDisk();
  render();
  updateAuthUI();
  setStatus('Disconnesso');
}

function updateAuthUI() {
  if (refs.loginButton) refs.loginButton.style.display = state.authLoggedIn ? 'none' : 'inline-flex';
  if (refs.logoutButton) {
    refs.logoutButton.style.display = state.authLoggedIn ? 'inline-flex' : 'none';
    refs.logoutButton.textContent = state.authEmail ? `Logout (${state.authEmail})` : 'Logout';
  }
}

async function initCloudSync() {
  try {
    const status = await window.electronAPI.getCloudSyncStatus();
    state.cloudSyncEnabled = Boolean(status?.enabled) && (!status?.cognitoConfigured || state.authLoggedIn);

    if (!state.cloudSyncEnabled) {
      return;
    }

    await pullFromCloud();
    const localSnapshot = getSerializableState();
    if (hasUnsyncedLocalChanges(localSnapshot)) {
      queueCloudPush(localSnapshot);
    }
    state.cloudSyncTimer = setInterval(() => {
      pullFromCloud();
    }, CLOUD_SYNC_INTERVAL_MS);
  } catch {
    state.cloudSyncEnabled = false;
  }
}

function queueCloudPush(payload) {
  if (!state.cloudSyncEnabled) {
    return;
  }

  const snapshot = payload || getSerializableState();
  const snapshotHash = JSON.stringify(snapshot);
  if (snapshotHash === state.cloudLastSnapshotHash) {
    return;
  }

  void pushToCloud(snapshot, snapshotHash);
}

async function pushToCloud(snapshot, snapshotHash, baseServerUpdatedAt = state.cloudServerUpdatedAt || '') {
  if (state.cloudSyncInFlight) {
    state.cloudSyncPendingPush = true;
    return;
  }

  state.cloudSyncInFlight = true;
  try {
    const result = await window.electronAPI.cloudPush({
      snapshot,
      clientUpdatedAt: new Date().toISOString(),
      baseServerUpdatedAt
    });

    if (result?.conflict && result?.snapshot) {
      await resolveCloudConflict(snapshot, snapshotHash, result.snapshot, result.serverUpdatedAt || '');
      return;
    }

    if (!result?.ok) {
      const retryDelayMs = result?.status === 429 ? 5000 : 15000;
      setStatus(result?.status === 429 ? 'Cloud sync throttled, retrying soon...' : `Cloud sync pending: ${result?.error || 'push failed'}`);
      scheduleCloudRetry(retryDelayMs);
      return;
    }

    clearCloudRetry();
    state.cloudLastSnapshotHash = snapshotHash;
    state.cloudBaseSnapshot = cloneSnapshot(snapshot);
    state.cloudServerUpdatedAt = result.serverUpdatedAt || '';
    state.cloudLastSyncAt = result.serverUpdatedAt || result.syncedAt || new Date().toISOString();
    await persistStateToDisk();
    setCloudSyncedStatus();
  } catch (error) {
    setStatus(`Cloud sync pending: ${error.message}`);
    scheduleCloudRetry(15000);
  } finally {
    state.cloudSyncInFlight = false;

    if (state.cloudSyncPendingPush) {
      state.cloudSyncPendingPush = false;
      const nextSnapshot = getSerializableState();
      void pushToCloud(nextSnapshot, JSON.stringify(nextSnapshot));
    }
  }
}

async function pullFromCloud() {
  if (!state.cloudSyncEnabled || state.cloudSyncInFlight || state.saveInFlight) {
    return;
  }

  state.cloudSyncInFlight = true;
  try {
    const result = await window.electronAPI.cloudPull({ since: state.cloudServerUpdatedAt || '' });
    if (!result?.ok) {
      if (result?.status === 429) {
        setStatus('Cloud sync throttled, retrying later...');
      }
      return;
    }

    const remoteData = result.snapshot || result.data;
    if (!remoteData) {
      return;
    }

    const remoteHash = JSON.stringify(remoteData);
    const localHash = JSON.stringify(getSerializableState());
    if (remoteHash === localHash) {
      state.cloudBaseSnapshot = cloneSnapshot(remoteData);
      state.cloudServerUpdatedAt = result.serverUpdatedAt || '';
      state.cloudLastSnapshotHash = remoteHash;
      state.cloudLastSyncAt = result.serverUpdatedAt || result.syncedAt || state.cloudLastSyncAt;
      await persistStateToDisk();
      return;
    }

    // cloudBaseSnapshot is null on the first pull after login (including a
    // login with a different account). In that case skip the three-way merge
    // and treat the cloud data as authoritative so we don't bleed the previous
    // user's local items into the new user's workspace.
    if (!state.cloudBaseSnapshot) {
      state.cloudBaseSnapshot = cloneSnapshot(remoteData);
      state.cloudServerUpdatedAt = result.serverUpdatedAt || '';
      state.cloudLastSnapshotHash = remoteHash;
      state.cloudLastSyncAt = result.serverUpdatedAt || result.syncedAt || state.cloudLastSyncAt;
      applyLoadedData({
        ...remoteData,
        sync: { serverUpdatedAt: state.cloudServerUpdatedAt, lastSyncedSnapshot: state.cloudBaseSnapshot }
      });
      await persistStateToDisk();
      render();
      return;
    }

    const mergeResult = mergeSnapshots(state.cloudBaseSnapshot, getSerializableState(), remoteData);
    state.cloudBaseSnapshot = cloneSnapshot(remoteData);
    state.cloudServerUpdatedAt = result.serverUpdatedAt || '';
    state.cloudLastSnapshotHash = remoteHash;
    applyLoadedData({
      ...mergeResult.snapshot,
      sync: {
        serverUpdatedAt: state.cloudServerUpdatedAt,
        lastSyncedSnapshot: state.cloudBaseSnapshot
      }
    });
    await persistStateToDisk();
    render();
    if (mergeResult.conflicts > 0) {
      showToast(`Cloud conflict merged: kept ${mergeResult.conflicts} duplicate ${mergeResult.conflicts === 1 ? 'copy' : 'copies'}`, false);
      setStatus('Cloud conflict merged locally, sync pending');
      queueCloudPush(mergeResult.snapshot);
      return;
    }

    if (hasUnsyncedLocalChanges(mergeResult.snapshot)) {
      setStatus('Cloud changes merged locally, sync pending');
      queueCloudPush(mergeResult.snapshot);
      return;
    }

    state.cloudLastSyncAt = result.serverUpdatedAt || result.syncedAt || new Date().toISOString();
    setCloudSyncedStatus();
  } catch {
    // Keep local app fully usable even when cloud is unavailable.
  } finally {
    state.cloudSyncInFlight = false;
  }
}

async function resolveCloudConflict(localSnapshot, snapshotHash, remoteSnapshot, serverUpdatedAt) {
  const mergeResult = mergeSnapshots(state.cloudBaseSnapshot, localSnapshot, remoteSnapshot);

  state.cloudBaseSnapshot = cloneSnapshot(remoteSnapshot);
  state.cloudServerUpdatedAt = serverUpdatedAt || '';
  state.cloudLastSnapshotHash = JSON.stringify(remoteSnapshot);
  applyLoadedData({
    ...mergeResult.snapshot,
    sync: {
      serverUpdatedAt: state.cloudServerUpdatedAt,
      lastSyncedSnapshot: state.cloudBaseSnapshot
    }
  });
  await persistStateToDisk();
  render();

  if (mergeResult.conflicts > 0) {
    showToast(`Cloud conflict merged: kept ${mergeResult.conflicts} duplicate ${mergeResult.conflicts === 1 ? 'copy' : 'copies'}`, false);
  }

  setStatus('Cloud conflict merged locally, retrying sync...');
  const mergedSnapshotHash = JSON.stringify(mergeResult.snapshot);
  await pushToCloud(mergeResult.snapshot, mergedSnapshotHash, state.cloudServerUpdatedAt || '');
}

function applyLoadedData(data) {
  state.tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  state.notes = Array.isArray(data?.notes) ? data.notes : [];
  state.tags = sanitizeTagList(data?.tags);
  state.settings = {
    ...state.settings,
    ...data?.settings
  };
  state.version = data?.version || state.version;
  state.cloudServerUpdatedAt = typeof data?.sync?.serverUpdatedAt === 'string' ? data.sync.serverUpdatedAt : '';
  state.cloudBaseSnapshot = data?.sync?.lastSyncedSnapshot ? cloneSnapshot(data.sync.lastSyncedSnapshot) : null;
  state.cloudLastSnapshotHash = state.cloudBaseSnapshot ? JSON.stringify(state.cloudBaseSnapshot) : '';
}

function applyDataSourceInfo(info) {
  if (!info || typeof info !== 'object') {
    return;
  }

  state.dataFilePath = info.dataFilePath || state.dataFilePath;
  state.defaultDataFilePath = info.defaultDataFilePath || state.defaultDataFilePath;
  state.activeDataFileDisplayName = info.activeDataFileDisplayName || state.activeDataFileDisplayName;
  if (typeof info.isDefaultDataFile === 'boolean') {
    state.isDefaultDataFile = info.isDefaultDataFile;
  }
}

function refreshDataSourceUI() {
  refs.dataPathText.textContent = state.dataFilePath ? `Data: ${state.dataFilePath}` : '';

  const label = state.activeDataFileDisplayName || (state.dataFilePath ? state.dataFilePath.split('/').pop().replace(/\.json$/i, '') : 'Unknown');
  const mode = state.isDefaultDataFile ? 'Default' : 'Custom';
  refs.activeDataHint.textContent = `Source: ${label} (${mode})`;
  refs.activeDataHint.title = state.dataFilePath || 'Current data source';
}

function getVisibleTasks() {
  const sortMode = state.settings.taskSort;
  let tasks = state.tasks.filter((task) => !task.isDeleted);

  if (state.taskFilter === 'open') {
    tasks = tasks.filter((task) => !task.done);
  } else if (state.taskFilter === 'done') {
    tasks = tasks.filter((task) => task.done);
  }

  if (state.search) {
    tasks = tasks.filter((task) => {
      const textMatch = task.text.toLowerCase().includes(state.search);
      const tagMatch = (task.tags || []).some((tag) => tag.toLowerCase().includes(state.search));
      return textMatch || tagMatch;
    });
  }

  if (state.tagFilter !== 'all') {
    tasks = tasks.filter((task) => (task.tags || []).includes(state.tagFilter));
  }

  return sortItems(tasks, sortMode, true);
}

function getVisibleNotes() {
  let notes = state.notes.filter((note) => !note.isDeleted);
  if (state.search) {
    notes = notes.filter((note) => {
      const textMatch = note.text.toLowerCase().includes(state.search);
      const tagMatch = (note.tags || []).some((tag) => tag.toLowerCase().includes(state.search));
      return textMatch || tagMatch;
    });
  }
  if (state.tagFilter !== 'all') {
    notes = notes.filter((note) => (note.tags || []).includes(state.tagFilter));
  }
  return sortItems(notes, state.settings.noteSort, false);
}

function getVisibleTrashItems() {
  let deleted = [...state.tasks, ...state.notes].filter((item) => item.isDeleted);
  if (state.search) {
    deleted = deleted.filter((item) => {
      const textMatch = item.text.toLowerCase().includes(state.search);
      const tagMatch = (item.tags || []).some((tag) => tag.toLowerCase().includes(state.search));
      return textMatch || tagMatch;
    });
  }
  if (state.tagFilter !== 'all') {
    deleted = deleted.filter((item) => (item.tags || []).includes(state.tagFilter));
  }
  return deleted.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
}

function sortItems(items, sortMode, supportsPriority) {
  if (sortMode === 'created-desc') {
    return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  if (sortMode === 'created-asc') {
    return items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  if (supportsPriority && sortMode === 'priority-desc') {
    return items.sort((a, b) => b.priority - a.priority || new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  if (supportsPriority && sortMode === 'priority-asc') {
    return items.sort((a, b) => a.priority - b.priority || new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  return items.sort((a, b) => a.manualOrder - b.manualOrder);
}

function canManualReorder() {
  if (state.view === 'tasks') {
    return state.settings.taskSort === 'manual' && state.taskFilter === 'all' && state.tagFilter === 'all' && !state.search;
  }
  return state.settings.noteSort === 'manual' && state.tagFilter === 'all' && !state.search;
}

function findItemById(view, id) {
  const list = view === 'tasks' ? state.tasks : state.notes;
  return list.find((item) => item.id === id);
}

function getSerializableState() {
  return {
    tasks: state.tasks,
    notes: state.notes,
    tags: state.tags,
    settings: state.settings,
    version: state.version
  };
}

function getPersistedState() {
  return {
    ...getSerializableState(),
    sync: {
      serverUpdatedAt: state.cloudServerUpdatedAt || '',
      lastSyncedSnapshot: state.cloudBaseSnapshot ? cloneSnapshot(state.cloudBaseSnapshot) : null
    }
  };
}

async function persistStateToDisk() {
  await window.electronAPI.saveData(getPersistedState());
}

function hasUnsyncedLocalChanges(snapshot = getSerializableState()) {
  if (!state.cloudBaseSnapshot) {
    return snapshot.tasks.length > 0
      || snapshot.notes.length > 0
      || snapshot.tags.length > 0
      || snapshot.settings.taskSort !== 'manual'
      || snapshot.settings.noteSort !== 'manual';
  }

  return JSON.stringify(snapshot) !== JSON.stringify(state.cloudBaseSnapshot);
}

function cloneSnapshot(snapshot) {
  return snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
}

function mergeSnapshots(baseSnapshot, localSnapshot, remoteSnapshot) {
  const base = baseSnapshot || { tasks: [], notes: [], tags: [], settings: { taskSort: 'manual', noteSort: 'manual' }, version: 1 };
  const local = localSnapshot || { tasks: [], notes: [], tags: [], settings: { taskSort: 'manual', noteSort: 'manual' }, version: 1 };
  const remote = remoteSnapshot || { tasks: [], notes: [], tags: [], settings: { taskSort: 'manual', noteSort: 'manual' }, version: 1 };

  const taskMerge = mergeItemCollections(base.tasks, local.tasks, remote.tasks);
  const noteMerge = mergeItemCollections(base.notes, local.notes, remote.notes);
  const localSettingsChanged = JSON.stringify(local.settings || {}) !== JSON.stringify(base.settings || {});
  const remoteSettingsChanged = JSON.stringify(remote.settings || {}) !== JSON.stringify(base.settings || {});

  return {
    snapshot: {
      tasks: taskMerge.items,
      notes: noteMerge.items,
      tags: sanitizeTagList([...(remote.tags || []), ...(local.tags || []), ...(base.tags || [])]),
      settings: localSettingsChanged ? { ...(remote.settings || {}), ...(local.settings || {}) } : { ...(remoteSettingsChanged ? remote.settings : local.settings) },
      version: Math.max(base.version || 1, local.version || 1, remote.version || 1)
    },
    conflicts: taskMerge.conflicts + noteMerge.conflicts
  };
}

function mergeItemCollections(baseItems = [], localItems = [], remoteItems = []) {
  const baseMap = new Map(baseItems.map((item) => [item.id, item]));
  const localMap = new Map(localItems.map((item) => [item.id, item]));
  const remoteMap = new Map(remoteItems.map((item) => [item.id, item]));
  const orderedIds = [];
  const seen = new Set();

  [remoteItems, localItems, baseItems].forEach((items) => {
    items.forEach((item) => {
      if (!item?.id || seen.has(item.id)) {
        return;
      }
      seen.add(item.id);
      orderedIds.push(item.id);
    });
  });

  const merged = [];
  let conflicts = 0;

  orderedIds.forEach((id) => {
    const baseItem = baseMap.get(id) || null;
    const localItem = localMap.get(id) || null;
    const remoteItem = remoteMap.get(id) || null;
    const localChanged = hasItemChanged(baseItem, localItem);
    const remoteChanged = hasItemChanged(baseItem, remoteItem);

    if (!localChanged && !remoteChanged) {
      if (remoteItem || localItem || baseItem) {
        merged.push(cloneSnapshot(remoteItem || localItem || baseItem));
      }
      return;
    }

    if (localChanged && !remoteChanged) {
      if (localItem) {
        merged.push(cloneSnapshot(localItem));
      }
      return;
    }

    if (!localChanged && remoteChanged) {
      if (remoteItem) {
        merged.push(cloneSnapshot(remoteItem));
      }
      return;
    }

    if (areItemsEqual(localItem, remoteItem)) {
      if (localItem || remoteItem) {
        merged.push(cloneSnapshot(localItem || remoteItem));
      }
      return;
    }

    if (remoteItem) {
      merged.push(cloneSnapshot(remoteItem));
    }
    if (localItem) {
      merged.push(createConflictCopy(localItem));
      conflicts += 1;
    }
  });

  resequenceManualOrder(merged);
  return { items: merged, conflicts };
}

function hasItemChanged(baseItem, currentItem) {
  if (!baseItem && !currentItem) {
    return false;
  }
  if (!baseItem || !currentItem) {
    return true;
  }
  return !areItemsEqual(baseItem, currentItem);
}

function areItemsEqual(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function createConflictCopy(item) {
  const copy = cloneSnapshot(item);
  const prefix = '[Conflict copy] ';
  copy.id = generateId(copy.type === 'task' ? 'task' : 'note');
  copy.text = copy.text && copy.text.startsWith(prefix) ? copy.text : `${prefix}${copy.text || ''}`;
  copy.updatedAt = new Date().toISOString();
  return copy;
}

function renderGlobalTagsBar() {
  if (!state.tags.length) {
    refs.globalTagsBar.innerHTML = '';
    return;
  }

  const chips = state.tags
    .map((tag) => {
      const usageCount = getTagUsageCount(tag);
      const activeClass = state.tagFilter === tag ? 'active' : '';
      const unavailableClass = usageCount === 0 ? 'unavailable' : '';
      const disabledAttr = usageCount === 0 ? 'disabled aria-disabled="true"' : '';
      const title = usageCount === 0
        ? 'Nessuna card/nota collegata'
        : state.tagFilter === tag
          ? `Rimuovi filtro "${tag}"`
          : `Filtra per "${tag}"`;

      return `
        <span class="tag-pill ${activeClass} ${unavailableClass}">
          <button data-action="filter-tag" data-tag="${escapeHtml(tag)}" title="${escapeHtml(title)}" ${disabledAttr}>${escapeHtml(tag)}</button>
        </span>
      `;
    })
    .join('');

  refs.globalTagsBar.innerHTML = chips;

  refs.globalTagsBar.querySelectorAll('[data-action="filter-tag"]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) {
        return;
      }

      state.tagFilter = state.tagFilter === button.dataset.tag ? 'all' : button.dataset.tag;
      render();
    });

    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (button.disabled) {
        return;
      }

      confirmAndDeleteTag(button.dataset.tag);
    });
  });
}

function getTagUsageCount(tag) {
  const normalized = normalizeTag(tag).toLowerCase();
  if (!normalized) {
    return 0;
  }

  return [...state.tasks, ...state.notes].filter((item) => {
    if (item.isDeleted) {
      return false;
    }

    return (item.tags || []).some((itemTag) => normalizeTag(itemTag).toLowerCase() === normalized);
  }).length;
}

function confirmAndDeleteTag(rawTag) {
  const normalized = normalizeTag(rawTag);
  if (!normalized) {
    return;
  }

  const usageCount = getTagUsageCount(normalized);
  const confirmed = window.confirm(
    `Delete tag "${normalized}" everywhere?\n\nThis will remove it from all tasks and notes${usageCount > 0 ? ` (${usageCount} linked item${usageCount === 1 ? '' : 's'})` : ''}.`
  );

  if (!confirmed) {
    return;
  }

  deleteGlobalTag(normalized);
}

function deleteGlobalTag(rawTag) {
  const normalized = normalizeTag(rawTag);
  if (!normalized) {
    return;
  }

  state.tags = state.tags.filter((tag) => tag.toLowerCase() !== normalized.toLowerCase());
  state.tasks.forEach((task) => {
    task.tags = (task.tags || []).filter((tag) => normalizeTag(tag).toLowerCase() !== normalized.toLowerCase());
  });
  state.notes.forEach((note) => {
    note.tags = (note.tags || []).filter((tag) => normalizeTag(tag).toLowerCase() !== normalized.toLowerCase());
  });

  if (state.tagFilter.toLowerCase() === normalized.toLowerCase()) {
    state.tagFilter = 'all';
  }

  queueSave();
  render();
  setStatus('Tag deleted');
}

function onCreateGlobalTag() {
  const next = refs.newTagInput.value;
  const normalized = normalizeTag(next);
  if (!normalized) {
    setStatus('Type a valid tag first');
    return;
  }

  if (state.tags.some((tag) => tag.toLowerCase() === normalized.toLowerCase())) {
    setStatus('Tag already exists');
    refs.newTagInput.value = '';
    return;
  }

  state.tags.push(normalized);
  state.tags = sanitizeTagList(state.tags);
  refs.newTagInput.value = '';
  queueSave();
  render();
  setStatus('Tag created');
}

function addTagToItem(type, id, rawTag) {
  const item = (type === 'task' ? state.tasks : state.notes).find((entry) => entry.id === id);
  if (!item) {
    return;
  }

  const normalized = normalizeTag(rawTag);
  if (!normalized) {
    return;
  }

  item.tags = sanitizeTagList([...(item.tags || []), normalized]);
  state.tags = sanitizeTagList([...state.tags, normalized]);
  item.updatedAt = new Date().toISOString();
  queueSave();
  render();
}

function removeTagFromItem(type, id, rawTag) {
  const item = (type === 'task' ? state.tasks : state.notes).find((entry) => entry.id === id);
  if (!item) {
    return;
  }

  const normalized = normalizeTag(rawTag);
  if (!normalized) {
    return;
  }

  item.tags = (item.tags || []).filter((tag) => tag.toLowerCase() !== normalized.toLowerCase());
  item.updatedAt = new Date().toISOString();
  queueSave();
  render();
}

function normalizeTag(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 32);
}

function sanitizeTagList(rawTags) {
  if (!Array.isArray(rawTags)) {
    return [];
  }

  const dedupe = new Set();
  const tags = [];

  rawTags.forEach((tag) => {
    const normalized = normalizeTag(tag);
    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();
    if (dedupe.has(key)) {
      return;
    }

    dedupe.add(key);
    tags.push(normalized);
  });

  return tags;
}

function focusItem(id) {
  requestAnimationFrame(() => {
    const target = refs.listContainer.querySelector(`.card[data-id="${cssEscape(id)}"] .text-input`);
    if (!target) {
      return;
    }

    target.focus();
    target.setSelectionRange(target.value.length, target.value.length);
    autoResizeTextarea(target);
  });
}

function onGlobalKeyDown(event) {
  const cmdOrCtrl = event.metaKey || event.ctrlKey;

  if (cmdOrCtrl && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    if (state.view === 'tasks') {
      createTask();
    } else {
      createNote();
    }
    return;
  }

  if (cmdOrCtrl && event.key.toLowerCase() === 's') {
    event.preventDefault();
    setStatus('Auto-save is always active');
    return;
  }

  if (event.key === 'Escape') {
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      active.blur();
    }
  }
}

function showToast(message, showUndo) {
  clearTimeout(state.toastTimer);
  refs.toastMessage.textContent = message;
  refs.toastUndo.style.display = showUndo ? 'inline-flex' : 'none';
  refs.toast.classList.add('visible');
  refs.toast.setAttribute('aria-hidden', 'false');

  if (!showUndo) {
    state.toastTimer = setTimeout(() => {
      hideToast();
    }, 2200);
  }
}

function hideToast() {
  refs.toast.classList.remove('visible');
  refs.toast.setAttribute('aria-hidden', 'true');
}

function setStatus(message) {
  refs.statusText.textContent = message;
}

function clearCloudRetry() {
  if (!state.cloudRetryTimer) {
    return;
  }

  clearTimeout(state.cloudRetryTimer);
  state.cloudRetryTimer = null;
}

function scheduleCloudRetry(delayMs) {
  if (!state.cloudSyncEnabled) {
    return;
  }

  clearCloudRetry();
  state.cloudRetryTimer = setTimeout(() => {
    state.cloudRetryTimer = null;
    const snapshot = getSerializableState();
    void pushToCloud(snapshot, JSON.stringify(snapshot));
  }, delayMs);
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatDate(iso) {
  if (!iso) {
    return '-';
  }
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(dt);
}

function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(72, textarea.scrollHeight)}px`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(value);
  }
  return value.replace(/([#.;?+*~\':"!^$\[\]()=>|/@])/g, '\\$1');
}
