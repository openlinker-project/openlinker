#!/usr/bin/env node
/**
 * check-help-links.mjs
 *
 * Lint-time invariant for the in-app help links (#81, G04-7).
 *
 * Rule. Every `HELP_LINK_TARGETS` entry in apps/web/src/shared/lib/help-links.ts
 * names a docs-site page and a heading anchor. The docs site
 * (openlinker-project/openlinker-docs, Astro + Starlight) builds each page
 * from a file in THIS repo and slugs every heading with github-slugger, so an
 * anchor is valid exactly when a heading in that source file slugs to it. A
 * renamed or renumbered heading used to land the operator on the top of the
 * page with nothing failing; now it fails the build.
 *
 * PAGE_SOURCES mirrors the docs repo's `SOURCES` map (scripts/sync-docs.mjs
 * there) for the pages linked from the app. A page the map does not know
 * fails, so adding a link to a new page means adding its source here.
 *
 * Slugging, as github-slugger 2 does it: lower-case, drop every character
 * that is not a letter, mark, number, connector punctuation, `-` or space,
 * then each space becomes `-`; a repeated slug gets `-1`, `-2`, ... The sync
 * strips the file's first H1 (it becomes the page title), so that heading is
 * not an anchor. Raw `id="..."` anchors in the markdown count too.
 *
 * Fails loudly when it reads zero targets or a page with zero headings
 * (#3303), so a rename that makes the parser read nothing cannot pass.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const HELP_LINKS = 'apps/web/src/shared/lib/help-links.ts';

const PAGE_SOURCES = {
  'architecture-overview': 'docs/architecture-overview.md',
  'integrations/prestashop': 'libs/integrations/prestashop/docs/setup-guide.md',
  'user-guide/sales-documents': 'docs/user-guide/04b-sales-documents.md',
};

/** `'key': { page: '...', anchor: '...' }` entries, one per line. */
export function readTargets(source) {
  const block = /HELP_LINK_TARGETS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (!block) return [];
  const targets = [];
  for (const m of block[1].matchAll(/'([^']+)'\s*:\s*\{\s*page:\s*'([^']+)'\s*,\s*anchor:\s*'([^']+)'\s*\}/g)) {
    targets.push({ key: m[1], page: m[2], anchor: m[3] });
  }
  return targets;
}

/** Plain text of a heading's markdown: code keeps its content, links keep their text. */
function headingText(raw) {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .trim();
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/** Every anchor a synced page carries. */
export function readAnchors(markdown) {
  let body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
  const anchors = new Set();
  const seen = new Map();
  let inFence = false;
  let firstH1Skipped = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const m of line.matchAll(/\bid="([^"]+)"/g)) anchors.add(m[1]);
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    if (h[1] === '#' && !firstH1Skipped) {
      firstH1Skipped = true;
      continue;
    }
    const base = slugify(headingText(h[2]));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

function selfCheck() {
  const cases = [
    [slugify('17. Sales Documents'), '17-sales-documents'],
    [slugify('11. Logging & Monitoring'), '11-logging--monitoring'],
    [slugify('Settings → Document routing'), 'settings--document-routing'],
    [slugify('6. Listings (Offers)'), '6-listings-offers'],
    [slugify('Installing — development'), 'installing--development'],
    [slugify('Outbound rate limit'), 'outbound-rate-limit'],
  ];
  const md = '# Title\n\n## A\n\n```\n## Not a heading\n```\n\n## A\n\n### `code` and [link](x)\n<a id="pinned"></a>\n';
  const anchors = readAnchors(md);
  cases.push(
    [anchors.has('title'), false],
    [anchors.has('a') && anchors.has('a-1'), true],
    [anchors.has('not-a-heading'), false],
    [anchors.has('code-and-link'), true],
    [anchors.has('pinned'), true],
  );
  const targets = readTargets(
    "export const HELP_LINK_TARGETS: X = {\n  'a': { page: 'p', anchor: 'x' },\n  // c\n  'b': { page: 'q', anchor: 'y' },\n};"
  );
  cases.push([targets.length, 2], [targets[1]?.anchor, 'y'], [readTargets('nothing here').length, 0]);
  cases.forEach(([actual, expected], i) => {
    if (actual !== expected) {
      console.error(`check-help-links --self-check FAILED at case ${i}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
      process.exit(1);
    }
  });
  console.log('check-help-links --self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) return selfCheck();
  const targets = readTargets(await readFile(join(repoRoot, HELP_LINKS), 'utf8'));
  if (targets.length === 0) {
    console.error(`check-help-links FAILED: read zero HELP_LINK_TARGETS entries from ${HELP_LINKS}`);
    process.exit(1);
  }
  const problems = [];
  const cache = new Map();
  for (const { key, page, anchor } of targets) {
    const src = PAGE_SOURCES[page];
    if (!src) {
      problems.push(`'${key}': page '${page}' has no source file in PAGE_SOURCES (mirror the docs repo's SOURCES)`);
      continue;
    }
    if (!cache.has(src)) {
      let md;
      try {
        md = await readFile(join(repoRoot, src), 'utf8');
      } catch {
        problems.push(`'${key}': source ${src} for page '${page}' does not exist`);
        continue;
      }
      const anchors = readAnchors(md);
      if (anchors.size === 0) problems.push(`${src}: read zero headings`);
      cache.set(src, anchors);
    }
    if (!cache.get(src).has(anchor)) {
      problems.push(`'${key}': no heading in ${src} slugs to '#${anchor}'`);
    }
  }
  if (problems.length > 0) {
    console.error('check-help-links FAILED (#81):\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  console.log(`check-help-links OK (${targets.length} links, every anchor found in its source)`);
}

await main();
