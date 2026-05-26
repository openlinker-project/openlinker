#!/usr/bin/env node
/**
 * check-service-interfaces.mjs
 *
 * Lint-time invariant for the service-interface rule documented at
 * docs/engineering-standards.md § Service Interface Implementation
 * ("Services must always implement an interface") and .claude/rules/backend.md.
 *
 * Rule. Every application service —
 *   `libs/core/src/<ctx>/application/services/*.service.ts`
 *   (excluding `*.spec.ts` and `*.service.interface.ts`)
 * — MUST declare an `implements <X>` heritage clause where `<X>` is either:
 *
 *   (a) an `I*Service` interface that has a sibling `*.service.interface.ts`
 *       file in the same context — colocated in `application/services/` OR in
 *       `application/interfaces/` (both conventions are in use), OR
 *   (b) a capability `*Port` interface (a service that adapts a domain port —
 *       e.g. RedisSyncLockService implements SyncLockPort — already satisfies
 *       the "code against an interface" intent; forcing a redundant parallel
 *       I*Service onto a port-adapter would be worse, not better).
 *       `*RepositoryPort` does NOT count — repository ports are an intra-context
 *       persistence concern, not the service's outward contract.
 *
 * A service that implements nothing, or whose declared `I*Service` has no
 * sibling interface file, fails the build with a file + reason.
 *
 * The service class in a file is identified by its filename-derived name
 * (`foo-bar.service.ts` → `FooBar` or `FooBarService`) so a helper class
 * declared earlier in the file doesn't get checked in its place.
 *
 * Run with `--self-check` to exercise the classifier against synthetic inputs
 * (no filesystem) — mirrors `check-migration-timestamps.mjs --self-check`.
 *
 * Scope. `libs/core/src/<ctx>/application/services/` only — matching the
 * scope #712 defines. Services in apps/integrations are out of scope here.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const SERVICES_GLOB_ROOT = join(repoRoot, 'libs', 'core', 'src');
const SERVICES_PATH_SEGMENT = `application${sep}services${sep}`;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', '.turbo']);

const I_SERVICE_RE = /^I[A-Z][A-Za-z0-9]*Service$/;
const PORT_RE = /^[A-Z][A-Za-z0-9]*Port$/;
const REPOSITORY_PORT_RE = /RepositoryPort$/;

const DOCS_REF = 'docs/engineering-standards.md#service-interface-implementation';

/** Recursively collect files under `dir`. */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await walk(join(dir, entry.name))));
    } else if (entry.isFile()) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

/** Is this an in-scope application service file? Path-separator agnostic. */
function isServiceFile(repoRel) {
  return (
    repoRel.includes(SERVICES_PATH_SEGMENT) &&
    repoRel.endsWith('.service.ts') &&
    !repoRel.endsWith('.spec.ts') &&
    !repoRel.endsWith('.service.interface.ts')
  );
}

/** `order-item-ref-resolver` → `OrderItemRefResolver`. */
function toPascalCase(kebab) {
  return kebab
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * All exported classes with their heritage clause (text between the class name
 * and the opening `{`). Returns `[{ className, heritage }]`.
 */
function parseClasses(content) {
  const re = /export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)([^{]*)\{/gs;
  const classes = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    classes.push({ className: m[1], heritage: m[2] });
  }
  return classes;
}

/**
 * Pick the service class for a file by its filename-derived name. A
 * `foo-bar.service.ts` file's class is `FooBar` or `FooBarService`; if neither
 * is present, fall back to the first exported class.
 */
function pickServiceClass(classes, fileBase) {
  const pascal = toPascalCase(fileBase);
  const candidates = new Set([pascal, `${pascal}Service`]);
  return classes.find((c) => candidates.has(c.className)) ?? classes[0] ?? null;
}

/** Parse the comma-separated identifiers after `implements` (generics stripped). */
function parseImplements(heritage) {
  const m = heritage.match(/\bimplements\b([\s\S]+)$/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.replace(/<[\s\S]*$/, '').trim()) // drop generic args
    .filter(Boolean);
}

/**
 * Pure classifier — no filesystem. Given the file content, its base name (no
 * `.service.ts`), and whether a sibling interface file exists, decide whether
 * the service satisfies the rule. Returns `{ ok, reason }`.
 */
function evaluateService({ content, fileBase, siblingExists }) {
  const picked = pickServiceClass(parseClasses(content), fileBase);
  if (!picked) {
    return { ok: false, reason: 'no exported class found' };
  }

  const implemented = parseImplements(picked.heritage);
  if (implemented.length === 0) {
    const suggested = `I${picked.className}${picked.className.endsWith('Service') ? '' : 'Service'}`;
    return {
      ok: false,
      reason: `class ${picked.className} implements no interface — add an ${suggested} interface (sibling *.service.interface.ts) or implement a capability *Port`,
    };
  }

  const serviceIfaces = implemented.filter((n) => I_SERVICE_RE.test(n));
  if (serviceIfaces.length > 0) {
    if (!siblingExists) {
      return {
        ok: false,
        reason: `declares 'implements ${serviceIfaces.join(', ')}' but no sibling *.service.interface.ts exists (looked in ./ and ../interfaces/)`,
      };
    }
    return { ok: true };
  }

  const ports = implemented.filter((n) => PORT_RE.test(n) && !REPOSITORY_PORT_RE.test(n));
  if (ports.length > 0) return { ok: true };

  return {
    ok: false,
    reason: `class ${picked.className} implements [${implemented.join(', ')}] — none is an I*Service (with sibling file) or a non-repository *Port`,
  };
}

/** Does a sibling interface file exist for this service (either convention)? */
function siblingInterfaceExists(absFile) {
  const dir = dirname(absFile);
  const base = basename(absFile, '.service.ts');
  const colocated = join(dir, `${base}.service.interface.ts`);
  const interfacesDir = join(dirname(dir), 'interfaces', `${base}.service.interface.ts`);
  return existsSync(colocated) || existsSync(interfacesDir);
}

async function main() {
  const files = (await walk(SERVICES_GLOB_ROOT)).filter((f) =>
    isServiceFile(relative(repoRoot, f))
  );

  const violations = [];
  let checked = 0;

  for (const file of files) {
    const repoRel = relative(repoRoot, file);
    const content = await readFile(file, 'utf8');
    const result = evaluateService({
      content,
      fileBase: basename(file, '.service.ts'),
      siblingExists: siblingInterfaceExists(file),
    });
    checked += 1;
    if (!result.ok) violations.push({ file: repoRel, reason: result.reason });
  }

  if (violations.length === 0) {
    console.log(
      `✓ check-service-interfaces: ${checked} core application service(s) checked. All implement an interface.`
    );
    process.exit(0);
  }

  console.error(`✗ check-service-interfaces: ${violations.length} violation(s).\n`);
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    rule: ${v.reason}`);
    console.error(`    docs: ${DOCS_REF}`);
    console.error('');
  }
  process.exit(1);
}

/**
 * Self-test the pure classifier against synthetic inputs. Runs in-process —
 * no filesystem, no real services — so it stays green regardless of the tree.
 */
function selfCheck() {
  const svc = (impl) =>
    `import { Injectable } from '@nestjs/common';\n@Injectable()\nexport class FooBarService${impl} {\n  doThing(): void {}\n}\n`;

  const cases = [
    {
      name: 'implements nothing → fail',
      input: { content: svc(''), fileBase: 'foo-bar', siblingExists: false },
      ok: false,
    },
    {
      name: 'I*Service + sibling present → pass',
      input: {
        content: svc(' implements IFooBarService'),
        fileBase: 'foo-bar',
        siblingExists: true,
      },
      ok: true,
    },
    {
      name: 'I*Service + no sibling → fail',
      input: {
        content: svc(' implements IFooBarService'),
        fileBase: 'foo-bar',
        siblingExists: false,
      },
      ok: false,
    },
    {
      name: 'capability *Port → pass',
      input: {
        content: svc(' implements SyncLockPort'),
        fileBase: 'foo-bar',
        siblingExists: false,
      },
      ok: true,
    },
    {
      name: 'only *RepositoryPort → fail',
      input: {
        content: svc(' implements FooRepositoryPort'),
        fileBase: 'foo-bar',
        siblingExists: false,
      },
      ok: false,
    },
    {
      name: 'only lifecycle iface → fail',
      input: {
        content: svc(' implements OnModuleInit'),
        fileBase: 'foo-bar',
        siblingExists: false,
      },
      ok: false,
    },
    {
      name: 'helper class first, service class matches filename → pass',
      input: {
        content: `class FooBarHelper {}\n@Injectable()\nexport class FooBarService implements IFooBarService {\n  doThing(): void {}\n}\n`,
        fileBase: 'foo-bar',
        siblingExists: true,
      },
      ok: true,
    },
    {
      name: 'class without Service suffix matching filename (port-adapter) → pass',
      input: {
        content: `@Injectable()\nexport class IntegrationsContentPublisher implements ContentPublisherPort {}\n`,
        fileBase: 'integrations-content-publisher',
        siblingExists: false,
      },
      ok: true,
    },
  ];

  const failures = [];
  for (const c of cases) {
    const got = evaluateService(c.input).ok;
    if (got !== c.ok) failures.push(`  ✗ ${c.name}: expected ok=${c.ok}, got ok=${got}`);
  }

  if (failures.length === 0) {
    console.log(
      `✓ check-service-interfaces --self-check: ${cases.length} classifier case(s) passed.`
    );
    process.exit(0);
  }

  console.error('✗ check-service-interfaces --self-check failed:\n');
  console.error(failures.join('\n'));
  process.exit(1);
}

const run = process.argv.includes('--self-check') ? selfCheck : main;
Promise.resolve(run()).catch((err) => {
  console.error('check-service-interfaces: fatal error:', err);
  process.exit(1);
});
