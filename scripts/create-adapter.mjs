#!/usr/bin/env node
/**
 * create-adapter — scaffolds a new OpenLinker plugin package.
 *
 * Usage:
 *   pnpm create-adapter <name>
 *   pnpm create-adapter <name> --target-dir /tmp/scaffold-smoke
 *   node scripts/create-adapter.mjs <name> [--target-dir <dir>]
 *
 * Produces a minimal compilable skeleton at `<target-dir>/<name>/` using
 * the `createNestAdapterModule` authoring pattern. The contributor adds
 * capabilities by following `docs/plugin-author-guide.md`.
 *
 * Templates live under `scripts/create-adapter-templates/`, mirroring the
 * target tree 1:1. Filenames and contents carry four substitution tokens:
 *
 *   __name__        — lowercase platform slug      (e.g. `smoke-test`)
 *   __Name__        — PascalCase class identifier  (e.g. `SmokeTest`)
 *   __camelName__   — lowerCamelCase identifier    (e.g. `smokeTest`)
 *   __BRAND__       — short user-facing label      (defaults to PascalCase)
 *
 * Use `__camelName__` for TypeScript identifier positions where the existing
 * convention is lowercase (e.g. `<camelName>AdapterManifest` matching the
 * shipped `allegroAdapterManifest` / `prestashopAdapterManifest`). The
 * raw `__name__` token would substitute hyphenated slugs (`smoke-test`)
 * into identifier slots and produce uncompilable output (#698).
 *
 * The `--target-dir <dir>` flag (default: `libs/integrations`) lets the
 * scaffolder write into a tmp dir for verification runs without polluting
 * the worktree.
 *
 * @module scripts
 */
import { mkdir, readdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(SCRIPT_DIR, 'create-adapter-templates');
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_TARGET_DIR = join(REPO_ROOT, 'libs/integrations');

const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const NAME_MIN_LEN = 2;
const NAME_MAX_LEN = 32;

// Names that would clash with in-repo packages. Only enforced when scaffolding
// into the repo's libs/integrations/ — external `--target-dir` skips this so a
// throwaway smoke run into /tmp can use any slug.
const SHIPPED_PLUGIN_NAMES = new Set(['prestashop', 'allegro', 'ai']);
const RESERVED_WORKSPACE_NAMES = new Set([
  'core',
  'shared',
  'plugin-sdk',
  'web',
  'api',
  'worker',
]);

function printUsage() {
  process.stderr.write(
    [
      'Usage: pnpm create-adapter <name> [--target-dir <dir>]',
      '',
      '  <name>           Platform slug. Lowercase ASCII, 2-32 chars, leading',
      '                   letter, internal hyphens allowed (e.g. shopify, woo-commerce).',
      '  --target-dir     Destination parent dir for the new package.',
      '                   Default: libs/integrations (relative to repo root).',
      '',
      'Examples:',
      '  pnpm create-adapter shopify',
      '  pnpm create-adapter woo-commerce',
      '  node scripts/create-adapter.mjs example --target-dir /tmp/smoke',
      '',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const args = { name: null, targetDir: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--target-dir') {
      args.targetDir = argv[i + 1];
      i++;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    } else if (token.startsWith('--')) {
      throw new Error(`Unknown flag: ${token}`);
    } else if (args.name === null) {
      args.name = token;
    } else {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
  }
  return args;
}

function validateName(name) {
  if (!name) {
    throw new Error('Missing required argument: <name>');
  }
  if (name.length < NAME_MIN_LEN || name.length > NAME_MAX_LEN) {
    throw new Error(
      `<name> must be ${NAME_MIN_LEN}-${NAME_MAX_LEN} characters; got ${name.length}.`,
    );
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `<name> "${name}" is invalid. Must be lowercase ASCII, leading letter, ` +
        `internal hyphens allowed, no trailing/double hyphens, no underscores.`,
    );
  }
}

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function toPascalCase(slug) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

// First segment stays lowercase, subsequent segments PascalCase.
// `smoke-test` → `smokeTest`; non-hyphenated slugs are unchanged.
function toCamelCase(slug) {
  const parts = slug.split('-');
  return parts
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

function applyTokens(text, tokens) {
  // Single-pass replace — order doesn't matter, the tokens are
  // non-overlapping by construction (`__camelName__` doesn't contain
  // `__name__` / `__Name__` / `__BRAND__` as a substring and vice versa).
  return text
    .split('__name__')
    .join(tokens.name)
    .split('__Name__')
    .join(tokens.Name)
    .split('__camelName__')
    .join(tokens.camelName)
    .split('__BRAND__')
    .join(tokens.BRAND);
}

async function listTemplateFiles(dir) {
  const files = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        files.push(abs);
      }
    }
  }
  return files.sort();
}

/**
 * Scaffold a new plugin package.
 *
 * Exported so a future smoke test or `--dry-run` flag can call into the
 * same code path without re-parsing argv. See the tracked follow-up for
 * the lint-time invariant.
 */
export async function scaffoldAdapter({
  name,
  targetDir,
  templatesDir = TEMPLATES_DIR,
}) {
  validateName(name);

  // Reserved-name checks only apply when scaffolding into the repo's
  // libs/integrations/ — a `--target-dir /tmp/...` smoke run can use any slug.
  const isDefaultTarget = targetDir === DEFAULT_TARGET_DIR;
  if (isDefaultTarget && SHIPPED_PLUGIN_NAMES.has(name)) {
    throw new Error(
      `<name> "${name}" matches a shipped plugin; choose a different slug.`,
    );
  }
  if (isDefaultTarget && RESERVED_WORKSPACE_NAMES.has(name)) {
    throw new Error(
      `<name> "${name}" collides with a reserved workspace name ` +
        `(${[...RESERVED_WORKSPACE_NAMES].join(', ')}).`,
    );
  }

  const targetPkgDir = join(targetDir, name);
  if (await pathExists(targetPkgDir)) {
    throw new Error(`Target directory already exists: ${targetPkgDir}`);
  }

  const tokens = {
    name,
    Name: toPascalCase(name),
    camelName: toCamelCase(name),
    BRAND: toPascalCase(name),
  };

  const templateFiles = await listTemplateFiles(templatesDir);
  if (templateFiles.length === 0) {
    throw new Error(`No template files found under ${templatesDir}`);
  }

  const written = [];
  for (const templatePath of templateFiles) {
    const relPath = templatePath.slice(templatesDir.length + 1);
    const targetRelPath = applyTokens(relPath, tokens);
    const targetAbsPath = join(targetPkgDir, targetRelPath);
    await mkdir(dirname(targetAbsPath), { recursive: true });

    if (basename(templatePath) === '.gitkeep') {
      // Preserve empty-dir markers verbatim.
      await writeFile(targetAbsPath, '');
    } else {
      const raw = await readFile(templatePath, 'utf8');
      await writeFile(targetAbsPath, applyTokens(raw, tokens));
    }
    written.push(targetRelPath);
  }

  return { targetPkgDir, written };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n`);
    printUsage();
    process.exit(1);
  }

  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  const targetDir = parsed.targetDir
    ? resolve(parsed.targetDir)
    : DEFAULT_TARGET_DIR;

  // When using the default target, sanity-check the repo root.
  if (!parsed.targetDir) {
    const workspaceMarker = join(REPO_ROOT, 'pnpm-workspace.yaml');
    if (!(await pathExists(workspaceMarker))) {
      process.stderr.write(
        `Error: pnpm-workspace.yaml not found at ${workspaceMarker}.\n` +
          `Run from the OpenLinker repo root, or pass --target-dir.\n`,
      );
      process.exit(1);
    }
  }

  try {
    const { targetPkgDir, written } = await scaffoldAdapter({
      name: parsed.name,
      targetDir,
    });
    process.stdout.write(
      [
        `✓ Scaffolded ${targetPkgDir} (${written.length} files)`,
        '',
        'Next:',
        '  1. Run `pnpm install` from the repo root',
        '  2. Read docs/plugin-author-guide.md',
        '  3. Pick a capability port and implement your first adapter',
        '  4. Add the new module to `apps/api/src/plugins.ts`',
        '',
      ].join('\n'),
    );
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

// Only run main() when invoked as a script (not when imported by a test).
// `pathToFileURL` handles spaces / escaping / Windows paths that the naive
// `\`file://${process.argv[1]}\`` template breaks on.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
