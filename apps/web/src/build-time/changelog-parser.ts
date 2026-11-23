/**
 * Changelog parser (#4144, ADR-086)
 *
 * Turns release-please's `CHANGELOG.md` into the plain data the in-app release
 * center renders. Pure and free of Node built-ins so the spec can import it and
 * the Vite plugin stays a thin file-reading shell around it.
 *
 * @module build
 */

export interface ChangelogEntry {
  scope: string | null;
  /** Entry text with PR/issue refs, commit hashes and issue links removed. */
  text: string;
  /** Issue and PR numbers cited by the entry, in order of appearance. */
  refs: number[];
  /** Commit hashes cited by the entry (as written, at least 7 hex characters); the update dialog matches curated highlights on them. */
  commits: string[];
}

export interface ChangelogGroup {
  title: string;
  entries: ChangelogEntry[];
}

export interface ChangelogRelease {
  version: string;
  /** ISO date (YYYY-MM-DD); null when the heading carries none. */
  date: string | null;
  /** True for a prerelease such as `0.20.0-rc.1`. */
  prerelease: boolean;
  groups: ChangelogGroup[];
  /** True when the release carries a BREAKING CHANGES block. */
  hasBreaking: boolean;
  /** The block's own entries; the update dialog flags them and never pastes them. */
  breaking: ChangelogEntry[];
}

export interface ChangelogBaseline {
  version: string;
  /** Ready markdown for the full changelog page; never parsed into entries. */
  markdown: string;
}

export interface ChangelogData {
  releases: ChangelogRelease[];
  baseline: ChangelogBaseline | null;
}

// A release heading carries a link; the hand-written baseline has neither link
// nor date, which is what tells the two apart. The date is optional because a
// release heading without one is still a release.
const RELEASE_HEADING = /^## \[([^\]]+)\]\([^)]*\)(?: \((\d{4}-\d{2}-\d{2})\))?\s*$/;
const BASELINE_HEADING = /^## \[([^\]]+)\]\s*$/;
const BREAKING_TITLE = /BREAKING CHANGES/i;

const LINKED_REF = /\s*\(\[(?:#\d+|[0-9a-f]{7,40})\]\([^)]*\)\)/g;
const CLOSES_CLAUSE = /,?\s*closes\s+\[#\d+\]\([^)]*\)(?:,\s*\[#\d+\]\([^)]*\))*/gi;
const BARE_ISSUE_LINK = /\[#(\d+)\]\([^)]*\)/g;
const ISSUE_NUMBER = /\[#(\d+)\]\(/g;
const COMMIT_LINK = /\[([0-9a-f]{7,40})\]\([^)]*\/commit\/[0-9a-f]+\)/g;

function parseEntry(line: string): ChangelogEntry {
  const body = line.replace(/^\*\s+/, '');
  const refs = [...body.matchAll(ISSUE_NUMBER)].map((m) => Number(m[1]));
  const commits = [...body.matchAll(COMMIT_LINK)].map((m) => m[1]);
  const scoped = /^\*\*([^*]+):\*\*\s*(.*)$/.exec(body);
  const scope = scoped ? scoped[1].trim() : null;
  const rest = scoped ? scoped[2] : body;
  const text = rest
    .replace(LINKED_REF, '')
    .replace(CLOSES_CLAUSE, '')
    .replace(BARE_ISSUE_LINK, '#$1')
    .replace(/\s+/g, ' ')
    .trim();
  return { scope, text, refs, commits };
}

export function parseChangelog(markdown: string): ChangelogData {
  const lines = markdown.split(/\r?\n/);
  const releases: ChangelogRelease[] = [];
  let baseline: ChangelogBaseline | null = null;

  let release: ChangelogRelease | null = null;
  let group: ChangelogGroup | null = null;
  let inBreaking = false;
  let baselineLines: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      release = null;
      group = null;
      inBreaking = false;
      baselineLines = null;
      const heading = RELEASE_HEADING.exec(line);
      if (heading) {
        release = {
          version: heading[1],
          date: heading[2] ?? null,
          prerelease: heading[1].includes('-'),
          groups: [],
          hasBreaking: false,
          breaking: [],
        };
        releases.push(release);
        continue;
      }
      const base = BASELINE_HEADING.exec(line);
      if (base) {
        baselineLines = [];
        baseline = { version: base[1], markdown: '' };
      }
      // An unrecognised heading is skipped here; the spec compares the
      // recognised count with the file's `## ` count so a format change is seen.
      continue;
    }

    if (baselineLines && baseline) {
      baselineLines.push(line);
      baseline.markdown = baselineLines.join('\n').trim();
      continue;
    }
    if (!release) continue;

    if (line.startsWith('### ')) {
      const title = line.slice(4).trim();
      inBreaking = BREAKING_TITLE.test(title);
      if (inBreaking) {
        release.hasBreaking = true;
        group = null;
      } else {
        group = { title, entries: [] };
        release.groups.push(group);
      }
      continue;
    }

    if (line.startsWith('* ')) {
      const entry = parseEntry(line);
      if (inBreaking) release.breaking.push(entry);
      else if (group) group.entries.push(entry);
    }
    // Indented sub-bullets continue the previous entry; the dialog and list
    // render the summary line only, so they are deliberately dropped.
  }

  return { releases, baseline };
}

/** Counts `## ` headings, for the spec that guards against a silently skipped release. */
export function countReleaseHeadings(markdown: string): number {
  return markdown.split(/\r?\n/).filter((l) => l.startsWith('## ')).length;
}
