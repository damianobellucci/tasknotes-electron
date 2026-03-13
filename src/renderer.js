const SAVE_DEBOUNCE_MS = 450;
const UNDO_TIMEOUT_MS = 5000;

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
  search: '',
  dataFilePath: '',
  saveTimer: null,
  saveInFlight: false,
  pendingSave: false,
  deletedSnapshot: null,
  undoTimer: null,
  dragItemId: null
};

const refs = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindRefs();
  bindStaticEvents();
  await loadInitialData();
  render();
}

function bindRefs() {
  refs.tabTasks = document.getElementById('tabTasks');
  refs.tabNotes = document.getElementById('tabNotes');
  refs.newItemButton = document.getElementById('newItemButton');
  refs.sortSelect = document.getElementById('sortSelect');
  refs.taskFilterWrap = document.getElementById('taskFilterWrap');
  refs.taskFilterSelect = document.getElementById('taskFilterSelect');
  refs.searchInput = document.getElementById('searchInput');
  refs.exportButton = document.getElementById('exportButton');
  refs.importButton = document.getElementById('importButton');
  refs.taskStats = document.getElementById('taskStats');
  refs.listContainer = document.getElementById('listContainer');
  refs.statusText = document.getElementById('statusText');
  refs.dataPathText = document.getElementById('dataPathText');
  refs.toast = document.getElementById('toast');
  refs.toastMessage = document.getElementById('toastMessage');
  refs.toastUndo = document.getElementById('toastUndo');
}

function bindStaticEvents() {
  refs.tabTasks.addEventListener('click', () => switchView('tasks'));
  refs.tabNotes.addEventListener('click', () => switchView('notes'));

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

  refs.exportButton.addEventListener('click', onExportData);
  refs.importButton.addEventListener('click', onImportData);

  refs.toastUndo.addEventListener('click', undoDelete);

  document.addEventListener('keydown', onGlobalKeyDown);
}

async function loadInitialData() {
  try {
    const result = await window.electronAPI.loadData();
    if (!result?.ok) {
      throw new Error('Data load failed');
    }

    state.tasks = Array.isArray(result.data.tasks) ? result.data.tasks : [];
    state.notes = Array.isArray(result.data.notes) ? result.data.notes : [];
    state.settings = {
      ...state.settings,
      ...result.data.settings
    };
    state.version = result.data.version || 1;
    state.dataFilePath = result.dataFilePath || '';

    const appInfo = await window.electronAPI.getAppInfo();
    if (appInfo?.dataFilePath) {
      state.dataFilePath = appInfo.dataFilePath;
    }

    refs.dataPathText.textContent = state.dataFilePath ? `Data: ${state.dataFilePath}` : '';
    setStatus('Data loaded');
  } catch (error) {
    setStatus(`Load fallback: ${error.message}`);
  }
}

function switchView(view) {
  state.view = view;
  refs.tabTasks.classList.toggle('active', view === 'tasks');
  refs.tabNotes.classList.toggle('active', view === 'notes');
  refs.tabTasks.setAttribute('aria-selected', String(view === 'tasks'));
  refs.tabNotes.setAttribute('aria-selected', String(view === 'notes'));
  refs.newItemButton.textContent = view === 'tasks' ? '+ New Task' : '+ New Note';
  render();
}

function render() {
  renderSortControls();
  renderStats();
  renderList();
}

function renderSortControls() {
  const isTasks = state.view === 'tasks';
  refs.taskFilterWrap.style.display = isTasks ? 'flex' : 'none';

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
  if (state.view !== 'tasks') {
    refs.taskStats.style.visibility = 'hidden';
    refs.taskStats.innerHTML = '';
    return;
  }

  refs.taskStats.style.visibility = 'visible';
  const openTasks = state.tasks.filter((task) => !task.done);
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
  const items = state.view === 'tasks' ? getVisibleTasks() : getVisibleNotes();

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
        <button class="delete-btn" data-action="delete">Delete</button>
      </div>
    </article>
  `;
}

function bindDynamicEvents(items) {
  const itemMap = new Map(items.map((i) => [i.id, i]));

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
    archived: false
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
    manualOrder: nextHeadOrder(state.notes)
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
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) {
    return;
  }

  const [removed] = list.splice(index, 1);
  state.deletedSnapshot = { type, index, item: removed };
  resequenceManualOrder(list);
  queueSave();
  render();
  showToast(`${type === 'task' ? 'Task' : 'Note'} deleted`, true);

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

  const { type, index, item } = state.deletedSnapshot;
  const list = type === 'task' ? state.tasks : state.notes;
  const boundedIndex = Math.min(index, list.length);
  list.splice(boundedIndex, 0, item);
  resequenceManualOrder(list);
  queueSave();
  render();
  state.deletedSnapshot = null;
  hideToast();
  setStatus('Delete undone');
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
  const payload = getSerializableState();

  if (state.saveInFlight) {
    state.pendingSave = true;
    return;
  }

  state.saveInFlight = true;
  try {
    await window.electronAPI.saveData(payload);
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

    state.tasks = result.data.tasks || [];
    state.notes = result.data.notes || [];
    state.settings = {
      ...state.settings,
      ...result.data.settings
    };

    render();
    queueSave();
    setStatus(`Imported from ${result.filePath}`);
  } catch (error) {
    setStatus(`Import error: ${error.message}`);
  }
}

function getVisibleTasks() {
  const sortMode = state.settings.taskSort;
  let tasks = [...state.tasks];

  if (state.taskFilter === 'open') {
    tasks = tasks.filter((task) => !task.done);
  } else if (state.taskFilter === 'done') {
    tasks = tasks.filter((task) => task.done);
  }

  if (state.search) {
    tasks = tasks.filter((task) => task.text.toLowerCase().includes(state.search));
  }

  return sortItems(tasks, sortMode, true);
}

function getVisibleNotes() {
  let notes = [...state.notes];
  if (state.search) {
    notes = notes.filter((note) => note.text.toLowerCase().includes(state.search));
  }
  return sortItems(notes, state.settings.noteSort, false);
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
    return state.settings.taskSort === 'manual' && state.taskFilter === 'all' && !state.search;
  }
  return state.settings.noteSort === 'manual' && !state.search;
}

function findItemById(view, id) {
  const list = view === 'tasks' ? state.tasks : state.notes;
  return list.find((item) => item.id === id);
}

function getSerializableState() {
  return {
    tasks: state.tasks,
    notes: state.notes,
    settings: state.settings,
    version: state.version
  };
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
  refs.toastMessage.textContent = message;
  refs.toastUndo.style.display = showUndo ? 'inline-flex' : 'none';
  refs.toast.classList.add('visible');
  refs.toast.setAttribute('aria-hidden', 'false');
}

function hideToast() {
  refs.toast.classList.remove('visible');
  refs.toast.setAttribute('aria-hidden', 'true');
}

function setStatus(message) {
  refs.statusText.textContent = message;
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
