#!/usr/bin/env node
/**
 * check-description-format-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the
 * `DescriptionFormat` contract (#2199, ADR-046).
 *
 * Rule. The property names of `DescriptionFormat` in
 *   libs/core/src/listings/domain/types/description-format.types.ts  (authoritative)
 * and
 *   apps/web/src/shared/ui/rich-text.types.ts                        (mirror)
 * MUST match, except for the fields the HTTP response adds on top of the domain
 * type (`FRONTEND_ONLY` below), which the frontend legitimately carries and core
 * does not. The `DescriptionFormatSourceValues` array must match exactly.
 *
 * Why a guard rather than a comment. The browser bundle does not depend on
 * `@openlinker/core`, so the FE cannot import the type - it is a copy, and a copy
 * drifts in both directions. Drift here is not cosmetic: the editor derives every
 * control it offers from these fields, so a field core starts honouring but the FE
 * never reads means the editor offers something the applier then strips, which is
 * precisely the failure ADR-046 exists to remove.
 *
 * SCOPE, so the wrong guard is not trusted: this compares NAMES, not types. A
 * field whose type diverges (say `string[]` vs `string`) passes here. What catches
 * that is the endpoint's response DTO plus `rich-text-profiles.test.ts`.
 *
 * Parsed TEXTUALLY (no transpile) so it stays a zero-dependency
 * `check:invariants` step like its siblings. Run with `--self-check` to exercise
 * the parser against synthetic input.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const BACKEND_FILE = join(
  'libs', 'core', 'src', 'listings', 'domain', 'types', 'description-format.types.ts',
);
const FRONTEND_FILE = join('apps', 'web', 'src', 'shared', 'ui', 'rich-text.types.ts');

/** Fields the HTTP response adds on top of the domain type. */
const FRONTEND_ONLY = ['declared', 'resolvedVia'];

const DOCS_REF = 'docs/architecture/adrs/046-adapter-declared-description-format.md';

/**
 * Top-level property names of `export interface <name> { … }`, in order.
 * Nested object literals are skipped by depth tracking, and comments are stripped
 * so an annotated field cannot be read as a property.
 */
export function parseInterfaceFields(content, name) {
  const declRe = new RegExp(`export\\s+interface\\s+${name}\\s*\\{`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const open = declMatch.index + declMatch[0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = open; i < content.length; i++) {
    if (content[i] === '{') depth += 1;
    else if (content[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  const body = content
    .slice(open + 1, end)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const fields = [];
  let nesting = 0;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (nesting === 0) {
      const m = /^(?:readonly\s+)?([A-Za-z_][\w]*)\s*\??\s*:/.exec(line);
      if (m) fields.push(m[1]);
    }
    nesting += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (nesting < 0) nesting = 0;
  }

  const line = content.slice(0, declMatch.index).split('\n').length;
  return { line, fields };
}

/** Literals of `export const <name> = [...] as const;`. */
export function parseConstArray(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const m = declRe.exec(content);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = content.indexOf(']', open);
  if (close === -1) return null;
  const body = content
    .slice(open + 1, close)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let lit;
  while ((lit = literalRe.exec(body)) !== null) values.push(lit[1] ?? lit[2]);
  return values;
}

/** Pure differ. `{ ok, issues }`. */
export function diffMirror(backend, frontend, frontendOnly) {
  const issues = [];
  if (backend === null) {
    issues.push(`DescriptionFormat not found in ${BACKEND_FILE}`);
    return { ok: false, issues };
  }
  if (frontend === null) {
    issues.push(`DescriptionFormat not found in ${FRONTEND_FILE}`);
    return { ok: false, issues };
  }

  const expected = [...backend.fields, ...frontendOnly].sort();
  const actual = [...frontend.fields].sort();

  for (const field of expected) {
    if (!actual.includes(field)) {
      issues.push(
        `\`${field}\` is in the core contract but missing from the frontend mirror ` +
          `(${FRONTEND_FILE}:${frontend.line}) — the editor cannot honour a field it does not read`,
      );
    }
  }
  for (const field of actual) {
    if (!expected.includes(field)) {
      issues.push(
        `\`${field}\` is in the frontend mirror (${FRONTEND_FILE}:${frontend.line}) but not in the ` +
          `core contract (${BACKEND_FILE}:${backend.line}) — the API will never send it`,
      );
    }
  }
  return { ok: issues.length === 0, issues };
}

function selfCheck() {
  const be = parseInterfaceFields(
    'export interface DescriptionFormat {\n  shape: string;\n  nested: { a: 1 };\n  maxBytes: number | null;\n}',
    'DescriptionFormat',
  );
  if (be === null || be.fields.join(',') !== 'shape,nested,maxBytes') {
    throw new Error(`parser regression: ${JSON.stringify(be)}`);
  }
  const drift = diffMirror({ line: 1, fields: ['a', 'b'] }, { line: 1, fields: ['a'] }, []);
  if (drift.ok) throw new Error('differ regression: missing field not reported');
  const clean = diffMirror({ line: 1, fields: ['a'] }, { line: 1, fields: ['a', 'declared'] }, [
    'declared',
  ]);
  if (!clean.ok) throw new Error(`differ regression: ${clean.issues.join('; ')}`);
  console.log('check-description-format-mirror: self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const backendSource = await readFile(join(repoRoot, BACKEND_FILE), 'utf8');
  const frontendSource = await readFile(join(repoRoot, FRONTEND_FILE), 'utf8');

  const { ok, issues } = diffMirror(
    parseInterfaceFields(backendSource, 'DescriptionFormat'),
    parseInterfaceFields(frontendSource, 'DescriptionFormat'),
    FRONTEND_ONLY,
  );

  const backendValues = parseConstArray(backendSource, 'DescriptionFormatSourceValues');
  const frontendValues = parseConstArray(frontendSource, 'DescriptionFormatSourceValues');
  if (backendValues !== null && frontendValues !== null) {
    if (backendValues.join('|') !== frontendValues.join('|')) {
      issues.push(
        `DescriptionFormatSourceValues differ: core [${backendValues.join(', ')}] vs frontend [${frontendValues.join(', ')}]`,
      );
    }
  }

  if (!ok || issues.length > 0) {
    console.error('check-description-format-mirror: FAILED\n');
    for (const issue of issues) console.error(`  - ${issue}`);
    console.error(`\nSee ${DOCS_REF}.`);
    process.exit(1);
  }
  console.log('check-description-format-mirror: frontend mirror matches the core contract');
}

await main();
