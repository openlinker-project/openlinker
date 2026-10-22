#!/usr/bin/env node
/**
 * check-provider-name-boundary
 *
 * `apps/web` is meant to hold no provider knowledge outside
 * `apps/web/src/plugins/<provider>/` (#3272). Provider names that reach
 * operator-facing copy from shared code are the visible symptom: the next
 * provider added would leak the same way, so the boundary is enforced here
 * rather than by review.
 *
 * Bans `eparagony`, `ksef`, `paragon` and `kasa` (case-insensitive, whole
 * word) from operator-facing copy in `apps/web/src/**` outside
 * `apps/web/src/plugins/`.
 *
 * ---------------------------------------------------------------------------
 * SCOPE - operator-facing copy only, the scope `check-ui-vocabulary.mjs`
 * already defines and for its stated reason: JSX text, user-facing JSX
 * attribute values in `.tsx`, and every string literal in a `*-copy.ts` /
 * `*.copy.ts` module. Identifiers, comments, imports and non-user-facing props
 * are deliberately unscanned: several shared components mention KSeF in
 * docblocks explaining why the component is neutral
 * (`features/orders/lib/sales-document-cell-state.ts` documents "Authority
 * rejected", not "KSeF rejected"), and a guard that scanned comments would
 * forbid stating the rule it enforces.
 *
 * Test files (`*.test.ts(x)`) are not copy and are skipped.
 *
 * WHAT THIS DOES NOT CATCH. Literal strings only: a name assembled at runtime,
 * or copy the API returns and the UI renders verbatim, is out of reach. A name
 * in `.ts` that is not a copy module is out of reach too.
 *
 * ---------------------------------------------------------------------------
 * "MATCHED NOTHING" - a guard that passes because it matched nothing is the
 * failure this repo has already been bitten by:
 *
 *   Z1  the scan root does not exist       -> FATAL
 *   Z2  the scan root yields zero files    -> FATAL
 *   Z3  an exemption names a missing file  -> FATAL (a typo'd exemption
 *       suppresses nothing while its author believes it does)
 *
 * EXEMPTIONS is empty and must stay empty: an exemption that is unavoidable is
 * a sign a surface is in the wrong folder.
 *
 * Every file is parsed TEXTUALLY (no TypeScript import) so this stays a
 * zero-dependency `check:invariants` step like its siblings.
 *
 * Usage:
 *   node scripts/check-provider-name-boundary.mjs
 *   node scripts/check-provider-name-boundary.mjs --self-check
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const SCAN_ROOT = join('apps', 'web', 'src');
const PLUGINS_DIR = join('apps', 'web', 'src', 'plugins');

/** Closed list. Case-insensitive, whole word. */
export const BANNED_PROVIDER_TERMS = ['eparagony', 'ksef', 'paragon', 'kasa'];

/** Files permitted to contain a banned term, by file with a reason. Keep empty. */
const EXEMPTIONS = new Map();

/** JSX attributes whose string value is rendered to an operator. */
const USER_FACING_ATTRIBUTES = new Set([
  'title',
  'label',
  'aria-label',
  'placeholder',
  'alt',
  'description',
  'heading',
  'caption',
  'hint',
  'emptyMessage',
  'errorMessage',
  'confirmLabel',
  'cancelLabel',
  'tooltip',
  'summary',
  'helperText',
]);

// ---------------------------------------------------------------------------
// Pure parsers + matchers (exported for --self-check)
// ---------------------------------------------------------------------------

/**
 * Blank comment bodies, keeping newlines so `file:line` stays truthful, and
 * skipping string/template literals so `'https://x.com/ksef'` is not read as a
 * `//` comment (which would silently lose the string from the scan).
 */
export function stripComments(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      for (let j = i + 1; j < source.length; j += 1) {
        if (source[j] === '\\') {
          j += 1;
          continue;
        }
        if (ch !== '`' && source[j] === '\n') {
          i = j - 1;
          break;
        }
        if (source[j] === ch) {
          i = j;
          break;
        }
        if (j === source.length - 1) i = j;
      }
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
      blank(i, end);
      i = end - 1;
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      let end = source.indexOf('*/', i + 2);
      end = end === -1 ? source.length : end + 2;
      blank(i, end);
      i = end - 1;
    }
  }

  return out.join('');
}

/** JSX text and user-facing attribute values, each with its 1-based line. */
export function extractTsxStrings(source) {
  const content = stripComments(source);
  const out = [];

  const textRe = />([^<>{}]+)</g;
  let m;
  while ((m = textRe.exec(content)) !== null) {
    const text = m[1].replace(/\s+/g, ' ').trim();
    if (!text || !/[A-Za-z]/.test(text)) continue;
    out.push({ text, line: content.slice(0, m.index).split('\n').length });
  }

  const attrRe = /([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  while ((m = attrRe.exec(content)) !== null) {
    if (!USER_FACING_ATTRIBUTES.has(m[1])) continue;
    const text = (m[2] ?? m[3] ?? '').trim();
    if (!text) continue;
    out.push({ text, line: content.slice(0, m.index).split('\n').length });
  }

  return out;
}

/** Every string literal in a copy module (static chunks of templates included). */
export function extractCopyStrings(source) {
  const content = stripComments(source);
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\s+/g, ' ').trim();
    if (!text || !/[A-Za-z]/.test(text)) continue;
    out.push({ text, line: content.slice(0, m.index).split('\n').length });
  }
  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The banned provider term found in `text`, or null. */
export function matchProviderTerm(text, terms = BANNED_PROVIDER_TERMS) {
  for (const term of terms) {
    if (new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text)) return term;
  }
  return null;
}

const COPY_MODULE = /(?:^|[.\-])copy\.ts$/;

function isTestFile(path) {
  return /\.test\.tsx?$/.test(path);
}

function isCopyModule(path) {
  return !isTestFile(path) && COPY_MODULE.test(path);
}

export function isScannable(path) {
  return !isTestFile(path) && (path.endsWith('.tsx') || isCopyModule(path));
}

/** Is `relPath` (repo-relative) inside the plugins folder, where names are allowed? */
export function isInsidePlugins(relPath) {
  return relPath === PLUGINS_DIR || relPath.startsWith(PLUGINS_DIR + sep);
}

export function findViolations(path, source) {
  const strings = isCopyModule(path) ? extractCopyStrings(source) : extractTsxStrings(source);
  const hits = [];
  for (const { text, line } of strings) {
    const term = matchProviderTerm(text);
    if (term) hits.push({ term, line, text });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      await walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const exists = (path) =>
  stat(path).then(
    () => true,
    () => false
  );

async function main() {
  const root = join(repoRoot, SCAN_ROOT);
  if (!(await exists(root))) {
    console.error(`✗ check-provider-name-boundary: scan root ${SCAN_ROOT} does not exist (Z1).`);
    process.exit(1);
  }

  const all = await walk(root);
  const files = all.filter((f) => isScannable(f) && !isInsidePlugins(relative(repoRoot, f)));
  if (files.length === 0) {
    console.error(`✗ check-provider-name-boundary: ${SCAN_ROOT} yielded zero scannable files (Z2).`);
    process.exit(1);
  }

  const problems = [];
  for (const [file, reason] of EXEMPTIONS) {
    if (!(await exists(join(repoRoot, file)))) {
      problems.push(`${file}: exemption names a file that does not exist (${reason}) (Z3).`);
    }
  }

  for (const file of files) {
    const rel = relative(repoRoot, file);
    if (EXEMPTIONS.has(rel)) continue;
    const hits = findViolations(file, await readFile(file, 'utf8'));
    for (const hit of hits) {
      problems.push(
        `${rel}:${hit.line}: operator-facing copy names the provider "${hit.term}": ${JSON.stringify(hit.text)}`
      );
    }
  }

  if (problems.length > 0) {
    console.error('✗ check-provider-name-boundary failed (#3272):\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      '\nProvider names belong under apps/web/src/plugins/<provider>/. Move the surface into its ' +
        'plugin folder, or make the copy provider-neutral. Do not add an exemption.'
    );
    process.exit(1);
  }
  console.log(`✓ check-provider-name-boundary: ${files.length} file(s) scanned, no provider names in shared copy.`);
}

// ---------------------------------------------------------------------------
// --self-check
// ---------------------------------------------------------------------------

function selfCheck() {
  const failures = [];
  const eq = (label, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`  ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  // Matcher: whole word, case-insensitive; "eparagony.pl" is a hit via `eparagony`.
  eq('matches eparagony.pl', matchProviderTerm('Connect eparagony.pl'), 'eparagony');
  eq('matches KSeF case-insensitively', matchProviderTerm('Resend to KSeF'), 'ksef');
  eq('matches kasa', matchProviderTerm('Kasa fiskalna'), 'kasa');
  eq('does not match a substring', matchProviderTerm('Parking paragonal'), null);
  eq('neutral copy passes', matchProviderTerm('Authority rejected'), null);

  // Extraction scope: JSX text and allow-listed attributes ARE scanned...
  eq(
    'JSX text hit',
    findViolations('x.tsx', 'const a = <p>Connect eparagony.pl</p>;').map((h) => h.term),
    ['eparagony']
  );
  eq(
    'attribute hit',
    findViolations('x.tsx', '<Input placeholder="My KSeF account" />').map((h) => h.term),
    ['ksef']
  );
  // ...identifiers, comments, imports and non-user-facing props are NOT.
  eq('comment ignored', findViolations('x.tsx', '// KSeF is mentioned here\nconst a = <p>ok</p>;'), []);
  eq('block comment ignored', findViolations('x.tsx', '/* KSeF */\nconst a = <p>ok</p>;'), []);
  eq('identifier ignored', findViolations('x.tsx', 'import { useKsefFa3 } from "./x";\nconst a = <p>ok</p>;'), []);
  eq('className ignored', findViolations('x.tsx', '<div className="ksef-panel">ok</div>'), []);
  eq('URL with // is not truncated', findViolations('x.tsx', "<a href=\"https://x/ksef\">ok</a>"), []);

  // Copy modules: every string literal counts.
  eq(
    'copy module hit',
    findViolations('lib/x-copy.ts', "export const A = 'Send to KSeF';").map((h) => h.term),
    ['ksef']
  );
  eq('hyphen copy module recognised', isScannable('lib/delivery-copy.ts'), true);
  eq('dot copy module recognised', isScannable('lib/a.copy.ts'), true);
  eq('plain .ts is not scanned', isScannable('lib/helper.ts'), false);
  eq('test file is not scanned', isScannable('x.test.tsx'), false);

  // Line numbers survive comment stripping.
  eq(
    'line number is preserved',
    findViolations('x.tsx', '/* a\n b */\nconst a = <p>KSeF</p>;').map((h) => h.line),
    [3]
  );

  // Folder rule: plugins/ is exempt, everywhere else is not. This is the case
  // that proves "deleting a move and re-running the guard fails the build".
  eq('plugins folder is allowed', isInsidePlugins(join('apps', 'web', 'src', 'plugins', 'ksef', 'a.tsx')), true);
  eq('features folder is not', isInsidePlugins(join('apps', 'web', 'src', 'features', 'connections', 'a.tsx')), false);
  eq('pages folder is not', isInsidePlugins(join('apps', 'web', 'src', 'pages', 'connections', 'a.tsx')), false);
  eq('a sibling named plugins-x is not the plugins folder', isInsidePlugins(join('apps', 'web', 'src', 'plugins-x', 'a.tsx')), false);
  eq('exemptions stay empty', EXEMPTIONS.size, 0);

  if (failures.length > 0) {
    console.error('✗ check-provider-name-boundary --self-check failed:\n');
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  console.log('✓ check-provider-name-boundary --self-check: matcher, extraction scope and folder rule behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-provider-name-boundary: fatal error:', err);
    process.exit(1);
  });
}
