/**
 * Changelog build plugin (#4144, ADR-085)
 *
 * Exposes release-please's `CHANGELOG.md` to the app as the virtual module
 * `virtual:openlinker-changelog` (the parsed {@link ChangelogData}). The file is
 * read lazily in `buildStart`, so a dev server or a test run that never needs it
 * pays nothing, and a missing file fails the build instead of shipping an empty
 * changelog.
 *
 * `vite.config.ts` is also loaded by vitest, so under tests the module resolves
 * to an empty changelog and the file is never read.
 *
 * @module build
 */

import { readFileSync } from 'node:fs';

import type { Plugin } from 'vite';

import { parseChangelog, type ChangelogData } from './changelog-parser';

export const CHANGELOG_MODULE_ID = 'virtual:openlinker-changelog';
const RESOLVED_ID = `\0${CHANGELOG_MODULE_ID}`;

export interface ChangelogPluginOptions {
  changelogPath: string;
  mode: string;
}

export function createChangelogPlugin({ changelogPath, mode }: ChangelogPluginOptions): Plugin {
  const skip = mode === 'test' || Boolean(process.env.VITEST);
  let data: ChangelogData = { releases: [], baseline: null };

  return {
    name: 'openlinker-changelog',
    buildStart(): void {
      if (skip) return;
      let source: string;
      try {
        source = readFileSync(changelogPath, 'utf-8');
      } catch (error) {
        throw new Error(
          `CHANGELOG.md not found at ${changelogPath}. The release center is built from it; ` +
            `the web Docker build must COPY it before building. ${(error as Error).message}`
        );
      }
      data = parseChangelog(source);
      if (data.releases.length === 0) {
        throw new Error(`No releases recognised in ${changelogPath}; the heading format changed.`);
      }
    },
    resolveId(id): string | null {
      return id === CHANGELOG_MODULE_ID ? RESOLVED_ID : null;
    },
    load(id): string | null {
      return id === RESOLVED_ID ? `export default ${JSON.stringify(data)};` : null;
    },
  };
}
