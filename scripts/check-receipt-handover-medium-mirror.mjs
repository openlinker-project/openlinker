#!/usr/bin/env node
/**
 * check-receipt-handover-medium-mirror.mjs
 *
 * Lint-time invariant for the browser's hand-maintained copy of the fiscal
 * receipt HANDOVER vocabulary (#3647).
 *
 * The authoritative declaration is `FiscalHandoverMediumValues` in
 *   libs/core/src/fiscalization/domain/types/fiscalization.types.ts
 * and `selectHandoverArtefact` walks it in array order, so **the order is the
 * preference**: the first medium a receipt carries is the one the bench receipt
 * route serves. The browser cannot import core (#591), so
 *   apps/web/src/features/bench/lib/bench-sales-document.ts
 * re-declares it as `RECEIPT_HANDOVER_MEDIUMS`, and the receipt card picks what
 * to offer from that copy.
 *
 * Drift is operator-visible in both directions: a medium added only to core is
 * served by the route while the card says there is nothing to hand over; a
 * medium added only to the browser makes the card offer an "Open" the route
 * answers 404 to. A reorder makes the card offer one artefact while the route
 * serves another. So values AND order are compared.
 *
 * Both files are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * stays a zero-dependency `check:invariants` step like its siblings. Reading
 * ZERO values from either side is a failure, never a pass (#3303): a rename
 * that the parser no longer finds must not turn the guard green.
 *
 * Run with `--self-check` to exercise the pure parser + differ against
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
  'fiscalization',
  'domain',
  'types',
  'fiscalization.types.ts',
);
const FRONTEND_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'bench',
  'lib',
  'bench-sales-document.ts',
);

/** The `as const` array this script treats as authoritative, by name. */
const CORE_DECLARATION = 'FiscalHandoverMediumValues';
/** The browser mirror's own name for the same vocabulary. */
const FRONTEND_DECLARATION = 'RECEIPT_HANDOVER_MEDIUMS';

/**
 * Blank `//` and `/* ... *\/` comments to spaces (newlines preserved), so a
 * commented-out value or a `]` inside a comment is never read as source.
 * Length-preserving, so an index into the result is an index into the input.
 * Not string-literal aware: both inputs are repo-owned arrays of bare medium
 * names, which carry no `//` or `/*` inside a literal.
 */
function blankComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Extract the string literals of `[export] const <name> = [...]`, with the
 * 1-based line the declaration starts on. Returns `{ line, values }`, or `null`
 * when the declaration is absent or unterminated. `export` is optional because
 * the browser copy is module-private.
 */
export function parseMediumValues(content, name) {
  const blanked = blankComments(content);
  const declRe = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(blanked);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = blanked.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = blanked.slice(openBracket + 1, closeBracket);
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
 * Pure differ over two ordered vocabularies. Returns `{ ok, issues }`. A
 * reorder is a failure, because the order is the handover preference.
 */
export function diffMediumValues(core, mirror) {
  const issues = [];
  const coreSet = new Set(core);
  const mirrorSet = new Set(mirror);

  const missingInMirror = core.filter((v) => !mirrorSet.has(v));
  const missingInCore = mirror.filter((v) => !coreSet.has(v));

  if (missingInMirror.length > 0) {
    issues.push(
      `present in core but MISSING from the browser mirror: ${missingInMirror
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }
  if (missingInCore.length > 0) {
    issues.push(
      `present in the browser mirror but MISSING from core: ${missingInCore
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }
  if (issues.length === 0 && core.join('|') !== mirror.join('|')) {
    issues.push(
      `same values but DIFFERENT ORDER, and the order is the handover preference ` +
        `(core: ${core.join(', ')} / browser: ${mirror.join(', ')})`,
    );
  }

  return { ok: issues.length === 0, issues };
}

async function main() {
  const [coreContent, frontendContent] = await Promise.all([
    readFile(join(repoRoot, CORE_FILE), 'utf8'),
    readFile(join(repoRoot, FRONTEND_FILE), 'utf8'),
  ]);

  const fatal = [];
  const core = parseMediumValues(coreContent, CORE_DECLARATION);
  if (!core || core.values.length === 0) {
    fatal.push(`${CORE_FILE}: no 'export const ${CORE_DECLARATION} = [...]' with string literals found`);
  }
  const frontend = parseMediumValues(frontendContent, FRONTEND_DECLARATION);
  if (!frontend || frontend.values.length === 0) {
    fatal.push(`${FRONTEND_FILE}: no 'const ${FRONTEND_DECLARATION} = [...]' with string literals found`);
  }

  if (fatal.length > 0) {
    console.error('✗ check-receipt-handover-medium-mirror: could not read both declarations.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
  }

  const diff = diffMediumValues(core.values, frontend.values);
  if (diff.ok) {
    console.log(
      `✓ check-receipt-handover-medium-mirror: ${core.values.length} medium(s) identical and in ` +
        `preference order across ${CORE_FILE} and ${FRONTEND_FILE}.`,
    );
    process.exit(0);
  }

  console.error('✗ check-receipt-handover-medium-mirror: the browser mirror has drifted.\n');
  console.error(`    ${CORE_FILE}:${core.line}  (authoritative, ${CORE_DECLARATION})`);
  console.error(`    ${FRONTEND_FILE}:${frontend.line}  (hand-maintained mirror, ${FRONTEND_DECLARATION})`);
  for (const issue of diff.issues) console.error(`      - ${issue}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure parser + differ against synthetic inputs (no filesystem). */
function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  const exported = (name, entries) => `/** header */\nexport const ${name} = [${entries}] as const;\n`;
  const local = (name, entries) => `/** header */\nconst ${name} = [${entries}] as const;\n`;

  // --- parser ----------------------------------------------------------------
  const parsed = parseMediumValues(exported(CORE_DECLARATION, "'document', 'link'"), CORE_DECLARATION);
  expect('parses an exported declaration', parsed?.values.join(','), 'document,link');
  expect('reports the declaration line', parsed?.line, 2);
  expect(
    'parses a module-private declaration',
    parseMediumValues(local(FRONTEND_DECLARATION, "'document', 'link'"), FRONTEND_DECLARATION)?.values.join(','),
    'document,link',
  );
  expect(
    'reads double-quoted literals',
    parseMediumValues(local(FRONTEND_DECLARATION, '"document", "link"'), FRONTEND_DECLARATION)?.values.join(','),
    'document,link',
  );
  expect(
    'ignores a value in a line comment',
    parseMediumValues(
      exported(CORE_DECLARATION, "\n  'document',\n  // 'markup',\n  'link',\n"),
      CORE_DECLARATION,
    )?.values.join(','),
    'document,link',
  );
  expect(
    'ignores a value in a block comment',
    parseMediumValues(exported(CORE_DECLARATION, "'document', /* 'code', */ 'link'"), CORE_DECLARATION)?.values.join(','),
    'document,link',
  );
  expect(
    'a "]" inside a comment does not truncate the array',
    parseMediumValues(
      exported(CORE_DECLARATION, "\n  'document', // e.g. artefacts: []\n  'link',\n"),
      CORE_DECLARATION,
    )?.values.join(','),
    'document,link',
  );
  expect(
    'a declaration that is only mentioned in a comment is not read',
    parseMediumValues(`// const ${FRONTEND_DECLARATION} = ['ghost'];\n`, FRONTEND_DECLARATION),
    null,
  );
  expect(
    'selects the requested declaration, not the first one',
    parseMediumValues(exported('OtherValues', "'other'") + exported(CORE_DECLARATION, "'link'"), CORE_DECLARATION)?.values.join(','),
    'link',
  );
  expect('absent declaration → null (a FATAL)', parseMediumValues('export const X = 1;', CORE_DECLARATION), null);
  expect(
    'empty declaration → zero values (a FATAL, never a pass)',
    parseMediumValues(exported(CORE_DECLARATION, ''), CORE_DECLARATION)?.values.length,
    0,
  );

  // --- differ ----------------------------------------------------------------
  const base = ['document', 'link'];
  expect('identical vocabularies pass', diffMediumValues(base, [...base]).ok, true);
  expect('a medium missing from the mirror fails', diffMediumValues(base, ['document']).ok, false);
  expect('a medium only in the mirror fails', diffMediumValues(base, [...base, 'markup']).ok, false);
  expect('a REORDER fails, because the order is the preference', diffMediumValues(base, ['link', 'document']).ok, false);
  expect(
    'a reorder is reported as a reorder, not as a missing value',
    diffMediumValues(base, ['link', 'document']).issues[0]?.includes('DIFFERENT ORDER'),
    true,
  );

  if (failures.length > 0) {
    console.error('✗ check-receipt-handover-medium-mirror --self-check: parser/differ regressions.\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }

  console.log('✓ check-receipt-handover-medium-mirror --self-check: parser + differ behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  await main();
}
