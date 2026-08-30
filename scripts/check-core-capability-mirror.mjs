#!/usr/bin/env node
/**
 * check-core-capability-mirror.mjs
 *
 * Lint-time invariant for the mirrors of `CoreCapabilityValues` (#2351).
 *
 * The authoritative declaration is
 *   libs/core/src/integrations/domain/types/adapter.types.ts
 * and it has THREE hand-maintained mirrors, two of which drift silently today:
 *
 * MIRROR 1 — the frontend union `CORE_CAPABILITY_VALUES`
 *   (apps/web/src/features/connections/api/connections.types.ts). `apps/web`
 *   cannot import `@openlinker/core` (#591), so this is a copy by construction.
 *   Nothing fails when a member is missing from it: the FE union is simply
 *   narrower, every `.includes()` narrowing still compiles, and the capability
 *   is quietly un-offerable in the setup wizards and the capabilities panel.
 *
 * MIRROR 2 — `CAPABILITY_HELP`
 *   (apps/web/src/features/connections/lib/capability-metadata.ts). Typed
 *   `Record<CoreCapability, string>` over the FE union, so a MISSING key is a
 *   type error — but only once mirror 1 has the member. Add the member to
 *   neither and the type checker is satisfied, which is exactly the silent
 *   drift this script closes.
 *
 * MIRROR 3 — the fenced table in `docs/capabilities.md` between
 *   `<!-- core-capabilities:start -->` / `:end`. Nothing checks it at all today.
 *
 * NOT checked here: `docs/plugin-author-guide.md`, whose verbatim quote of the
 * same array is already owned by `check-plugin-guide-quotes.mjs`. One fact, one
 * guard — two guards on one fact can disagree.
 *
 * Every file is parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * stays a zero-dependency `check:invariants` step like its siblings.
 *
 * Run with `--self-check` to exercise the pure parsers + differ against
 * synthetic inputs (no filesystem), including deliberately drifted fixtures.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const CORE_FILE = join(
  'libs',
  'core',
  'src',
  'integrations',
  'domain',
  'types',
  'adapter.types.ts'
);
const FE_UNION_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'connections',
  'api',
  'connections.types.ts'
);
const FE_HELP_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'connections',
  'lib',
  'capability-metadata.ts'
);
const DOCS_FILE = join('docs', 'capabilities.md');

const CORE_DECLARATION = 'CoreCapabilityValues';
const FE_DECLARATION = 'CORE_CAPABILITY_VALUES';
const HELP_DECLARATION = 'CAPABILITY_HELP';

const DOCS_FENCE_START = '<!-- core-capabilities:start -->';
const DOCS_FENCE_END = '<!-- core-capabilities:end -->';

const DOCS_REF = 'docs/capabilities.md';

/** Strip line and block comments so an annotated entry can't be read as a value. */
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Extract the string literals of `export const <name> = [...] as const;`, with
 * the 1-based line the declaration starts on. Returns `{ line, values }`, or
 * `null` when the declaration is absent or its bracket is unbalanced.
 */
export function parseCapabilityValues(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;

  // Comments are stripped BEFORE the closing bracket is located, not after.
  // Locating it first (`indexOf(']', openBracket)` on raw text) truncated the
  // array at any `]` that appeared inside an entry's comment — and an annotated
  // entry legitimately carries one, e.g. `AUTHORITY_KIND_DESCRIPTORS['x']`. The
  // members after that point vanished from the parse, so the script reported
  // every mirror as carrying a value "MISSING from core" and pointed the reader
  // at three innocent mirrors instead of the one comment at fault (#2403).
  const strippedRest = stripComments(content.slice(openBracket + 1));
  const closeBracket = strippedRest.indexOf(']');
  if (closeBracket === -1) return null;

  const body = strippedRest.slice(0, closeBracket);

  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) {
    values.push(m[1] ?? m[2]);
  }

  return { line: content.slice(0, declMatch.index).split('\n').length, values };
}

/**
 * Ordered depth-1 keys of `export const <name>: … = { … };`.
 *
 * String CONTENTS are skipped rather than scanned: a help sentence is free
 * English and may legitimately contain `Word:`, which a naive key regex over the
 * raw body would read as an eleventh capability.
 *
 * Returns `{ line, keys }`, or `null` when the declaration is absent or its
 * object literal is unbalanced.
 */
export function parseHelpKeys(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]*)?=\\s*`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const stripped = stripComments(content);
  const strippedDecl = declRe.exec(stripped);
  if (!strippedDecl) return null;

  const openBrace = stripped.indexOf('{', strippedDecl.index + strippedDecl[0].length - 1);
  if (openBrace === -1) return null;

  const keys = [];
  let depth = 0;
  let pending = '';
  let closed = false;

  for (let i = openBrace; i < stripped.length; i += 1) {
    const ch = stripped[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      for (; j < stripped.length; j += 1) {
        if (stripped[j] === '\\') {
          j += 1;
          continue;
        }
        if (stripped[j] === quote) break;
      }
      // A quoted KEY is followed by a colon; a quoted VALUE is not.
      let k = j + 1;
      while (k < stripped.length && /\s/.test(stripped[k])) k += 1;
      pending = depth === 1 && stripped[k] === ':' ? stripped.slice(i + 1, j) : '';
      i = j;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        closed = true;
        break;
      }
      continue;
    }

    if (depth !== 1) continue;

    if (/[A-Za-z0-9_$]/.test(ch)) {
      pending += ch;
      continue;
    }
    if (ch === ':') {
      if (pending.length > 0) keys.push(pending);
      pending = '';
      continue;
    }
    if (ch === ',') {
      pending = '';
      continue;
    }
    if (!/\s/.test(ch)) pending = '';
  }

  if (!closed) return null;

  return { line: content.slice(0, declMatch.index).split('\n').length, keys };
}

/**
 * Parse the fenced markdown table into ordered capability names. A row counts
 * only when its first cell is a backticked identifier, which skips the header
 * and the `|---|` separator without knowing how many of either there are.
 *
 * Returns `{ line, values }`, or `null` when the fence is absent or unclosed.
 */
export function parseDocsCapabilities(content, fenceStart, fenceEnd) {
  const startIndex = content.indexOf(fenceStart);
  if (startIndex === -1) return null;
  const endIndex = content.indexOf(fenceEnd, startIndex);
  if (endIndex === -1) return null;

  const body = content.slice(startIndex + fenceStart.length, endIndex);

  const values = [];
  for (const raw of body.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.split('|').slice(1, -1);
    if (cells.length < 2) continue;
    const first = cells[0].trim();
    const code = /^`([A-Za-z][A-Za-z0-9]*)`$/.exec(first);
    if (!code) continue;
    values.push(code[1]);
  }

  return { line: content.slice(0, startIndex).split('\n').length, values };
}

/**
 * Pure differ over two ordered vocabularies. Returns `{ ok, issues }`; each
 * issue is one human-readable asymmetric difference.
 */
export function diffCapabilities(core, mirror, mirrorLabel) {
  const issues = [];

  const coreSet = new Set(core);
  const mirrorSet = new Set(mirror);

  const missingInMirror = core.filter((v) => !mirrorSet.has(v));
  const missingInCore = mirror.filter((v) => !coreSet.has(v));

  if (missingInMirror.length > 0) {
    issues.push(
      `present in core but MISSING from the ${mirrorLabel}: ${missingInMirror
        .map((v) => `'${v}'`)
        .join(', ')}`
    );
  }
  if (missingInCore.length > 0) {
    issues.push(
      `present in the ${mirrorLabel} but MISSING from core: ${missingInCore
        .map((v) => `'${v}'`)
        .join(', ')}`
    );
  }
  if (issues.length === 0 && core.join('|') !== mirror.join('|')) {
    issues.push(
      `same values but different order (core: ${core.join(', ')} / ${mirrorLabel}: ${mirror.join(', ')})`
    );
  }

  return { ok: issues.length === 0, issues };
}

async function main() {
  const [coreContent, feUnionContent, feHelpContent, docsContent] = await Promise.all([
    readFile(join(repoRoot, CORE_FILE), 'utf8'),
    readFile(join(repoRoot, FE_UNION_FILE), 'utf8'),
    readFile(join(repoRoot, FE_HELP_FILE), 'utf8'),
    readFile(join(repoRoot, DOCS_FILE), 'utf8'),
  ]);

  const fatal = [];
  const drifts = [];

  const core = parseCapabilityValues(coreContent, CORE_DECLARATION);
  if (!core || core.values.length === 0) {
    fatal.push(
      `${CORE_FILE}: no 'export const ${CORE_DECLARATION} = [...]' with string literals found`
    );
  }

  const feUnion = parseCapabilityValues(feUnionContent, FE_DECLARATION);
  if (!feUnion || feUnion.values.length === 0) {
    fatal.push(
      `${FE_UNION_FILE}: no 'export const ${FE_DECLARATION} = [...]' with string literals found`
    );
  }

  const help = parseHelpKeys(feHelpContent, HELP_DECLARATION);
  if (!help || help.keys.length === 0) {
    fatal.push(`${FE_HELP_FILE}: no '${HELP_DECLARATION} = { … }' object literal found`);
  }

  const docs = parseDocsCapabilities(docsContent, DOCS_FENCE_START, DOCS_FENCE_END);
  if (!docs || docs.values.length === 0) {
    fatal.push(
      `${DOCS_FILE}: no capability table found between ${DOCS_FENCE_START} and ${DOCS_FENCE_END}`
    );
  }

  if (fatal.length > 0) {
    console.error('✗ check-core-capability-mirror: could not locate every declaration.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error(`\n  docs: ${DOCS_REF}\n`);
    process.exit(1);
  }

  const mirrors = [
    {
      label: `${FE_UNION_FILE} ${FE_DECLARATION}`,
      values: feUnion.values,
      line: feUnion.line,
      file: FE_UNION_FILE,
      rule: `${FE_DECLARATION} must carry exactly the members of ${CORE_DECLARATION}, in the same order`,
    },
    {
      label: `${FE_HELP_FILE} ${HELP_DECLARATION}`,
      values: help.keys,
      line: help.line,
      file: FE_HELP_FILE,
      rule: `${HELP_DECLARATION} must carry exactly one entry per ${CORE_DECLARATION} member, in the same order`,
    },
    {
      label: `${DOCS_FILE} capability table`,
      values: docs.values,
      line: docs.line,
      file: DOCS_FILE,
      rule: `the fenced capability table must carry exactly one row per ${CORE_DECLARATION} member, in the same order`,
    },
  ];

  for (const mirror of mirrors) {
    const diff = diffCapabilities(core.values, mirror.values, mirror.label);
    if (!diff.ok) {
      drifts.push({
        rule: mirror.rule,
        locations: [
          `${CORE_FILE}:${core.line}  (authoritative)`,
          `${mirror.file}:${mirror.line}  (hand-maintained mirror)`,
        ],
        issues: diff.issues,
      });
    }
  }

  if (drifts.length === 0) {
    console.log(
      `✓ check-core-capability-mirror: ${core.values.length} core capability/-ies identical and ` +
        `in order across ${CORE_DECLARATION}, ${FE_DECLARATION}, ${HELP_DECLARATION} and the ` +
        `fenced table in ${DOCS_FILE}.`
    );
    process.exit(0);
  }

  console.error(`✗ check-core-capability-mirror: ${drifts.length} drifted mirror(s).\n`);
  for (const { rule, locations, issues } of drifts) {
    for (const location of locations) console.error(`    ${location}`);
    console.error(`      rule: ${rule}`);
    for (const issue of issues) console.error(`        - ${issue}`);
    console.error('');
  }
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure parsers + differ against synthetic inputs (no filesystem). */
function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  // --- parser: the `as const` array ------------------------------------------
  const arrayFile = (name, members) =>
    `/** header */\nexport const ${name} = [\n${members}\n] as const;\n`;
  const parsed = parseCapabilityValues(
    arrayFile(CORE_DECLARATION, "  'ProductMaster',\n  // 'Ghost'\n  'ReturnsAuthority',"),
    CORE_DECLARATION
  );
  expect(
    'parses members, skipping commented ones',
    parsed?.values.join(','),
    'ProductMaster,ReturnsAuthority'
  );
  expect('reports the declaration line', parsed?.line, 2);

  // Regression: a `]` inside an entry's comment must not truncate the parse.
  // Before #2403 this returned 'ProductMaster' only, and the resulting error
  // blamed every mirror for a value that core "lacked".
  expect(
    'is not truncated by a bracket inside a comment',
    parseCapabilityValues(
      arrayFile(
        CORE_DECLARATION,
        "  'ProductMaster',\n  // gated by DESCRIPTORS['fulfillment-execution']\n  'FulfillmentExecutor',"
      ),
      CORE_DECLARATION
    )?.values.join(','),
    'ProductMaster,FulfillmentExecutor'
  );

  // ...and an array that is genuinely never closed still returns null.
  expect(
    'unclosed array → null',
    parseCapabilityValues("export const " + CORE_DECLARATION + " = [\n  'ProductMaster',\n", CORE_DECLARATION),
    null
  );
  expect(
    'selects the requested declaration, not the first one',
    parseCapabilityValues(
      arrayFile('CORE_PLATFORM_TYPES', "  'allegro',") +
        arrayFile(FE_DECLARATION, "  'ProductMaster',"),
      FE_DECLARATION
    )?.values.join(','),
    'ProductMaster'
  );
  expect(
    'absent declaration → null',
    parseCapabilityValues('export const X = 1;', CORE_DECLARATION),
    null
  );
  expect(
    'declaration present but empty → zero values (a FATAL, never a pass)',
    parseCapabilityValues(arrayFile(CORE_DECLARATION, ''), CORE_DECLARATION)?.values.length,
    0
  );

  // --- parser: the help record -----------------------------------------------
  const helpSource =
    `export const ${HELP_DECLARATION}: Record<CoreCapability, string> = {\n` +
    "  ProductMaster:\n    'Read the catalog. Note: a sentence may contain Colons: like this.',\n" +
    "  Invoicing: 'Issue fiscal documents.',\n" +
    "  ReturnsAuthority:\n    'Decides what happens to returned goods.',\n" +
    '};\n';
  const help = parseHelpKeys(helpSource, HELP_DECLARATION);
  expect(
    'reads depth-1 keys in order',
    help?.keys.join(','),
    'ProductMaster,Invoicing,ReturnsAuthority'
  );
  expect('does NOT read a `Word:` inside a help sentence as a key', help?.keys.length, 3);
  expect(
    'absent help declaration → null',
    parseHelpKeys('const other = { a: 1 };', HELP_DECLARATION),
    null
  );
  expect(
    'unbalanced object literal → null',
    parseHelpKeys(`export const ${HELP_DECLARATION} = {\n  A: 'x',\n`, HELP_DECLARATION),
    null
  );

  // --- parser: the fenced markdown table --------------------------------------
  const docsSource =
    'intro\n\n' +
    `${DOCS_FENCE_START}\n\n` +
    '| Capability | What it does |\n' +
    '|---|---|\n' +
    '| `ProductMaster` | Source of truth for the catalog. |\n' +
    '| `Invoicing` | Issue fiscal documents. |\n' +
    '| `ReturnsAuthority` | Decide returns disposition. |\n\n' +
    `${DOCS_FENCE_END}\n` +
    '| `OutsideTheFence` | not ours |\n';
  const docs = parseDocsCapabilities(docsSource, DOCS_FENCE_START, DOCS_FENCE_END);
  expect(
    'parses fenced rows, skipping header and separator',
    docs?.values.join(','),
    'ProductMaster,Invoicing,ReturnsAuthority'
  );
  expect('ignores a table row outside the fence', docs?.values.includes('OutsideTheFence'), false);
  expect('reports the fence line', docs?.line, 3);
  expect(
    'absent fence → null',
    parseDocsCapabilities('no fence', DOCS_FENCE_START, DOCS_FENCE_END),
    null
  );
  expect(
    'unclosed fence → null',
    parseDocsCapabilities(
      `${DOCS_FENCE_START}\n| \`ProductMaster\` | x |\n`,
      DOCS_FENCE_START,
      DOCS_FENCE_END
    ),
    null
  );

  // --- differ: agreement and every drift shape --------------------------------
  const coreValues = ['ProductMaster', 'Invoicing', 'ReturnsAuthority'];
  expect('identical → ok', diffCapabilities(coreValues, [...coreValues], 'm').ok, true);

  const dropped = coreValues.filter((v) => v !== 'ReturnsAuthority');
  expect(
    'the new member missing from a mirror → not ok (the drift this script exists for)',
    diffCapabilities(coreValues, dropped, 'm').ok,
    false
  );
  expect(
    'a member added to a mirror only → not ok',
    diffCapabilities(dropped, coreValues, 'm').ok,
    false
  );
  expect(
    'reordered → not ok',
    diffCapabilities(coreValues, ['Invoicing', 'ProductMaster', 'ReturnsAuthority'], 'm').ok,
    false
  );

  // End-to-end drifted fixtures: each MUST fail through its own parser.
  expect(
    'a member missing from the FE union is caught',
    diffCapabilities(
      coreValues,
      parseCapabilityValues(
        arrayFile(FE_DECLARATION, "  'ProductMaster',\n  'Invoicing',"),
        FE_DECLARATION
      ).values,
      'fe'
    ).ok,
    false
  );
  expect(
    'a member missing from the help record is caught',
    diffCapabilities(
      coreValues,
      parseHelpKeys(
        helpSource.replace(
          "  ReturnsAuthority:\n    'Decides what happens to returned goods.',\n",
          ''
        ),
        HELP_DECLARATION
      ).keys,
      'help'
    ).ok,
    false
  );
  expect(
    'a member missing from the docs fence is caught',
    diffCapabilities(
      coreValues,
      parseDocsCapabilities(
        docsSource.replace('| `ReturnsAuthority` | Decide returns disposition. |\n', ''),
        DOCS_FENCE_START,
        DOCS_FENCE_END
      ).values,
      'docs'
    ).ok,
    false
  );

  if (failures.length > 0) {
    console.error('✗ check-core-capability-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-core-capability-mirror --self-check: parsers + differ behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-core-capability-mirror: fatal error:', err);
    process.exit(1);
  });
}
