(function attachTagUtils(global) {
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

  global.TaskNotesTagUtils = {
    normalizeTag,
    sanitizeTagList
  };
}(window));