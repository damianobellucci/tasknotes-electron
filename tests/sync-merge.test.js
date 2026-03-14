import { describe, expect, it } from 'vitest';
import syncMerge from '../src/sync-merge.js';

const { cloneSnapshot, hasUnsyncedLocalChanges, mergeSnapshots } = syncMerge;

function createSnapshot(overrides = {}) {
  return {
    tasks: [],
    notes: [],
    tags: [],
    settings: { taskSort: 'manual', noteSort: 'manual' },
    version: 1,
    ...overrides
  };
}

describe('sync-merge', () => {
  it('detects unsynced local changes when no baseline exists', () => {
    const snapshot = createSnapshot({ tasks: [{ id: 'task-1', text: 'A' }] });
    expect(hasUnsyncedLocalChanges(snapshot, null)).toBe(true);
  });

  it('clones snapshots deeply', () => {
    const snapshot = createSnapshot({ tasks: [{ id: 'task-1', text: 'A' }] });
    const copy = cloneSnapshot(snapshot);
    copy.tasks[0].text = 'B';
    expect(snapshot.tasks[0].text).toBe('A');
  });

  it('merges non-overlapping local and remote changes', () => {
    const base = createSnapshot();
    const local = createSnapshot({ tasks: [{ id: 'task-local', type: 'task', text: 'Local task', manualOrder: 0 }] });
    const remote = createSnapshot({ notes: [{ id: 'note-remote', type: 'note', text: 'Remote note', manualOrder: 0 }] });

    const result = mergeSnapshots(base, local, remote, {
      sanitizeTagList: (tags) => [...new Set(tags.filter(Boolean))],
      generateId: (prefix) => `${prefix}-generated`
    });

    expect(result.conflicts).toBe(0);
    expect(result.snapshot.tasks).toHaveLength(1);
    expect(result.snapshot.notes).toHaveLength(1);
  });

  it('creates a conflict copy when local and remote diverge on the same item', () => {
    const base = createSnapshot({
      tasks: [{ id: 'task-1', type: 'task', text: 'Base', manualOrder: 0 }]
    });
    const local = createSnapshot({
      tasks: [{ id: 'task-1', type: 'task', text: 'Local edit', manualOrder: 0 }]
    });
    const remote = createSnapshot({
      tasks: [{ id: 'task-1', type: 'task', text: 'Remote edit', manualOrder: 0 }]
    });

    const result = mergeSnapshots(base, local, remote, {
      sanitizeTagList: (tags) => [...new Set(tags.filter(Boolean))],
      generateId: () => 'task-conflict-copy'
    });

    expect(result.conflicts).toBe(1);
    expect(result.snapshot.tasks).toHaveLength(2);
    expect(result.snapshot.tasks[1].id).toBe('task-conflict-copy');
    expect(result.snapshot.tasks[1].text.startsWith('[Conflict copy] ')).toBe(true);
  });
});