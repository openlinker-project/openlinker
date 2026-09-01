#!/usr/bin/env node
/**
 * check-sales-document-reason-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the
 * sales-document reason vocabularies (#2100, ADR-041 decision 11).
 *
 * Rule. `SalesDocumentGateBlockReasonValues` and
 * `SalesDocumentUnresolvedReasonValues` in
 *   libs/core/src/sales-documents/domain/types/sales-document-reason.types.ts  (backend, authoritative)
 * and
 *   apps/web/src/features/orders/api/orders.types.ts                            (frontend mirror)
 * MUST contain exactly the same string literals, in the same order.
 *
 * The FE file cannot import the core type (the browser bundle does not depend on
 * `@openlinker/core`), so the arrays are copies — and a copy drifts silently in
 * BOTH directions: a reason added only to core never reaches the browser at all,
 * and one added only to the FE type-checks against a value the API will never
 * send. A prose "keep in sync" comment is not enforcement; this is.
 *
 * SCOPE, so the wrong guard is not trusted: this script compares two ARRAYS. It
 * says nothing about whether `invoicingBlockedBadge` has a case for each value —
 * a reason added to BOTH arrays with no badge entry would pass here. Two other
 * guards close that: the `satisfies Record<SalesDocumentGateBlockReasonValue, …>`
 * on the badge table (a compile error), and the table-driven assertion in
 * `apps/web/src/features/orders/lib/order-row.test.ts` that every value yields a
 * hint.
 *
 * Both files are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * script stays a zero-dependency `check:invariants` step like its siblings.
 * Line and block comments inside either array are stripped before comparison.
 *
 * Run with `--self-check` to exercise the pure parser + differ against synthetic
 * inputs (no filesystem) — mirrors `check-permission-mirror.mjs`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const BACKEND_FILE = join(
  'libs',
  'core',
  'src',
  'sales-documents',
  'domain',
  'types',
  'sales-document-reason.types.ts',
);
const FRONTEND_FILE = join('apps', 'web', 'src', 'features', 'orders', 'api', 'orders.types.ts');
const COPY_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'sales-documents',
  'lib',
  'sales-document-reason-copy.ts',
);

/** The two `as const` arrays this script keeps aligned. */
const MIRRORED_DECLARATIONS = [
  'SalesDocumentGateBlockReasonValues',
  'SalesDocumentUnresolvedReasonValues',
];

/**
 * The copy map that must carry one entry per reason (#2534), keyed by the union
 * whose values it covers. Membership only - the `satisfies Record<…>` in the
 * copy file is what enforces it against the FRONTEND type, and this check is
 * what enforces it against the BACKEND union, which the type system cannot see.
 */
const COPY_DECLARATIONS = {
  SalesDocumentGateBlockReasonValues: 'SALES_DOCUMENT_GATE_REASON_COPY',
  SalesDocumentUnresolvedReasonValues: 'SALES_DOCUMENT_UNRESOLVED_REASON_COPY',
};

const DOCS_REF = 'docs/architecture/adrs/041-sales-document-routing-policy.md';

/**
 * Extract the string literals of `export const <name> = [...] as const;`, with
 * the 1-based line number the declaration starts on. Returns `{ line, values }`,
 * or `null` when the declaration is absent.
 */
export function parseReasonValues(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = content.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = content
    .slice(openBracket + 1, closeBracket)
    // Strip comments so annotating an entry can't be read as a value.
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

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
 * Extract the TOP-LEVEL keys of `export const <name> = { ... } satisfies ...;`.
 *
 * Brace-matched rather than regex-scanned, because a copy entry is itself an
 * object and a nested key must not be read as a reason id. String bodies are
 * skipped so a brace or a quote inside operator copy cannot end the scan early.
 * Returns `{ line, keys }`, or `null` when the declaration is absent.
 */
export function parseCopyKeys(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\{`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const open = declMatch.index + declMatch[0].length - 1;
  const keys = [];
  let depth = 0;
  let quote = null;
  let pendingKey = null;

  for (let i = open; i < content.length; i += 1) {
    const ch = content[i];

    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '/' && content[i + 1] === '/') {
      i = content.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const end = findStringEnd(content, i);
      if (end === -1) break;
      if (depth === 1) pendingKey = content.slice(i + 1, end);
      i = end;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }

    if (ch === ':' && depth === 1 && pendingKey !== null) {
      keys.push(pendingKey);
      pendingKey = null;
      continue;
    }
    if (ch === ',' && depth === 1) {
      pendingKey = null;
    }
  }

  const line = content.slice(0, declMatch.index).split('\n').length;
  return { line, keys };
}

/** Index of the closing quote of the string literal starting at `start`. */
function findStringEnd(content, start) {
  const quote = content[start];
  for (let i = start + 1; i < content.length; i += 1) {
    if (content[i] === '\\') {
      i += 1;
      continue;
    }
    if (content[i] === quote) return i;
  }
  return -1;
}

/**
 * Pure differ. Returns `{ ok, issues }` where each issue is a human-readable
 * reason string describing one asymmetric difference.
 */
export function diffReasonValues(backend, frontend) {
  const issues = [];

  const backendSet = new Set(backend);
  const frontendSet = new Set(frontend);

  const missingInFrontend = backend.filter((v) => !frontendSet.has(v));
  const missingInBackend = frontend.filter((v) => !backendSet.has(v));

  if (missingInFrontend.length > 0) {
    issues.push(
      `present in the backend but MISSING from the frontend mirror: ${missingInFrontend
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }
  if (missingInBackend.length > 0) {
    issues.push(
      `present in the frontend mirror but MISSING from the backend: ${missingInBackend
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }
  if (issues.length === 0 && backend.join('|') !== frontend.join('|')) {
    // Same membership, different order. Not a functional break today, but the
    // files are read side-by-side when adding a reason - keep them aligned.
    issues.push(
      `same values but different order (backend: ${backend.join(', ')} / frontend: ${frontend.join(', ')})`,
    );
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Pure coverage check. Returns a list of human-readable issues describing which
 * reasons have no copy entry, and which entries describe a reason that no longer
 * exists.
 */
export function diffCopyCoverage(reasons, copyKeys) {
  const issues = [];
  const keySet = new Set(copyKeys);
  const reasonSet = new Set(reasons);

  const missing = reasons.filter((r) => !keySet.has(r));
  const extra = copyKeys.filter((k) => !reasonSet.has(k));

  if (missing.length > 0) {
    issues.push(`no copy entry for: ${missing.map((v) => `'${v}'`).join(', ')}`);
  }
  if (extra.length > 0) {
    issues.push(
      `copy entry for a reason that does not exist: ${extra.map((v) => `'${v}'`).join(', ')}`,
    );
  }

  return issues;
}

async function main() {
  const [backendContent, frontendContent, copyContent] = await Promise.all([
    readFile(join(repoRoot, BACKEND_FILE), 'utf8'),
    readFile(join(repoRoot, FRONTEND_FILE), 'utf8'),
    readFile(join(repoRoot, COPY_FILE), 'utf8'),
  ]);

  const fatal = [];
  const drifts = [];
  const copyDrifts = [];
  let compared = 0;

  for (const name of MIRRORED_DECLARATIONS) {
    const backend = parseReasonValues(backendContent, name);
    const frontend = parseReasonValues(frontendContent, name);

    if (!backend) {
      fatal.push(`${BACKEND_FILE}: no 'export const ${name} = [...]' found`);
      continue;
    }
    if (!frontend) {
      fatal.push(`${FRONTEND_FILE}: no 'export const ${name} = [...]' found`);
      continue;
    }

    const { ok, issues } = diffReasonValues(backend.values, frontend.values);
    compared += backend.values.length;
    if (!ok) {
      drifts.push({ name, backend, frontend, issues });
    }

    // #2534 - a reason with no operator-facing copy renders as nothing at all,
    // which is the silent decline ADR-041 §54 forbids. Membership only: order is
    // irrelevant for a map, and the copy file's own `satisfies Record<…>` covers
    // the frontend type.
    const copyName = COPY_DECLARATIONS[name];
    const copy = parseCopyKeys(copyContent, copyName);
    if (!copy) {
      fatal.push(`${COPY_FILE}: no 'export const ${copyName} = {...}' found`);
      continue;
    }
    const copyIssues = diffCopyCoverage(backend.values, copy.keys);
    if (copyIssues.length > 0) {
      copyDrifts.push({ name: copyName, backend, copy, issues: copyIssues });
    }
  }

  if (fatal.length > 0) {
    console.error('✗ check-sales-document-reason-mirror: could not locate every declaration.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
  }

  if (drifts.length === 0 && copyDrifts.length === 0) {
    console.log(
      `✓ check-sales-document-reason-mirror: ${compared} reason value(s) across ` +
        `${MIRRORED_DECLARATIONS.length} union(s) identical in ${BACKEND_FILE} and ${FRONTEND_FILE}, ` +
        `each with operator-facing copy in ${COPY_FILE}.`,
    );
    process.exit(0);
  }

  if (copyDrifts.length > 0) {
    console.error(
      `✗ check-sales-document-reason-mirror: ${copyDrifts.length} copy map(s) out of step.\n`,
    );
    for (const { name, backend, copy, issues } of copyDrifts) {
      console.error(`  ${name}`);
      console.error(`    ${BACKEND_FILE}:${backend.line}  (authoritative)`);
      console.error(`    ${COPY_FILE}:${copy.line}  (operator-facing copy)`);
      for (const issue of issues) {
        console.error(`      rule: every reason needs one copy entry - ${issue}`);
      }
    }
    console.error('');
  }

  if (drifts.length === 0) {
    console.error(`    docs: ${DOCS_REF}`);
    console.error('');
    process.exit(1);
  }

  console.error(`✗ check-sales-document-reason-mirror: ${drifts.length} drifted union(s).\n`);
  for (const { name, backend, frontend, issues } of drifts) {
    console.error(`  ${name}`);
    console.error(`    ${BACKEND_FILE}:${backend.line}  (authoritative)`);
    console.error(`    ${FRONTEND_FILE}:${frontend.line}  (hand-maintained mirror)`);
    for (const issue of issues) {
      console.error(`      rule: ${name} must be identical in both files - ${issue}`);
    }
  }
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure parser + differ against synthetic inputs (no filesystem). */
function selfCheck() {
  const file = (name, entries) =>
    `/** header */\nexport const ${name} = [\n${entries}\n] as const;\n` +
    `\nexport type X = (typeof ${name})[number];\n`;

  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  const name = 'SalesDocumentGateBlockReasonValues';

  const parsed = parseReasonValues(file(name, "  'a-x',\n  'b-y',"), name);
  expect('parses two literals', parsed?.values.join(','), 'a-x,b-y');
  expect('reports the declaration line', parsed?.line, 2);

  const commented = parseReasonValues(
    file(name, "  'a-x',\n  // never written: 'ghost-value'\n  'b-y',"),
    name,
  );
  expect('strips line comments', commented?.values.join(','), 'a-x,b-y');

  const blockCommented = parseReasonValues(file(name, "  'a-x',\n  /* 'ghost' */\n  'b-y',"), name);
  expect('strips block comments', blockCommented?.values.join(','), 'a-x,b-y');

  // The two unions live in the same file, so the parser must key on the NAME and
  // not simply grab the first `as const` array it finds.
  const twoUnions =
    file('SalesDocumentGateBlockReasonValues', "  'gate-1',") +
    file('SalesDocumentUnresolvedReasonValues', "  'unresolved-1',");
  expect(
    'selects the requested declaration, not the first one',
    parseReasonValues(twoUnions, 'SalesDocumentUnresolvedReasonValues')?.values.join(','),
    'unresolved-1',
  );

  expect('absent declaration → null', parseReasonValues('export const Other = [];', name), null);

  expect('identical arrays → ok', diffReasonValues(['a', 'b'], ['a', 'b']).ok, true);
  expect('missing in frontend → not ok', diffReasonValues(['a', 'b'], ['a']).ok, false);
  expect('missing in backend → not ok', diffReasonValues(['a'], ['a', 'b']).ok, false);
  expect('reordered → not ok', diffReasonValues(['a', 'b'], ['b', 'a']).ok, false);

  const copyFile =
    `export const SALES_DOCUMENT_GATE_REASON_COPY = {\n` +
    `  'a-x': { short: 'A', detail: 'One, two: three. {not a brace}' },\n` +
    `  // 'ghost-value': never written\n` +
    `  'b-y': { short: 'B', detail: "It's fine", tone: 'error' },\n` +
    `} satisfies Record<X, Y>;\n`;
  expect(
    'reads only top-level copy keys',
    parseCopyKeys(copyFile, 'SALES_DOCUMENT_GATE_REASON_COPY')?.keys.join(','),
    'a-x,b-y',
  );
  expect(
    'absent copy declaration → null',
    parseCopyKeys('export const Other = {};', 'SALES_DOCUMENT_GATE_REASON_COPY'),
    null,
  );
  expect('full copy coverage → no issues', diffCopyCoverage(['a', 'b'], ['b', 'a']).length, 0);
  expect('missing copy entry → issue', diffCopyCoverage(['a', 'b'], ['a']).length, 1);
  expect('stale copy entry → issue', diffCopyCoverage(['a'], ['a', 'b']).length, 1);

  if (failures.length > 0) {
    console.error('✗ check-sales-document-reason-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-sales-document-reason-mirror --self-check: parser + differ behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  // Explicit fatal handler, matching `check-permission-mirror.mjs`. A bare
  // top-level `await main()` surfaces a rename of either mirrored file as a raw
  // unhandled-rejection stack instead of one actionable line.
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-sales-document-reason-mirror: fatal error:', err);
    process.exit(1);
  });
}
