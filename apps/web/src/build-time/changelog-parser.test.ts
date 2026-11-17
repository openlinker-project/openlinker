import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { countReleaseHeadings, parseChangelog } from './changelog-parser';
import { createChangelogPlugin } from './changelog-plugin';

const LINK = (n: number): string => `[#${n}](https://x/issues/${n})`;

describe('parseChangelog', () => {
  it('should recognise every heading of the real CHANGELOG.md when the file is parsed', () => {
    const path = [
      resolve(process.cwd(), '../../CHANGELOG.md'),
      resolve(process.cwd(), 'CHANGELOG.md'),
    ].find((p) => existsSync(p));
    expect(path).toBeDefined();
    const source = readFileSync(path as string, 'utf-8');

    const data = parseChangelog(source);

    expect(data.releases.length + (data.baseline ? 1 : 0)).toBe(countReleaseHeadings(source));
    expect(data.baseline?.version).toBe('0.1.0');
    expect(data.releases.some((r) => r.hasBreaking)).toBe(true);
  });

  it('should strip refs, hashes and closes clauses from entry text', () => {
    const md = [
      '## [0.2.0](https://x/compare/a...b) (2026-01-02)',
      '',
      '### Features',
      '',
      `* **web:** explicit checkbox (${LINK(4067)}) ([741725f](https://x/commit/741725ff)), closes ${LINK(4066)}`,
    ].join('\n');

    const [release] = parseChangelog(md).releases;

    expect(release.date).toBe('2026-01-02');
    expect(release.groups[0].entries[0]).toEqual({
      scope: 'web',
      text: 'explicit checkbox',
      refs: [4067, 4066],
    });
  });

  it('should keep a release with no sections and flag a prerelease', () => {
    const md =
      '## [0.3.0-rc.1](https://x/c) (2026-02-01)\n\n## [0.2.0](https://x/c) (2026-01-01)\n';

    const { releases } = parseChangelog(md);

    expect(releases.map((r) => [r.version, r.prerelease, r.groups.length])).toEqual([
      ['0.3.0-rc.1', true, 0],
      ['0.2.0', false, 0],
    ]);
  });

  it('should treat the linkless 0.1.0 entry as a baseline and not parse its sections', () => {
    const md = '## [0.1.0]\n\nFirst release.\n\n### Frontend\n\n* A thing\n';

    const data = parseChangelog(md);

    expect(data.releases).toEqual([]);
    expect(data.baseline?.version).toBe('0.1.0');
    expect(data.baseline?.markdown).toContain('* A thing');
  });

  it('should flag BREAKING CHANGES and keep them out of the groups', () => {
    const md = [
      '## [0.2.0](https://x/c) (2026-01-01)',
      '',
      '### ⚠ BREAKING CHANGES',
      '',
      '* **api:** endpoint now answers 202',
      '',
      '### Features',
      '',
      '* **api:** a feature',
    ].join('\n');

    const [release] = parseChangelog(md).releases;

    expect(release.hasBreaking).toBe(true);
    expect(release.breaking).toHaveLength(1);
    expect(release.groups.map((g) => g.title)).toEqual(['Features']);
  });
});

describe('createChangelogPlugin', () => {
  it('should not read the file under vitest', () => {
    const plugin = createChangelogPlugin({ changelogPath: '/does/not/exist', mode: 'test' });

    const buildStart = plugin.buildStart as () => void;

    expect(() => buildStart.call({})).not.toThrow();
  });
});
