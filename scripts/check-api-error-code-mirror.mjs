#!/usr/bin/env node
/**
 * check-api-error-code-mirror (#3862)
 *
 * The API names every error with a stable code from `ApiErrorCodeValues`
 * (`libs/shared/src/errors/api-error-code.types.ts`). The browser bundle
 * cannot import that file (#591), so `apps/web/src/shared/api/api-error-codes.ts`
 * mirrors it, and every code needs its copy in the English `errors` namespace
 * (`apps/web/src/locales/en/errors.json`, key `codes`, ADR-081). Three rules:
 *
 *   A. the frontend list equals the backend list, in value and order;
 *   B. every code has a non-empty English `errors.codes.<code>`;
 *   C. `errors.codes` names no code that is not registered (a stale key would
 *      be copy for an error that can no longer happen).
 *
 * Polish gaps are `check-locales`'s job, which already compares every
 * language with English.
 *
 * A guard that passes because it matched nothing is a failure here: an empty
 * list on either side, or a missing file, is fatal.
 *
 *   node scripts/check-api-error-code-mirror.mjs              (check)
 *   node scripts/check-api-error-code-mirror.mjs --self-check (check the checker)
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const BACKEND_FILE = join('libs', 'shared', 'src', 'errors', 'api-error-code.types.ts');
const FRONTEND_FILE = join('apps', 'web', 'src', 'shared', 'api', 'api-error-codes.ts');
const ENGLISH_FILE = join('apps', 'web', 'src', 'locales', 'en', 'errors.json');
const DECLARATION = 'ApiErrorCodeValues';

/** Replaces comments with spaces, so a bracket or quote inside one is not read as code. */
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

/** The string members of `export const <name> = [ ... ]`, or null when absent. */
export function parseCodeValues(content, name = DECLARATION) {
  const blanked = blankComments(content);
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(blanked);
  if (!declMatch) return null;
  const open = declMatch.index + declMatch[0].length - 1;
  const close = blanked.indexOf(']', open);
  if (close === -1) return null;
  return [...blanked.slice(open + 1, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Every rule violation, as readable lines. Empty when the three agree. */
export function findMirrorIssues(backend, frontend, englishCodes) {
  const issues = [];
  if (backend.length === 0) issues.push(`${BACKEND_FILE}: ${DECLARATION} is empty`);
  if (frontend.length === 0) issues.push(`${FRONTEND_FILE}: ${DECLARATION} is empty`);

  const length = Math.max(backend.length, frontend.length);
  for (let i = 0; i < length; i += 1) {
    if (backend[i] !== frontend[i]) {
      issues.push(
        `A: position ${i}: backend '${backend[i] ?? '(none)'}' but frontend '${frontend[i] ?? '(none)'}'`
      );
      break;
    }
  }

  const copy = englishCodes ?? {};
  for (const code of backend) {
    const text = copy[code];
    if (typeof text !== 'string' || text.trim().length === 0) {
      issues.push(`B: no English copy for '${code}' in errors.codes`);
    }
  }

  const registered = new Set(backend);
  for (const code of Object.keys(copy)) {
    if (!registered.has(code)) issues.push(`C: errors.codes names unregistered code '${code}'`);
  }
  return issues;
}

function selfCheck() {
  const source = `/** ['NOT_A_CODE'] */\nexport const ${DECLARATION} = [\n  // 'ALSO_NOT',\n  'A',\n  'b-c',\n] as const;`;
  const parsed = parseCodeValues(source);
  const failures = [];
  if (JSON.stringify(parsed) !== JSON.stringify(['A', 'b-c'])) {
    failures.push(`parser read ${JSON.stringify(parsed)}`);
  }
  if (findMirrorIssues(['A', 'B'], ['A', 'B'], { A: 'a', B: 'b' }).length !== 0) {
    failures.push('agreeing lists reported issues');
  }
  if (!findMirrorIssues(['A', 'B'], ['B', 'A'], { A: 'a', B: 'b' }).some((l) => l.startsWith('A:'))) {
    failures.push('order drift not reported');
  }
  if (!findMirrorIssues(['A', 'B'], ['A', 'B'], { A: 'a' }).some((l) => l.startsWith('B:'))) {
    failures.push('missing copy not reported');
  }
  if (!findMirrorIssues(['A'], ['A'], { A: 'a', Z: 'z' }).some((l) => l.startsWith('C:'))) {
    failures.push('stale copy not reported');
  }
  if (findMirrorIssues([], [], {}).length === 0) failures.push('empty lists passed');
  if (failures.length > 0) {
    console.error(`✗ check-api-error-code-mirror --self-check:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('✓ check-api-error-code-mirror --self-check: the checker behaves.');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }
  const [backendSource, frontendSource, englishSource] = await Promise.all(
    [BACKEND_FILE, FRONTEND_FILE, ENGLISH_FILE].map((rel) => readFile(join(repoRoot, rel), 'utf8'))
  );
  const backend = parseCodeValues(backendSource);
  const frontend = parseCodeValues(frontendSource);
  if (backend === null || frontend === null) {
    console.error(
      `✗ check-api-error-code-mirror: ${DECLARATION} not found in ${backend === null ? BACKEND_FILE : FRONTEND_FILE}.`
    );
    process.exit(1);
  }
  const englishCodes = JSON.parse(englishSource).codes;
  const issues = findMirrorIssues(backend, frontend, englishCodes);
  if (issues.length > 0) {
    console.error(
      `✗ check-api-error-code-mirror: ${issues.length} issue(s).\n  ${issues.join('\n  ')}\n\n` +
        `  Add a code to ${BACKEND_FILE} first, then to ${FRONTEND_FILE}, then its copy to\n` +
        `  codes in ${ENGLISH_FILE} and locales/pl/errors.json.`
    );
    process.exit(1);
  }
  console.log(`✓ check-api-error-code-mirror: ${backend.length} codes mirrored, each with English copy.`);
}

await main();
