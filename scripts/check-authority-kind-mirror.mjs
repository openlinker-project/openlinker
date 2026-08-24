#!/usr/bin/env node
/**
 * check-authority-kind-mirror.mjs
 *
 * Lint-time invariant for the mirrors of the six independently assignable
 * fulfillment authorities (#2304 / #2311, ADR-052, ADR-053).
 *
 * The authoritative declaration is `AuthorityKindValues` in
 *   libs/core/src/fulfillment-authority/domain/types/authority-kind.types.ts
 * whose docblock already promises that this file is read TEXTUALLY: "one member
 * per line, no computed keys". This script is the enforcement of that promise.
 *
 * Three mirrors, one of which is not born yet.
 *
 * MIRROR 1 — `AUTHORITY_KIND_DESCRIPTORS`, same file. Its depth-1 keys must be
 *   exactly the six kinds, in the same order. The `Readonly<Record<AuthorityKind,
 *   …>>` type already makes a MISSING key a compile error; what it cannot catch
 *   is the ORDER, and the two declarations are read side-by-side when adding an
 *   authority. Three of the six keys are quoted and hyphenated
 *   (`'fulfillment-execution'`, `'order-lifecycle'`, `'returns-disposition'`)
 *   and every value is a nested `Object.freeze({…})`, so the key parser is
 *   depth-aware and accepts hyphens — a naive `[a-z_]+` scan would both drop
 *   half the kinds and misread the nested `capability` / `configKey` /
 *   `owningContext` lines as kinds of their own.
 *
 * MIRROR 2 — the authority table in `docs/capabilities.md`, between the
 *   `<!-- authority-kinds:start -->` / `:end` fence. The doc's whole value is
 *   the `capability` and `configKey` columns — the two strings a reader looks up
 *   and then greps for — so those are compared against the descriptor values,
 *   not just the kind column. The fence exists so the parser never has to guess
 *   which markdown table it owns.
 *
 * MIRROR 3 — the frontend authority label/help map: **PENDING, not skipped.**
 *   No file under `apps/web/src` mentions `AuthorityKind` today; W2-14 is the
 *   first FE consumer. The mirror is declared below with its owning wave, and
 *   while the file is absent this script prints one visible informational line
 *   and exits 0. A silent skip would let W2-14 land a drifted map under a green
 *   gate; the moment the file exists it is checked like any other mirror, with
 *   no edit to this script.
 *
 * Every file is parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * script stays a zero-dependency `check:invariants` step like its siblings.
 * Line and block comments are stripped before comparison.
 *
 * Run with `--self-check` to exercise the pure parsers + differ against
 * synthetic inputs (no filesystem), including deliberately drifted fixtures.
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const CORE_FILE = join(
  'libs',
  'core',
  'src',
  'fulfillment-authority',
  'domain',
  'types',
  'authority-kind.types.ts',
);
const DOCS_FILE = join('docs', 'capabilities.md');

/** The `as const` array this script treats as authoritative, by name. */
const KIND_DECLARATION = 'AuthorityKindValues';
/** The per-row `{capability, configKey, owningContext}` mapping beside it. */
const DESCRIPTORS_DECLARATION = 'AUTHORITY_KIND_DESCRIPTORS';

/** The HTML-comment fence delimiting the table this script owns. */
const DOCS_FENCE_START = '<!-- authority-kinds:start -->';
const DOCS_FENCE_END = '<!-- authority-kinds:end -->';

/**
 * Mirrors that do not exist yet. Declared rather than omitted so the gap is
 * visible on every run and the check activates by itself when the file lands.
 */
const PENDING_MIRRORS = [
  {
    file: join('apps', 'web', 'src', 'features', 'orders', 'lib', 'authority-kind.ts'),
    declaration: KIND_DECLARATION,
    pending: 'W2-14 (first frontend consumer of the authority vocabulary)',
  },
];

const DOCS_REF = 'docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md';

/** Strip line and block comments so an annotated entry can't be read as a value. */
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Extract the string literals of `export const <name> = [...] as const;`, with
 * the 1-based line number the declaration starts on. Returns `{ line, values }`,
 * or `null` when the declaration is absent.
 */
export function parseKindValues(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = content.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = stripComments(content.slice(openBracket + 1, closeBracket));

  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) {
    values.push(m[1] ?? m[2]);
  }

  const line = content.slice(0, declMatch.index).split('\n').length;
  return { line, values };
}

/**
 * Mask everything that is not a depth-1 character of an object literal: nested
 * braces (each descriptor's own `Object.freeze({…})`) and the contents of every
 * quoted or backticked string that is not itself a key. Masked characters become
 * spaces, so offsets survive and a key regex can run over the whole body without
 * misreading a nested `capability:` line or a string fragment as a top-level key.
 *
 * Returns `{ masked, endIndex }`, or `null` when the literal is unbalanced.
 */
export function maskObjectBody(content, openBrace) {
  const chars = content.split('');
  const masked = new Array(chars.length).fill(' ');
  let depth = 0;

  const endOfString = (start) => {
    const quote = chars[start];
    for (let j = start + 1; j < chars.length; j += 1) {
      if (chars[j] === '\\') {
        j += 1;
        continue;
      }
      if (chars[j] === quote) return j + 1;
    }
    return chars.length;
  };

  for (let i = openBrace; i < chars.length; i += 1) {
    const ch = chars[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      const end = endOfString(i);
      // A quoted KEY must survive masking; a quoted VALUE must not, or a
      // descriptor's own strings could be misread as kinds. What follows the
      // closing quote tells the two apart.
      let k = end;
      while (k < chars.length && /\s/.test(chars[k])) k += 1;
      if (depth === 1 && chars[k] === ':') {
        for (let j = i; j < end; j += 1) masked[j] = chars[j];
      }
      i = end - 1;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      if (depth === 1) masked[i] = ch;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { masked: masked.join(''), endIndex: i };
      continue;
    }

    if (depth === 1) masked[i] = ch;
  }

  return null;
}

/**
 * Ordered depth-1 entries of the object literal declared under `name`. Each
 * entry is `{ kind, capability, configKey, owningContext }`; the three fields
 * are read from the entry's own raw source segment and are `null` when absent.
 *
 * Returns `{ line, entries }`, or `null` when the declaration is absent or its
 * literal is unbalanced.
 */
export function parseDescriptorEntries(content, name) {
  const declRe = new RegExp(`${name}\\s*(?::[^=]*)?=\\s*`);
  if (!declRe.exec(content)) return null;

  const stripped = stripComments(content);
  const strippedDecl = declRe.exec(stripped);
  if (!strippedDecl) return null;
  const openBrace = stripped.indexOf('{', strippedDecl.index + strippedDecl[0].length - 1);
  if (openBrace === -1) return null;

  const maskedResult = maskObjectBody(stripped, openBrace);
  if (!maskedResult) return null;

  const body = maskedResult.masked.slice(openBrace + 1, maskedResult.endIndex);
  const rawBody = stripped.slice(openBrace + 1, maskedResult.endIndex);

  // Hyphens are load-bearing: three of six kinds carry one, and they are the
  // three that must be quoted because of it.
  const keyRe = /(?:^|[\s,])(?:'([a-z_-]+)'|"([a-z_-]+)"|([a-z_-]+))\s*:/gm;
  const kinds = [];
  const starts = [];
  let m;
  while ((m = keyRe.exec(body)) !== null) {
    kinds.push(m[1] ?? m[2] ?? m[3]);
    starts.push(m.index);
  }

  const field = (segment, fieldName) => {
    const fm = new RegExp(`${fieldName}\\s*:\\s*'([^']*)'|${fieldName}\\s*:\\s*"([^"]*)"`).exec(
      segment,
    );
    return fm ? (fm[1] ?? fm[2]) : null;
  };

  const entries = kinds.map((kind, i) => {
    const segment = rawBody.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : rawBody.length);
    return {
      kind,
      capability: field(segment, 'capability'),
      configKey: field(segment, 'configKey'),
      owningContext: field(segment, 'owningContext'),
    };
  });

  const declLine = content.slice(0, declRe.exec(content).index).split('\n').length;
  return { line: declLine, entries };
}

/**
 * Parse the fenced markdown table into ordered
 * `{ kind, capability, configKey, owningContext }` rows.
 *
 * A row counts only when its KIND cell is a backticked lowercase identifier,
 * which skips the header and the `|---|` separator without needing to know how
 * many of either there are. Later cells may carry inline code of their own.
 *
 * Returns `{ line, rows }`, or `null` when the fence is absent or unclosed.
 */
export function parseDocsRows(content, fenceStart, fenceEnd) {
  const startIndex = content.indexOf(fenceStart);
  if (startIndex === -1) return null;
  const endIndex = content.indexOf(fenceEnd, startIndex);
  if (endIndex === -1) return null;

  const line = content.slice(0, startIndex).split('\n').length;
  const body = content.slice(startIndex + fenceStart.length, endIndex);

  const cellText = (cell) => {
    const trimmed = (cell ?? '').trim();
    const code = /^`([^`]*)`$/.exec(trimmed);
    return code ? code[1] : trimmed;
  };

  const rows = [];
  for (const raw of body.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('|')) continue;
    // Leading and trailing pipes produce empty first/last cells; drop them.
    const cells = trimmed.split('|').slice(1, -1);
    if (cells.length < 5) continue;
    if (!/^`[a-z-]+`$/.test(cells[1].trim())) continue;
    rows.push({
      kind: cellText(cells[1]),
      capability: cellText(cells[2]),
      configKey: cellText(cells[3]),
      owningContext: cellText(cells[4]),
    });
  }

  return { line, rows };
}

/**
 * Pure differ over two ordered vocabularies. Returns `{ ok, issues }`; each
 * issue is one human-readable asymmetric difference.
 */
export function diffKindValues(core, mirror, mirrorLabel) {
  const issues = [];

  const coreSet = new Set(core);
  const mirrorSet = new Set(mirror);

  const missingInMirror = core.filter((v) => !mirrorSet.has(v));
  const missingInCore = mirror.filter((v) => !coreSet.has(v));

  if (missingInMirror.length > 0) {
    issues.push(
      `present in core but MISSING from the ${mirrorLabel}: ${missingInMirror
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }
  if (missingInCore.length > 0) {
    issues.push(
      `present in the ${mirrorLabel} but MISSING from core: ${missingInCore
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }
  if (issues.length === 0 && core.join('|') !== mirror.join('|')) {
    issues.push(
      `same values but different order (core: ${core.join(', ')} / ${mirrorLabel}: ${mirror.join(', ')})`,
    );
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Compare the per-kind `capability` / `configKey` / `owningContext` fields of
 * two aligned row sets. Assumes the kind vocabularies already agree; call only
 * once `diffKindValues` is `ok`, since a set difference is the better message.
 */
export function diffDescriptorFields(descriptors, rows, mirrorLabel) {
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  const issues = [];

  for (const descriptor of descriptors) {
    const row = byKind.get(descriptor.kind);
    if (!row) continue;
    for (const field of ['capability', 'configKey', 'owningContext']) {
      if (descriptor[field] !== row[field]) {
        issues.push(
          `'${descriptor.kind}'.${field}: core says '${descriptor[field]}', ` +
            `the ${mirrorLabel} says '${row[field]}'`,
        );
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function main() {
  const [coreContent, docsContent] = await Promise.all([
    readFile(join(repoRoot, CORE_FILE), 'utf8'),
    readFile(join(repoRoot, DOCS_FILE), 'utf8'),
  ]);

  const fatal = [];
  const drifts = [];

  const core = parseKindValues(coreContent, KIND_DECLARATION);
  if (!core || core.values.length === 0) {
    fatal.push(
      `${CORE_FILE}: no 'export const ${KIND_DECLARATION} = [...]' with string literals found`,
    );
  }

  const descriptors = parseDescriptorEntries(coreContent, DESCRIPTORS_DECLARATION);
  if (!descriptors || descriptors.entries.length === 0) {
    fatal.push(`${CORE_FILE}: no '${DESCRIPTORS_DECLARATION} = { … }' object literal found`);
  }

  const docs = parseDocsRows(docsContent, DOCS_FENCE_START, DOCS_FENCE_END);
  if (!docs || docs.rows.length === 0) {
    fatal.push(
      `${DOCS_FILE}: no authority table found between ${DOCS_FENCE_START} and ${DOCS_FENCE_END}`,
    );
  }

  if (fatal.length > 0) {
    console.error('✗ check-authority-kind-mirror: could not locate every declaration.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error(`\n  docs: ${DOCS_REF}\n`);
    process.exit(1);
  }

  // Mirror 1 — the descriptor keys beside the vocabulary.
  const descriptorKinds = descriptors.entries.map((e) => e.kind);
  const descriptorDiff = diffKindValues(core.values, descriptorKinds, DESCRIPTORS_DECLARATION);
  if (!descriptorDiff.ok) {
    drifts.push({
      rule: `${DESCRIPTORS_DECLARATION} must carry exactly one entry per ${KIND_DECLARATION} member, in the same order`,
      locations: [
        `${CORE_FILE}:${core.line}  (authoritative)`,
        `${CORE_FILE}:${descriptors.line}  (per-row mapping)`,
      ],
      issues: descriptorDiff.issues,
    });
  }

  // Mirror 2 — the fenced docs table: kinds, then the two columns that carry
  // the doc's whole value.
  const docsKinds = docs.rows.map((r) => r.kind);
  const docsDiff = diffKindValues(core.values, docsKinds, `${DOCS_FILE} authority table`);
  if (!docsDiff.ok) {
    drifts.push({
      rule: `the fenced authority table must carry exactly one row per ${KIND_DECLARATION} member, in the same order`,
      locations: [
        `${CORE_FILE}:${core.line}  (authoritative)`,
        `${DOCS_FILE}:${docs.line}  (hand-maintained table)`,
      ],
      issues: docsDiff.issues,
    });
  } else if (descriptorDiff.ok) {
    const fieldDiff = diffDescriptorFields(
      descriptors.entries,
      docs.rows,
      `${DOCS_FILE} authority table`,
    );
    if (!fieldDiff.ok) {
      drifts.push({
        rule: `each table row's capability / config key / owning context must equal its ${DESCRIPTORS_DECLARATION} entry`,
        locations: [
          `${CORE_FILE}:${descriptors.line}  (authoritative)`,
          `${DOCS_FILE}:${docs.line}  (hand-maintained table)`,
        ],
        issues: fieldDiff.issues,
      });
    }
  }

  // Mirror 3 — pending mirrors: checked if present, announced if not.
  const pendingNotes = [];
  for (const mirror of PENDING_MIRRORS) {
    const content = await readIfPresent(join(repoRoot, mirror.file));
    if (content === null) {
      // #2441 review S-6 — an absent mirror is a PASS, so without this a typo in
      // the declared path would be indistinguishable from a genuinely-pending
      // mirror, forever: the note would print the wrong path and CI would stay
      // green even after the real mirror shipped. Asserting the parent directory
      // exists catches the likely typo (a misspelt feature/lib segment) while
      // still allowing the file itself to be legitimately absent. The pending
      // entry must still be retired by hand when its issue lands — which is why
      // the note names that issue.
      const parent = dirname(join(repoRoot, mirror.file));
      const parentExists = await stat(parent).then(
        (s) => s.isDirectory(),
        () => false,
      );
      if (!parentExists) {
        drifts.push({
          rule: "a PENDING mirror's declared directory must exist (a typo here would pass forever)",
          locations: [`${mirror.file}  (declared mirror path, pending ${mirror.pending})`],
          issues: [
            `the parent directory '${dirname(mirror.file)}' does not exist, so this path can ` +
              'never resolve — fix the declared path, or remove the pending entry',
          ],
        });
        continue;
      }
      pendingNotes.push(`${mirror.file} — pending ${mirror.pending}`);
      continue;
    }
    const parsed = parseKindValues(content, mirror.declaration);
    if (!parsed || parsed.values.length === 0) {
      drifts.push({
        rule: `a declared PENDING mirror now exists and must export '${mirror.declaration}'`,
        locations: [`${mirror.file}  (mirror, ${mirror.pending})`],
        issues: [
          `the file exists but carries no 'export const ${mirror.declaration} = [...]' with ` +
            `string literals — either add it, or remove the file's PENDING_MIRRORS entry`,
        ],
      });
      continue;
    }
    const diff = diffKindValues(core.values, parsed.values, `${mirror.file} mirror`);
    if (!diff.ok) {
      drifts.push({
        rule: `${mirror.declaration} must be identical, in the same order, in core and this mirror`,
        locations: [
          `${CORE_FILE}:${core.line}  (authoritative)`,
          `${mirror.file}:${parsed.line}  (hand-maintained mirror)`,
        ],
        issues: diff.issues,
      });
    }
  }

  if (drifts.length === 0) {
    console.log(
      `✓ check-authority-kind-mirror: ${core.values.length} authority kind(s) identical and in ` +
        `order across ${KIND_DECLARATION}, ${DESCRIPTORS_DECLARATION} and the fenced table in ${DOCS_FILE}.`,
    );
    for (const note of pendingNotes) {
      console.log(`  pending mirror (declared, not yet present): ${note}`);
    }
    process.exit(0);
  }

  console.error(`✗ check-authority-kind-mirror: ${drifts.length} drifted mirror(s).\n`);
  for (const { rule, locations, issues } of drifts) {
    for (const location of locations) console.error(`    ${location}`);
    console.error(`      rule: ${rule}`);
    for (const issue of issues) console.error(`        - ${issue}`);
    console.error('');
  }
  for (const note of pendingNotes) {
    console.error(`    pending mirror (declared, not yet present): ${note}`);
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

  const name = KIND_DECLARATION;
  const file = (declName, entries) =>
    `/** header */\nexport const ${declName} = [\n${entries}\n] as const;\n`;

  // --- parser: the vocabulary array -------------------------------------------
  const parsed = parseKindValues(file(name, "  'availability',\n  'refund-trigger',"), name);
  expect('parses hyphenated literals', parsed?.values.join(','), 'availability,refund-trigger');
  expect('reports the declaration line', parsed?.line, 2);
  expect(
    'strips the per-member doc comments the real file carries',
    parseKindValues(
      file(name, "  /** A1 — 'ghost'. */\n  'availability',\n  // 'ghost2'\n  'sourcing',"),
      name,
    )?.values.join(','),
    'availability,sourcing',
  );
  expect(
    'selects the requested declaration, not the first one',
    parseKindValues(file('OtherValues', "  'other',") + file(name, "  'availability',"), name)
      ?.values.join(','),
    'availability',
  );
  expect('absent declaration → null', parseKindValues('export const X = 1;', name), null);
  expect(
    'declaration present but empty → zero values (a FATAL, never a pass)',
    parseKindValues(file(name, ''), name)?.values.length,
    0,
  );

  // --- parser: the nested, hyphen-keyed descriptor map ------------------------
  const descriptorSource =
    `export const ${DESCRIPTORS_DECLARATION}: Readonly<Record<AuthorityKind, D>> =\n` +
    '  Object.freeze({\n' +
    "    /** A1 — a comment mentioning 'ghost'. */\n" +
    '    availability: Object.freeze({\n' +
    "      capability: 'AvailabilityAuthority',\n" +
    "      configKey: 'availabilityAuthority',\n" +
    "      owningContext: 'inventory',\n" +
    '    }),\n' +
    "    'fulfillment-execution': Object.freeze({\n" +
    "      capability: 'FulfillmentExecutor',\n" +
    "      configKey: 'fulfillmentExecutor',\n" +
    "      owningContext: 'fulfillment',\n" +
    '    }),\n' +
    "    'refund-trigger': Object.freeze({\n" +
    "      capability: 'config-only',\n" +
    "      configKey: 'refundTrigger',\n" +
    "      owningContext: 'orders',\n" +
    '    }),\n' +
    '  });\n';
  const descriptors = parseDescriptorEntries(descriptorSource, DESCRIPTORS_DECLARATION);
  expect(
    'reads depth-1 keys only — hyphenated, quoted, nested Object.freeze',
    descriptors?.entries.map((e) => e.kind).join(','),
    'availability,fulfillment-execution,refund-trigger',
  );
  expect(
    'does NOT mistake a nested capability/configKey line for a kind',
    descriptors?.entries.length,
    3,
  );
  expect(
    'reads each entry own capability',
    descriptors?.entries.map((e) => e.capability).join(','),
    'AvailabilityAuthority,FulfillmentExecutor,config-only',
  );
  expect(
    'reads each entry own configKey',
    descriptors?.entries.map((e) => e.configKey).join(','),
    'availabilityAuthority,fulfillmentExecutor,refundTrigger',
  );
  expect(
    'reads each entry own owningContext',
    descriptors?.entries.map((e) => e.owningContext).join(','),
    'inventory,fulfillment,orders',
  );
  expect(
    'absent descriptor declaration → null',
    parseDescriptorEntries('const other = { a: 1 };', DESCRIPTORS_DECLARATION),
    null,
  );

  // --- parser: the fenced markdown table --------------------------------------
  const docsSource =
    'intro paragraph\n\n' +
    `${DOCS_FENCE_START}\n\n` +
    '| # | Kind | Capability | Config key | Owning context |\n' +
    '|---|---|---|---|---|\n' +
    '| A1 | `availability` | `AvailabilityAuthority` | `availabilityAuthority` | `inventory` |\n' +
    '| A3 | `fulfillment-execution` | `FulfillmentExecutor` | `fulfillmentExecutor` | `fulfillment` |\n' +
    '| A6 | `refund-trigger` | `config-only` | `refundTrigger` | `orders` |\n\n' +
    `${DOCS_FENCE_END}\n` +
    '| A9 | `outside-the-fence` | `x` | `y` | `z` |\n';
  const docs = parseDocsRows(docsSource, DOCS_FENCE_START, DOCS_FENCE_END);
  expect(
    'parses fenced rows, skipping header and separator',
    docs?.rows.map((r) => r.kind).join(','),
    'availability,fulfillment-execution,refund-trigger',
  );
  expect(
    'ignores a table row outside the fence',
    docs?.rows.some((r) => r.kind === 'outside-the-fence'),
    false,
  );
  expect(
    'unwraps inline code in later cells',
    docs?.rows.map((r) => `${r.capability}/${r.configKey}/${r.owningContext}`).join(','),
    'AvailabilityAuthority/availabilityAuthority/inventory,' +
      'FulfillmentExecutor/fulfillmentExecutor/fulfillment,' +
      'config-only/refundTrigger/orders',
  );
  expect('reports the fence line', docs?.line, 3);
  expect(
    'absent fence → null',
    parseDocsRows('no fence here', DOCS_FENCE_START, DOCS_FENCE_END),
    null,
  );
  expect(
    'unclosed fence → null',
    parseDocsRows(`${DOCS_FENCE_START}\n| A1 | \`x\` | \`a\` | \`b\` | \`c\` |\n`, DOCS_FENCE_START, DOCS_FENCE_END),
    null,
  );

  // --- differ: agreement and every drift shape --------------------------------
  const six = ['availability', 'sourcing', 'fulfillment-execution', 'refund-trigger'];
  expect('identical → ok', diffKindValues(six, [...six], 'm').ok, true);

  // Deliberately drifted fixtures: each MUST fail.
  const dropped = six.filter((v) => v !== 'sourcing');
  expect('kind removed from the mirror → not ok', diffKindValues(six, dropped, 'm').ok, false);
  expect('kind added to the mirror → not ok', diffKindValues(dropped, six, 'm').ok, false);
  expect(
    'reordered → not ok',
    diffKindValues(six, ['sourcing', 'availability', 'fulfillment-execution', 'refund-trigger'], 'm')
      .ok,
    false,
  );

  // A drifted docs TABLE, parsed end-to-end, must fail the same differ.
  const driftedDocs = parseDocsRows(
    docsSource.replace('| A3 | `fulfillment-execution`', '| A3 | `fulfilment-execution`'),
    DOCS_FENCE_START,
    DOCS_FENCE_END,
  );
  expect(
    'a typo in the docs table kind column is caught',
    diffKindValues(
      descriptors.entries.map((e) => e.kind),
      driftedDocs.rows.map((r) => r.kind),
      'docs',
    ).ok,
    false,
  );

  // A drifted docs FIELD (right kinds, wrong config key) must fail too — this is
  // the columns the doc exists for.
  const driftedFieldDocs = parseDocsRows(
    docsSource.replace('`refundTrigger`', '`refundTriggerAuthority`'),
    DOCS_FENCE_START,
    DOCS_FENCE_END,
  );
  expect(
    'right kinds but a wrong config key is caught',
    diffDescriptorFields(descriptors.entries, driftedFieldDocs.rows, 'docs').ok,
    false,
  );
  expect(
    'aligned fields → ok',
    diffDescriptorFields(descriptors.entries, docs.rows, 'docs').ok,
    true,
  );

  // --- pending mirrors are DECLARED, never silently absent --------------------
  expect('at least one pending mirror is declared', PENDING_MIRRORS.length > 0, true);
  expect(
    'every pending mirror names its owning wave',
    PENDING_MIRRORS.every((m) => typeof m.pending === 'string' && m.pending.length > 0),
    true,
  );

  if (failures.length > 0) {
    console.error('✗ check-authority-kind-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-authority-kind-mirror --self-check: parsers + differ behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  // Explicit fatal handler, matching the sibling mirror checks. A bare top-level
  // `await main()` surfaces a rename of any mirrored file as a raw
  // unhandled-rejection stack instead of one actionable line.
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-authority-kind-mirror: fatal error:', err);
    process.exit(1);
  });
}
