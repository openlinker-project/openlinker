import { describe, expect, it } from 'vitest';
import type { ChangelogRelease } from '../../../build-time/changelog-parser';
import { buildDialogHighlights } from './release-dialog-content';

const entry = (text: string, commit: string) => ({ scope: null, text, refs: [], commits: [commit] });

const release: ChangelogRelease = {
  version: '0.20.0',
  date: '2026-01-01',
  prerelease: false,
  hasBreaking: false,
  breaking: [],
  groups: [
    {
      title: 'Features',
      entries: ['a', 'b', 'c', 'd', 'e', 'f'].map((t, i) => entry(t, `abcdef${i}`)),
    },
  ],
};

describe('buildDialogHighlights', () => {
  it('should cap curated highlights at four and count the rest as overflow', () => {
    const curated = ['abcdef0', 'abcdef1', 'abcdef2', 'abcdef3', 'abcdef4'];
    const result = buildDialogHighlights([release], '0.19.0', '0.20.0', () => curated);
    expect(result.highlights.map((h) => h.text)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.overflow).toBe(2);
  });

  it('should fall back to the first entries when nothing curated matches', () => {
    const result = buildDialogHighlights([release], '0.19.0', '0.20.0', () => ['zzzzzzz']);
    expect(result.highlights).toHaveLength(4);
  });

  it('should ignore releases outside the cursor range', () => {
    const result = buildDialogHighlights([release], '0.20.0', '0.20.0', () => []);
    expect(result.highlights).toEqual([]);
    expect(result.overflow).toBe(0);
  });
});
