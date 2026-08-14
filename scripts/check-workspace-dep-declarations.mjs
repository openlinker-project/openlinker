#!/usr/bin/env node
/**
 * Workspace Dependency Declaration Invariant (#2011)
 *
 * Asserts that every workspace package declares the `@openlinker/*` workspace
 * packages it actually depends on. Two complementary assertions:
 *
 *   [A] tsconfig `references` ⇒ declared dependency.
 *   [B] production `@openlinker/*` import ⇒ declared dependency.
 *
 * Why both: pnpm derives its topological build order from `package.json`, NOT
 * from tsconfig `references`. A package that references a sibling project
 * without declaring the manifest edge lands in the SAME `pnpm -r` chunk as that
 * sibling, and both `tsc -b` processes then emit into the sibling's `dist/`
 * concurrently — a nondeterministic `TS2306 … is not a module` build failure
 * (`libs/core` → `libs/shared`, CI run 31081388177 attempt 1). Assertion A
 * targets that race directly. Assertion B catches the general class, including
 * packages with no `references` block at all (`apps/api`), whose emitted `dist`
 * resolves bare specifiers only through `shamefully-hoist`.
 *
 * Chained into the root `check:invariants` command. Mirrors the discovery shape
 * of `scripts/check-libs-build-scripts.mjs` (#602) and the reporting shape of
 * `scripts/check-cross-context-imports.mjs`.
 *
 * @module scripts
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// Mirrors the `pnpm-workspace.yaml` globs. Hardcoded rather than parsed: the
// repo ships no YAML parser, and `scripts/check-libs-build-scripts.mjs` already
// mirrors the same globs this way. Keep the two in sync when a glob is added.
const WORKSPACE_PARENTS = ['apps', 'libs', 'libs/integrations'];

// Test code follows a looser declaration policy (integration suites reach for
// `@openlinker/test-kit`, fixtures pull sibling plugins), and it is not what
// pnpm's build graph is derived from. Production source only.
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '__mocks__', 'test', 'tests']);
const SKIP_FILE_RE = /\.(spec|test|int-spec|e2e-spec|setup)\.[cm]?[jt]sx?$/;
const SCAN_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

// `apps/e2e` is Playwright test-support code end to end (page objects,
// fixtures, an API client) with no build script and no runtime, so treating its
// `src/` as production would demand `dependencies` entries in a test-only
// package. Excluded wholesale, deliberately.
const EXCLUDED_PACKAGES = new Set(['apps/e2e']);

const IMPORT_RE = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])(@openlinker\/[^'"]+)\1/g;

const errors = [];

/**
 * Strips `//` and block comments that sit outside string literals.
 *
 * Shared by the tsconfig reader (comments and trailing commas are legal there,
 * so bare `JSON.parse` would crash the guard the day someone adds one) and by
 * the import extractor (a comment must never register as a dependency).
 */
export function stripComments(text) {
  let out = '';
  let quote = null;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }

  return out;
}

/** tsconfig is JSONC: comments plus trailing commas are both legal. */
export function stripJsonc(text) {
  return stripComments(text).replace(/,(\s*[}\]])/g, '$1');
}

/** `@openlinker/core/orders` → `@openlinker/core`. */
export function normaliseSpecifier(specifier) {
  const parts = specifier.split('/');
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
}

/**
 * Extracts the distinct `@openlinker/*` package names imported by `source`.
 *
 * Two filters, both load-bearing. Comments are stripped FIRST, because a prose
 * mention can contain the literal `from '@openlinker/x'` — `apps/web` carries
 * 21 such mentions and imports nothing, one of them reading "a literal here
 * (not imported from `@openlinker/integrations-allegro`)". Then only import
 * STATEMENTS are matched, so a bare specifier in a string literal or a
 * backticked doc reference is not mistaken for a dependency.
 */
export function extractImportedPackages(source) {
  const found = new Set();
  for (const match of stripComments(source).matchAll(IMPORT_RE)) {
    found.add(normaliseSpecifier(match[2]));
  }
  return found;
}

export function isTestFile(filePath) {
  return SKIP_FILE_RE.test(filePath);
}

function declaredDependencies(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

async function readJsonc(absPath) {
  const raw = await readFile(absPath, 'utf8');
  return JSON.parse(stripJsonc(raw));
}

async function discoverPackages() {
  const packages = [];

  for (const parent of WORKSPACE_PARENTS) {
    let entries;
    try {
      entries = await readdir(join(REPO_ROOT, parent), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;

      const dir = `${parent}/${entry.name}`;
      // `libs/*` matches the `libs/integrations` container itself, and `apps/*`
      // matches `apps/prestashop-module` (a PHP module) — neither is a package.
      if (WORKSPACE_PARENTS.includes(dir)) continue;
      if (EXCLUDED_PACKAGES.has(dir)) continue;

      let manifest;
      try {
        manifest = JSON.parse(await readFile(join(REPO_ROOT, dir, 'package.json'), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        errors.push({
          file: `${dir}/package.json`,
          reason: `could not be parsed: ${err.message}`,
        });
        continue;
      }

      packages.push({ dir, name: manifest.name, declared: declaredDependencies(manifest) });
    }
  }

  return packages.sort((a, b) => a.dir.localeCompare(b.dir));
}

async function collectProductionFiles(absDir, acc = []) {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectProductionFiles(abs, acc);
      continue;
    }
    if (isTestFile(entry.name)) continue;
    const ext = entry.name.includes('.') ? `.${entry.name.split('.').pop()}` : '';
    if (SCAN_EXTS.has(ext)) acc.push(abs);
  }

  return acc;
}

/** Assertion A — tsconfig `references` ⇒ declared dependency. */
async function checkReferences(pkg, byDir) {
  let tsconfig;
  try {
    tsconfig = await readJsonc(join(REPO_ROOT, pkg.dir, 'tsconfig.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    errors.push({
      file: `${pkg.dir}/tsconfig.json`,
      reason: `could not be parsed: ${err.message}`,
    });
    return 0;
  }

  const references = Array.isArray(tsconfig.references) ? tsconfig.references : [];
  let considered = 0;

  for (const ref of references) {
    if (typeof ref?.path !== 'string') continue;

    // A reference may legally point at a config FILE; resolve to its directory.
    const resolved = resolve(REPO_ROOT, pkg.dir, ref.path).replace(/\/tsconfig[^/]*\.json$/, '');
    const relDir = relative(REPO_ROOT, resolved);

    // Same-package sub-config (`apps/web` → `./tsconfig.app.json`). Ignored by
    // rule, not as a special case; sub-configs are never recursed into.
    if (relDir === pkg.dir || relDir.startsWith(`${pkg.dir}/`)) continue;

    const target = byDir.get(relDir);
    if (!target) continue; // outside the discovered workspace set

    considered += 1;
    if (!pkg.declared.has(target.name)) {
      errors.push({
        file: `${pkg.dir}/package.json`,
        assertion: 'A',
        reason: `tsconfig references "${ref.path}" (${target.name}) but does not declare it as a workspace dependency`,
      });
    }
  }

  return considered;
}

/** Assertion B — production `@openlinker/*` import ⇒ declared dependency. */
async function checkImports(pkg, byName) {
  const files = await collectProductionFiles(join(REPO_ROOT, pkg.dir, 'src'));
  const firstSeen = new Map();

  for (const abs of files) {
    const source = await readFile(abs, 'utf8');
    for (const imported of extractImportedPackages(source)) {
      // Self-references are load-bearing to exclude, not cosmetic: libs/core
      // holds 309 production `@openlinker/core/*` self-imports (the documented
      // cross-context barrel convention). Must run AFTER normalisation.
      if (imported === pkg.name) continue;
      if (!byName.has(imported)) continue;
      if (pkg.declared.has(imported)) continue;
      if (!firstSeen.has(imported)) firstSeen.set(imported, relative(REPO_ROOT, abs));
    }
  }

  for (const imported of [...firstSeen.keys()].sort()) {
    errors.push({
      file: `${pkg.dir}/package.json`,
      assertion: 'B',
      reason: `imports "${imported}" in production source (first seen ${firstSeen.get(imported)}) but does not declare it`,
    });
  }

  return files.length;
}

async function main() {
  const packages = await discoverPackages();

  // A guard that passes because it discovered nothing has silently stopped
  // guarding — most likely `pnpm-workspace.yaml` moved or its globs changed.
  if (packages.length === 0) {
    console.error(
      '✗ check-workspace-dep-declarations: discovered 0 workspace packages under ' +
        `${WORKSPACE_PARENTS.join(', ')}. Re-sync WORKSPACE_PARENTS with pnpm-workspace.yaml.`
    );
    process.exit(1);
  }

  const byDir = new Map(packages.map((p) => [p.dir, p]));
  const byName = new Map(packages.map((p) => [p.name, p]));

  let refCount = 0;
  let fileCount = 0;
  for (const pkg of packages) {
    refCount += await checkReferences(pkg, byDir);
    fileCount += await checkImports(pkg, byName);
  }

  if (errors.length === 0) {
    console.log(
      `✓ check-workspace-dep-declarations: OK (${packages.length} packages, ${refCount} refs, ${fileCount} files).`
    );
    process.exit(0);
  }

  console.error(`✗ check-workspace-dep-declarations: ${errors.length} violation(s).\n`);
  for (const e of errors) {
    console.error(`  ${e.file}`);
    console.error(`    rule:   [${e.assertion ?? '-'}] ${e.reason}`);
    console.error(`    docs:   docs/engineering-standards.md#import-aliases`);
    console.error('');
  }
  process.exit(1);
}

function selfCheck() {
  const cases = [
    {
      name: 'subpath import normalises to the package name',
      actual: [...extractImportedPackages(`import { X } from '@openlinker/core/orders';`)],
      expected: ['@openlinker/core'],
    },
    {
      name: 'bare barrel import is captured',
      actual: [...extractImportedPackages(`import { Logger } from '@openlinker/shared';`)],
      expected: ['@openlinker/shared'],
    },
    {
      name: 'import type counts (a real tsc ordering edge)',
      actual: [...extractImportedPackages(`import type { A } from '@openlinker/shared/logging';`)],
      expected: ['@openlinker/shared'],
    },
    {
      name: 'require() is captured',
      actual: [...extractImportedPackages(`const x = require('@openlinker/shared');`)],
      expected: ['@openlinker/shared'],
    },
    {
      name: 'dynamic import with a literal is captured',
      actual: [...extractImportedPackages(`await import('@openlinker/core');`)],
      expected: ['@openlinker/core'],
    },
    {
      name: 'template-literal dynamic import is an accepted blind spot',
      actual: [...extractImportedPackages('await import(`@openlinker/${name}`);')],
      expected: [],
    },
    {
      name: 'JSDoc mention is not an import',
      actual: [
        ...extractImportedPackages(
          ` * keep in sync with PermissionValues from \`@openlinker/core/users\``
        ),
      ],
      expected: [],
    },
    {
      name: 'line comment mention is not an import',
      actual: [
        ...extractImportedPackages(`// not imported from '@openlinker/integrations-allegro'`),
      ],
      expected: [],
    },
    {
      name: 'spec file is skipped',
      actual: [
        isTestFile('foo.spec.ts'),
        isTestFile('bar.test.tsx'),
        isTestFile('baz.int-spec.ts'),
      ],
      expected: [true, true, true],
    },
    {
      name: 'setup file is skipped',
      actual: [isTestFile('auth.setup.ts')],
      expected: [true],
    },
    {
      name: 'production file is not skipped',
      actual: [isTestFile('product.service.ts'), isTestFile('index.mts')],
      expected: [false, false],
    },
    {
      name: 'tsconfig with comments and a trailing comma parses',
      actual: JSON.parse(
        stripJsonc('{\n  // a comment\n  "a": 1, /* block */\n  "b": [1, 2,],\n}')
      ),
      expected: { a: 1, b: [1, 2] },
    },
    {
      name: 'a URL inside a string survives comment stripping',
      actual: JSON.parse(stripJsonc('{ "url": "https://example.com/x" }')),
      expected: { url: 'https://example.com/x' },
    },
  ];

  const failures = [];
  for (const c of cases) {
    const actual = JSON.stringify(c.actual);
    const expected = JSON.stringify(c.expected);
    if (actual !== expected) {
      failures.push(`  ${c.name}\n    expected: ${expected}\n    actual:   ${actual}`);
    }
  }

  if (failures.length === 0) {
    console.log(`✓ check-workspace-dep-declarations --self-check: ${cases.length} case(s) passed.`);
    process.exit(0);
  }

  console.error('✗ check-workspace-dep-declarations --self-check failed:\n');
  console.error(failures.join('\n'));
  process.exit(1);
}

const run = process.argv.includes('--self-check') ? selfCheck : main;
Promise.resolve(run()).catch((err) => {
  console.error('check-workspace-dep-declarations: fatal error:', err);
  process.exit(1);
});
