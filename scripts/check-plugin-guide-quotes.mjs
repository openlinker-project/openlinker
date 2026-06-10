#!/usr/bin/env node
/**
 * Plugin Author Guide Quote Drift Guard (#680)
 *
 * `docs/plugin-author-guide.md` pins three source references that must
 * stay in sync with the live code:
 *
 *   1. **Verbatim quote** of `CoreCapabilityValues` at
 *      `libs/core/src/integrations/domain/types/adapter.types.ts:22-28`,
 *      reproduced inline in the guide as a fenced TypeScript block.
 *      Drift = the guide quotes stale capability values; readers code
 *      against a list that no longer matches the registry.
 *
 *   2. **Boundary check** for the `AdapterPlugin` interface at
 *      `libs/plugin-sdk/src/adapter-plugin.ts:42-110`. The guide doesn't
 *      reproduce the body but pins the line range. Drift = an import
 *      added above the interface or the interface extending past line
 *      110; the link still resolves but lands on the wrong content.
 *
 *   3. **Boundary check** for the `HostServices` interface at
 *      `libs/plugin-sdk/src/host-services.ts:54-163`. Same shape.
 *
 * Both checks are deliberately strict: when they fire on a benign
 * refactor (e.g., new import above the interface), the human updates
 * the guide's line range. That re-read is exactly the value the
 * invariant exists to extract.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain.
 *
 * Exits non-zero on drift, with one line per violation to stderr.
 *
 * @module scripts
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const GUIDE = resolve(ROOT, 'docs/plugin-author-guide.md');

/**
 * Pinned references the guide MUST keep in sync. Add a new entry only
 * when a new pinned reference is introduced in the guide.
 */
const VERBATIM_QUOTES = [
  {
    label: 'CoreCapabilityValues',
    sourceFile: 'libs/core/src/integrations/domain/types/adapter.types.ts',
    sourceStart: 22, // 1-indexed
    sourceEnd: 28,
    guideLinkSubstring: 'adapter.types.ts:22-28',
    fenceOpen: '```typescript',
  },
];

const BOUNDARY_REFS = [
  {
    label: 'AdapterPlugin',
    sourceFile: 'libs/plugin-sdk/src/adapter-plugin.ts',
    sourceStart: 42,
    sourceEnd: 110,
    guideLinkSubstring: 'adapter-plugin.ts:42-110',
    expectedStart: /^export interface AdapterPlugin \{$/,
    expectedEnd: /^\}\s*$/,
  },
  {
    label: 'HostServices',
    sourceFile: 'libs/plugin-sdk/src/host-services.ts',
    sourceStart: 54,
    sourceEnd: 163,
    guideLinkSubstring: 'host-services.ts:54-163',
    expectedStart: /^export interface HostServices \{$/,
    expectedEnd: /^\}\s*$/,
  },
];

// Cap the gap between the guide's link line and the verbatim fence so a
// later refactor inserting an unrelated paragraph between them doesn't
// accidentally pair the wrong fence. Five lines is generous enough to
// allow a one-line introductory sentence + blank lines.
const MAX_LINES_BETWEEN_LINK_AND_FENCE = 5;

const errors = [];

function fail(msg) {
  errors.push(msg);
}

async function readLines(absPath) {
  const raw = await readFile(absPath, 'utf8');
  // Strip the trailing newline so split doesn't yield an empty trailing
  // element; line indices stay 1:1 with editor line numbers.
  const trimmed = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  return trimmed.split('\n');
}

function checkGuideReferenceExists(guideLines, substring, label) {
  const idx = guideLines.findIndex((l) => l.includes(substring));
  if (idx === -1) {
    fail(
      `check-plugin-guide-quotes: guide is missing reference to ${substring} (label: ${label})`,
    );
    return -1;
  }
  return idx;
}

async function checkVerbatim(guideLines, quote) {
  const linkIdx = checkGuideReferenceExists(
    guideLines,
    quote.guideLinkSubstring,
    quote.label,
  );
  if (linkIdx === -1) return;

  const fenceStartIdx = guideLines.findIndex(
    (l, i) => i > linkIdx && l.startsWith(quote.fenceOpen),
  );
  if (fenceStartIdx === -1) {
    fail(
      `check-plugin-guide-quotes: expected a "${quote.fenceOpen}" fence after the ${quote.label} reference at guide line ${linkIdx + 1}, none found`,
    );
    return;
  }
  if (fenceStartIdx - linkIdx > MAX_LINES_BETWEEN_LINK_AND_FENCE) {
    fail(
      `check-plugin-guide-quotes: expected the ${quote.label} fence within ${MAX_LINES_BETWEEN_LINK_AND_FENCE} lines of the reference (link at ${linkIdx + 1}, fence at ${fenceStartIdx + 1})`,
    );
    return;
  }
  const fenceEndIdx = guideLines.findIndex(
    (l, i) => i > fenceStartIdx && l === '```',
  );
  if (fenceEndIdx === -1) {
    fail(
      `check-plugin-guide-quotes: ${quote.label} fence at guide line ${fenceStartIdx + 1} is never closed`,
    );
    return;
  }
  const quotedLines = guideLines.slice(fenceStartIdx + 1, fenceEndIdx);

  // Read source lines and compare 1:1.
  const sourceAbs = resolve(ROOT, quote.sourceFile);
  const sourceLines = await readLines(sourceAbs);
  const expectedLines = sourceLines.slice(quote.sourceStart - 1, quote.sourceEnd);

  if (quotedLines.length !== expectedLines.length) {
    fail(
      `check-plugin-guide-quotes: ${quote.label} block length mismatch — guide has ${quotedLines.length} lines, source has ${expectedLines.length} lines (source range ${quote.sourceStart}-${quote.sourceEnd})`,
    );
    return;
  }

  for (let i = 0; i < expectedLines.length; i++) {
    const guideLine = quotedLines[i].trimEnd();
    const sourceLine = expectedLines[i].trimEnd();
    if (guideLine !== sourceLine) {
      const sourceLineNum = quote.sourceStart + i;
      fail(
        `check-plugin-guide-quotes: ${quote.label} quote drift — source ${quote.sourceFile}:${sourceLineNum} = "${sourceLine}", guide block line ${i + 1} = "${guideLine}"`,
      );
      return; // One mismatch per quote is enough signal.
    }
  }
}

async function checkBoundary(guideLines, ref) {
  // Confirm the guide still carries the reference (the link line). If
  // the guide drops it entirely, the boundary check has no anchor.
  const linkIdx = checkGuideReferenceExists(
    guideLines,
    ref.guideLinkSubstring,
    ref.label,
  );
  if (linkIdx === -1) return;

  const sourceAbs = resolve(ROOT, ref.sourceFile);
  const sourceLines = await readLines(sourceAbs);

  if (sourceLines.length < ref.sourceEnd) {
    fail(
      `check-plugin-guide-quotes: ${ref.sourceFile} has only ${sourceLines.length} lines, guide references line ${ref.sourceEnd}`,
    );
    return;
  }

  const startLine = sourceLines[ref.sourceStart - 1];
  if (!ref.expectedStart.test(startLine)) {
    fail(
      `check-plugin-guide-quotes: ${ref.sourceFile}:${ref.sourceStart} does not match expected "${ref.expectedStart.source}" (found: "${startLine}")`,
    );
  }

  const endLine = sourceLines[ref.sourceEnd - 1];
  if (!ref.expectedEnd.test(endLine)) {
    fail(
      `check-plugin-guide-quotes: ${ref.sourceFile}:${ref.sourceEnd} does not match expected closing "${ref.expectedEnd.source}" (found: "${endLine}")`,
    );
  }
}

async function main() {
  const guideLines = await readLines(GUIDE);

  for (const quote of VERBATIM_QUOTES) {
    await checkVerbatim(guideLines, quote);
  }
  for (const ref of BOUNDARY_REFS) {
    await checkBoundary(guideLines, ref);
  }

  if (errors.length > 0) {
    for (const msg of errors) {
      process.stderr.write(`${msg}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `check-plugin-guide-quotes: OK (${VERBATIM_QUOTES.length} verbatim block, ${BOUNDARY_REFS.length} boundary references)\n`,
  );
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`check-plugin-guide-quotes: unexpected error — ${message}\n`);
  process.exit(1);
}
