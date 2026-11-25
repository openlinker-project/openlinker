#!/usr/bin/env node
/**
 * check-order-source-start-declarations.mjs
 *
 * Lint-time invariant for #4265: an order-source plugin's declarations about
 * where order sync can start must agree with what its adapter implements, be
 * exercised by the shared contract kit, and be reachable from its setup form.
 *
 * ## Why a script, not a type
 *
 * `orderSyncStartModes` and `orderWindowImport` live in the plugin manifest (a
 * static object the UI reads without constructing an adapter), while the
 * behaviour lives in optional adapter methods (`headCursor`, `cursorForDate`,
 * `listOrdersInWindow`). They are two hand-written statements of one fact and no
 * compiler relates them: an adapter can gain `cursorForDate` and the UI keep
 * hiding the "from a date" choice, or a manifest can promise `now` for an adapter
 * that has no `headCursor` and the first poll then fails at runtime.
 *
 * ## Rules, per `libs/integrations/<pkg>` whose `*-plugin.ts` advertises OrderSource
 *
 *   1. `orderSyncStartModes` is declared (an empty array means "no choice").
 *   2. `'now'` implies the adapter has `headCursor()`.
 *   3. `'from'` implies `cursorForDate()`, and `cursorForDate()` implies `'from'`.
 *   4. `orderWindowImport: true` if and only if the adapter has `listOrdersInWindow()`.
 *   5. Some spec in the package calls `runOrderSourceStartContract`.
 *   6. WIZARDS: the setup form file(s) for the plugin render `<OrderSyncStartField`
 *      or `<OrderSyncStartSection` (the same field, gated on the adapter list loading).
 *      `{ none: reason }` is allowed only when the modes are empty.
 *
 * ## What it does NOT catch
 *
 *   - It does not run anything. The contract kit proves behaviour; this proves
 *     the declarations and the kit wiring exist.
 *   - Detection is textual and comment-stripped. A method generated at runtime or
 *     inherited from a base class would be missed (none exists today).
 *   - A wizard that renders the field behind a condition is still accepted; the
 *     wizard tests cover when it shows.
 *
 * "SCANNED NOTHING" is a failure (the floor below), so a moved directory cannot
 * leave the check green over an empty set.
 *
 * Usage:
 *   node scripts/check-order-source-start-declarations.mjs
 *   node scripts/check-order-source-start-declarations.mjs --self-check
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const INTEGRATIONS = join('libs', 'integrations');

/**
 * Plugin directory -> the setup form files that must render the start field, or
 * `{ none: reason }` when the plugin offers no choice (modes `[]`).
 */
export const WIZARDS = {
  amazon: ['apps/web/src/features/amazon/components/amazon-setup-form.tsx'],
  allegro: ['apps/web/src/features/allegro/components/AllegroSetupForm.tsx'],
  erli: ['apps/web/src/features/connections/components/erli-setup-form.tsx'],
  prestashop: ['apps/web/src/features/connections/components/prestashop-setup-form.tsx'],
  shopify: ['apps/web/src/features/shopify/components/shopify-setup-form.tsx'],
  shoper: ['apps/web/src/features/connections/components/shoper-setup-form.tsx'],
  subiekt: ['apps/web/src/features/connections/components/subiekt-setup-form.tsx'],
  woocommerce: ['apps/web/src/features/connections/components/woocommerce-setup-form.tsx'],
};

export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

/** The declared modes, or null when the manifest does not declare the key at all. */
export function parseModes(pluginText) {
  const match = /orderSyncStartModes\s*:\s*\[([^\]]*)\]/.exec(stripComments(pluginText));
  if (match === null) return null;
  return [...match[1].matchAll(/['"](now|from|all)['"]/g)].map((m) => m[1]);
}

export function parseWindowImport(pluginText) {
  return /orderWindowImport\s*:\s*true\b/.test(stripComments(pluginText));
}

export function advertisesOrderSource(pluginText) {
  return /supportedCapabilities\s*:\s*\[[^\]]*['"]OrderSource['"]/.test(stripComments(pluginText));
}

/** A real method declaration (`name(` or `async name(` at line start), not a call. */
export function hasMethod(source, name) {
  return new RegExp(`^\\s*(?:public\\s+)?(?:async\\s+)?${name}\\s*\\(`, 'm').test(stripComments(source));
}

/**
 * Evaluate one plugin. Pure: everything it needs is passed in, so the
 * self-check can exercise every rule without a filesystem.
 *
 * @returns {string[]} problems, empty when the plugin conforms
 */
export function checkPlugin({ name, pluginText, adapterText, specTexts, wizard, wizardTexts }) {
  const problems = [];
  const modes = parseModes(pluginText);
  if (modes === null) {
    problems.push(`${name}: the manifest does not declare orderSyncStartModes (use [] for "no choice")`);
  }
  const declared = modes ?? [];

  const hasHead = hasMethod(adapterText, 'headCursor');
  const hasDate = hasMethod(adapterText, 'cursorForDate');
  const hasWindow = hasMethod(adapterText, 'listOrdersInWindow');

  if (declared.includes('now') && !hasHead) {
    problems.push(`${name}: declares 'now' but no adapter has headCursor()`);
  }
  if (declared.includes('from') && !hasDate) {
    problems.push(`${name}: declares 'from' but no adapter has cursorForDate()`);
  }
  if (hasDate && !declared.includes('from')) {
    problems.push(`${name}: an adapter has cursorForDate() but the manifest does not declare 'from'`);
  }
  const windowDeclared = parseWindowImport(pluginText);
  if (windowDeclared && !hasWindow) {
    problems.push(`${name}: declares orderWindowImport: true but no adapter has listOrdersInWindow()`);
  }
  if (!windowDeclared && hasWindow) {
    problems.push(`${name}: an adapter has listOrdersInWindow() but the manifest does not declare orderWindowImport: true`);
  }

  if (!specTexts.some((text) => /runOrderSourceStartContract\s*\(/.test(stripComments(text)))) {
    problems.push(`${name}: no spec calls runOrderSourceStartContract(), so the start contract is not exercised`);
  }

  if (wizard === undefined) {
    problems.push(`${name}: no WIZARDS entry (list its setup form files, or { none: reason } when modes are [])`);
  } else if (!Array.isArray(wizard)) {
    if (declared.length > 0) {
      problems.push(`${name}: WIZARDS says none (${wizard.none}) but the manifest declares modes ${JSON.stringify(declared)}`);
    }
  } else {
    wizard.forEach((file, index) => {
      const text = wizardTexts[index];
      if (text === null || text === undefined) {
        problems.push(`${name}: wizard file ${file} could not be read - did it move?`);
      } else if (!/<OrderSyncStartField\b|<OrderSyncStartSection\b/.test(stripComments(text))) {
        problems.push(`${name}: wizard ${file} does not render <OrderSyncStartField (or <OrderSyncStartSection, which wraps it)`);
      }
    });
  }
  return problems;
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
      await walk(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

async function readOrNull(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function selfCheck() {
  const failures = [];
  const plugin = (modes, window = false) =>
    `supportedCapabilities: ['OrderSource'], orderSyncStartModes: ${modes}, ${window ? 'orderWindowImport: true,' : ''}`;
  const adapter = (head, date, win) =>
    [head ? '  async headCursor() {}' : '', date ? '  cursorForDate(d) {}' : '', win ? '  async listOrdersInWindow() {}' : ''].join('\n');
  const spec = ['runOrderSourceStartContract(build, {});'];
  const field = ['<OrderSyncStartField modes={m} />'];
  const run = (over) =>
    checkPlugin({
      name: 'p',
      pluginText: plugin("['now', 'from', 'all']", true),
      adapterText: adapter(true, true, true),
      specTexts: spec,
      wizard: ['f.tsx'],
      wizardTexts: field,
      ...over,
    });
  const expect = (label, problems, fragment) => {
    const hit = problems.some((p) => p.includes(fragment));
    if (fragment === null ? problems.length !== 0 : !hit) {
      failures.push(`${label}: expected ${fragment === null ? 'no problems' : `a problem containing "${fragment}"`}, got ${JSON.stringify(problems)}`);
    }
  };

  expect('conforming plugin', run({}), null);
  expect('missing modes', run({ pluginText: "supportedCapabilities: ['OrderSource']" }), 'does not declare orderSyncStartModes');
  expect("now without head", run({ adapterText: adapter(false, true, true) }), "'now' but no adapter has headCursor");
  expect("from without date", run({ adapterText: adapter(true, false, true) }), "'from' but no adapter has cursorForDate");
  expect("date without from", run({ pluginText: plugin("['now', 'all']", true) }), "does not declare 'from'");
  expect('window true without method', run({ adapterText: adapter(true, true, false) }), 'no adapter has listOrdersInWindow');
  expect('window method without flag', run({ pluginText: plugin("['now', 'from', 'all']", false) }), 'does not declare orderWindowImport');
  expect('no contract spec', run({ specTexts: ['it("x", () => {})'] }), 'no spec calls runOrderSourceStartContract');
  expect('commented-out contract call', run({ specTexts: ['// runOrderSourceStartContract(b)'] }), 'no spec calls');
  expect('wizard missing field', run({ wizardTexts: ['export const X = () => null;'] }), 'does not render <OrderSyncStartField');
  expect('wizard rendering the section wrapper', run({ wizardTexts: ['<OrderSyncStartSection adapterKey="x" />'] }), null);
  expect('wizard unreadable', run({ wizardTexts: [null] }), 'could not be read');
  expect('no wizard entry', run({ wizard: undefined }), 'no WIZARDS entry');
  expect('none allowed for empty modes', run({ pluginText: plugin('[]'), adapterText: adapter(false, false, false), wizard: { none: 'no choice' } }), null);
  expect('none refused for non-empty modes', run({ wizard: { none: 'oops' } }), 'WIZARDS says none');
  expect('commented method is not a method', run({ adapterText: '// async headCursor() {}\n' + adapter(false, true, true) }), "'now' but no adapter has headCursor");
  expect('a call is not a declaration', run({ adapterText: 'const x = await this.headCursor();\n' + adapter(false, true, true) }), "'now' but no adapter has headCursor");
  if (advertisesOrderSource("supportedCapabilities: ['ProductMaster']")) failures.push('advertisesOrderSource matched a plugin without OrderSource');
  if (!advertisesOrderSource("supportedCapabilities: ['ProductMaster', 'OrderSource']")) failures.push('advertisesOrderSource missed OrderSource');

  if (failures.length > 0) {
    console.error('check-order-source-start-declarations SELF-CHECK FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-order-source-start-declarations self-check OK (19 assertions)');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const problems = [];
  const root = join(repoRoot, INTEGRATIONS);
  const packages = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);

  let scanned = 0;
  for (const pkg of packages) {
    const srcDir = join(root, pkg, 'src');
    const files = await walk(srcDir, []);
    const pluginFile = files.find((f) => /[\\/][^\\/]*-plugin\.ts$/.test(f) && !f.endsWith('.spec.ts'));
    if (pluginFile === undefined) continue;
    const pluginText = await readFile(pluginFile, 'utf8');
    if (!advertisesOrderSource(pluginText)) continue;
    scanned += 1;

    const sources = files.filter((f) => !f.endsWith('.spec.ts') && !f.includes(`${join('src', '__tests__')}`));
    const adapterText = (await Promise.all(sources.map((f) => readFile(f, 'utf8')))).join('\n');
    const specTexts = await Promise.all(files.filter((f) => f.endsWith('.spec.ts')).map((f) => readFile(f, 'utf8')));
    const wizard = WIZARDS[pkg];
    const wizardTexts = Array.isArray(wizard)
      ? await Promise.all(wizard.map((f) => readOrNull(join(repoRoot, f))))
      : [];

    problems.push(...checkPlugin({ name: pkg, pluginText, adapterText, specTexts, wizard, wizardTexts }));
  }

  for (const pkg of Object.keys(WIZARDS)) {
    if (!packages.includes(pkg)) problems.push(`WIZARDS names ${pkg}, which is not a libs/integrations package`);
  }
  if (scanned === 0) {
    problems.push(`scanned no OrderSource plugin under ${relative(repoRoot, root)} - the walk matched nothing, which is a defect, not a pass`);
  }

  if (problems.length > 0) {
    console.error('check-order-source-start-declarations FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`check-order-source-start-declarations OK (${scanned} OrderSource plugins scanned)`);
}

await main();
