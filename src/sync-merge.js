(function attachSyncMerge(globalFactory) {
  const api = createSyncMerge();
  const global = globalFactory();

  if (global) {
    global.TaskNotesSyncMerge = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  function createSyncMerge() {
  const DEFAULT_SNAPSHOT = {
    tasks: [],
    notes: [],
    tags: [],
    settings: { taskSort: 'manual', noteSort: 'manual' },
    version: 1
  };

  function cloneSnapshot(snapshot) {
    return snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
  }

  function hasUnsyncedLocalChanges(snapshot, cloudBaseSnapshot) {
    const current = snapshot || cloneSnapshot(DEFAULT_SNAPSHOT);

    if (!cloudBaseSnapshot) {
      return current.tasks.length > 0
        || current.notes.length > 0
        || current.tags.length > 0
        || current.settings.taskSort !== 'manual'
        || current.settings.noteSort !== 'manual';
    }

    return JSON.stringify(current) !== JSON.stringify(cloudBaseSnapshot);
  }

  function mergeSnapshots(baseSnapshot, localSnapshot, remoteSnapshot, options = {}) {
    const base = baseSnapshot || cloneSnapshot(DEFAULT_SNAPSHOT);
    const local = localSnapshot || cloneSnapshot(DEFAULT_SNAPSHOT);
    const remote = remoteSnapshot || cloneSnapshot(DEFAULT_SNAPSHOT);
    const sanitizeTagList = typeof options.sanitizeTagList === 'function' ? options.sanitizeTagList : defaultSanitizeTagList;
    const generateId = typeof options.generateId === 'function' ? options.generateId : defaultGenerateId;

    const taskMerge = mergeItemCollections(base.tasks, local.tasks, remote.tasks, generateId);
    const noteMerge = mergeItemCollections(base.notes, local.notes, remote.notes, generateId);
    const localSettingsChanged = JSON.stringify(local.settings || {}) !== JSON.stringify(base.settings || {});
    const remoteSettingsChanged = JSON.stringify(remote.settings || {}) !== JSON.stringify(base.settings || {});

    return {
      snapshot: {
        tasks: taskMerge.items,
        notes: noteMerge.items,
        tags: sanitizeTagList([...(remote.tags || []), ...(local.tags || []), ...(base.tags || [])]),
        settings: localSettingsChanged
          ? { ...(remote.settings || {}), ...(local.settings || {}) }
          : { ...(remoteSettingsChanged ? remote.settings : local.settings) },
        version: Math.max(base.version || 1, local.version || 1, remote.version || 1)
      },
      conflicts: taskMerge.conflicts + noteMerge.conflicts
    };
  }

  function mergeItemCollections(baseItems = [], localItems = [], remoteItems = [], generateId) {
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
        merged.push(createConflictCopy(localItem, generateId));
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

  function createConflictCopy(item, generateId) {
    const copy = cloneSnapshot(item);
    const prefix = '[Conflict copy] ';
    copy.id = generateId(copy.type === 'task' ? 'task' : 'note');
    copy.text = copy.text && copy.text.startsWith(prefix) ? copy.text : `${prefix}${copy.text || ''}`;
    copy.updatedAt = new Date().toISOString();
    return copy;
  }

  function resequenceManualOrder(list) {
    list.forEach((item, index) => {
      item.manualOrder = index;
    });
  }

  function defaultSanitizeTagList(rawTags) {
    if (!Array.isArray(rawTags)) {
      return [];
    }
    const seen = new Set();
    const tags = [];
    rawTags.forEach((rawTag) => {
      const tag = String(rawTag || '').trim().replace(/\s+/g, ' ').slice(0, 32);
      if (!tag) {
        return;
      }
      const dedupeKey = tag.toLocaleLowerCase();
      if (seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);
      tags.push(tag);
    });
    return tags;
  }

  function defaultGenerateId(prefix) {
    return `${String(prefix || 'item')}-${Math.random().toString(36).slice(2, 10)}`;
  }

    return {
      cloneSnapshot,
      hasUnsyncedLocalChanges,
      mergeSnapshots
    };
  }
}(function getGlobal() {
  return typeof globalThis !== 'undefined' ? globalThis : null;
}));