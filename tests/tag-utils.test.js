import { describe, expect, it } from 'vitest';
import tagUtils from '../src/tag-utils.js';

const { normalizeTag, sanitizeTagList } = tagUtils;

describe('tag-utils', () => {
  it('normalizes whitespace and trims tag values', () => {
    expect(normalizeTag('   work   item   ')).toBe('work item');
  });

  it('limits tag length to 32 characters', () => {
    expect(normalizeTag('abcdefghijklmnopqrstuvwxyz123456789')).toHaveLength(32);
  });

  it('deduplicates tags case-insensitively and drops empty values', () => {
    expect(sanitizeTagList([' Work ', 'work', '', 'Personal', 'personal '])).toEqual(['Work', 'Personal']);
  });
});