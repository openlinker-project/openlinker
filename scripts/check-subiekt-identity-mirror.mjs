#!/usr/bin/env node
/**
 * check-subiekt-identity-mirror.mjs
 *
 * Lint-time invariant for the Subiekt GT identity mirror.
 *
 * Subiekt GT and Subiekt nexo are two separate InsERT products with two
 * different bridges and two different wire contracts. GT is the only one with
 * an adapter in this tree, and it owns `platformType: 'subiekt-gt'` /
 * `adapterKey: 'subiekt.gt.v1'`. The browser bundle cannot import
 * `@openlinker/core` (#591), so the connection form and the FE plugin each
 * carry their own COPY of those two strings - three independent copies of one
 * identity.
 *
 * A drifted copy is not cosmetic, and it is not caught by anything else:
 *
 *   - it does not break the build: both sides are plain string literals, so
 *     `tsc` is perfectly happy with two different ones;
 *   - it does not fail a unit test: the FE setup-form spec asserts a HARDCODED
 *     expectation, so a wrong value edited in both the source and the spec
 *     passes green;
 *   - it fails at the one moment nobody is watching for it - an operator
 *     clicking "add connection". `ConnectionService.create` does not validate
 *     `platformType` against the registry (`CreateConnectionDto` has only
 *     `@IsString() @IsNotEmpty()`), so the write SUCCEEDS and mints a
 *     connection that no adapter recognises, with nothing but a log warning.
 *     The operator sees a connection that exists and does nothing.
 *
 * It also refuses the RETIRED identities outright. `'subiekt'` was ambiguous
 * between the two products and `'subiekt.invoicing.v1'` named a fifth of what
 * the adapter does; neither may come back on any side, and a future nexo
 * plugin must bring its own pair rather than reviving these.
 *
 * Both sides are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step like its siblings. Run with `--self-check` to
 * exercise the pure parsers and the differ against synthetic input.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const BACKEND_MANIFEST = 'libs/integrations/subiekt/src/subiekt-plugin.ts';
const FRONTEND_SCHEMA = 'apps/web/src/features/connections/components/subiekt-setup.schema.ts';
const FRONTEND_PLUGIN = 'apps/web/src/plugins/subiekt-gt/index.ts';

/**
 * Identities that must never appear on any side again. Kept here rather than
 * derived, because the whole point is that they are gone from the source.
 */
export const RETIRED_IDENTITIES = ['subiekt', 'subiekt.invoicing.v1'];

/**
 * Read `key: 'value'` or `key = 'value'` for a given key name.
 *
 * Deliberately anchored on the key so a comment mentioning the value cannot
 * satisfy it - the migration and several docblocks quote the retired literals
 * on purpose, and a looser regex would read those as declarations.
 */
export function parseAssignedString(source, key) {
  const pattern = new RegExp(`(?:^|[\\s{,])${key}\\s*[:=]\\s*'([^']*)'`, 'm');
  const match = pattern.exec(stripComments(source));
  return match ? match[1] : null;
}

/**
 * Strip line and block comments so a quoted literal inside prose is never
 * mistaken for a declaration.
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Compare one logical value across every site that declares it.
 * `sites` is `[{ label, value }]`; returns violation strings.
 */
export function diffIdentity(name, expected, sites) {
  const violations = [];

  for (const site of sites) {
    if (site.value === null) {
      violations.push(`${name}: could not find a declaration in ${site.label}`);
      continue;
    }
    if (site.value !== expected) {
      violations.push(
        `${name}: ${site.label} declares '${site.value}' but the backend manifest declares '${expected}'`
      );
    }
    if (RETIRED_IDENTITIES.includes(site.value)) {
      violations.push(
        `${name}: ${site.label} declares the RETIRED identity '${site.value}'. ` +
          `'subiekt' cannot tell Subiekt GT from Subiekt nexo, and ` +
          `'subiekt.invoicing.v1' named a fifth of what the adapter does.`
      );
    }
  }

  return violations;
}

async function read(relativePath) {
  return readFile(join(ROOT, relativePath), 'utf8');
}

async function main() {
  const [manifestSource, schemaSource, pluginSource] = await Promise.all([
    read(BACKEND_MANIFEST),
    read(FRONTEND_SCHEMA),
    read(FRONTEND_PLUGIN),
  ]);

  const backendAdapterKey = parseAssignedString(manifestSource, 'adapterKey');
  const backendPlatformType = parseAssignedString(manifestSource, 'platformType');

  if (backendAdapterKey === null || backendPlatformType === null) {
    console.error(
      `check-subiekt-identity-mirror: could not read adapterKey / platformType from ${BACKEND_MANIFEST}. ` +
        `That file is the source of truth for this invariant, so the check cannot proceed.`
    );
    process.exit(1);
  }

  const violations = [
    ...diffIdentity('adapterKey', backendAdapterKey, [
      {
        label: `${FRONTEND_SCHEMA} (SUBIEKT_ADAPTER_KEY)`,
        value: parseAssignedString(schemaSource, 'SUBIEKT_ADAPTER_KEY'),
      },
    ]),
    ...diffIdentity('platformType', backendPlatformType, [
      {
        label: `${FRONTEND_SCHEMA} (toCreateConnectionInput)`,
        value: parseAssignedString(schemaSource, 'platformType'),
      },
      {
        label: `${FRONTEND_PLUGIN} (plugin.platformType)`,
        value: parseAssignedString(pluginSource, 'platformType'),
      },
      {
        label: `${FRONTEND_PLUGIN} (plugin.id)`,
        value: parseAssignedString(pluginSource, 'id'),
      },
    ]),
  ];

  if (violations.length > 0) {
    console.error('check-subiekt-identity-mirror: FAILED');
    for (const violation of violations) console.error(`  - ${violation}`);
    console.error(
      '\n  A drift here does not fail the build or any test. It fails when an operator ' +
        'clicks "add connection", minting a connection no adapter recognises.'
    );
    process.exit(1);
  }

  console.log(
    `check-subiekt-identity-mirror: OK (platformType '${backendPlatformType}', ` +
      `adapterKey '${backendAdapterKey}' identical across the manifest and 3 frontend copy/copies)`
  );
}

function selfCheck() {
  const assertions = [];
  const assert = (condition, label) => {
    assertions.push(label);
    if (!condition) {
      console.error(`check-subiekt-identity-mirror --self-check FAILED: ${label}`);
      process.exit(1);
    }
  };

  assert(
    parseAssignedString(`  platformType: 'subiekt-gt',`, 'platformType') === 'subiekt-gt',
    'reads an object-literal declaration'
  );
  assert(
    parseAssignedString(`export const SUBIEKT_ADAPTER_KEY = 'subiekt.gt.v1';`, 'SUBIEKT_ADAPTER_KEY') ===
      'subiekt.gt.v1',
    'reads a const declaration'
  );
  assert(
    parseAssignedString(`// platformType: 'subiekt' was the old value`, 'platformType') === null,
    'ignores a line comment quoting the retired value'
  );
  assert(
    parseAssignedString(`/**\n * platformType: 'subiekt'\n */`, 'platformType') === null,
    'ignores a block comment quoting the retired value'
  );
  assert(
    parseAssignedString(`const notPlatformType = 'x';`, 'platformType') === null,
    'does not match a longer identifier ending in the key name'
  );
  assert(
    parseAssignedString(`  platformType: 'a',`, 'adapterKey') === null,
    'returns null when the key is absent'
  );
  assert(
    diffIdentity('k', 'subiekt-gt', [{ label: 'x', value: 'subiekt-gt' }]).length === 0,
    'agreeing sites produce no violation'
  );
  assert(
    diffIdentity('k', 'subiekt-gt', [{ label: 'x', value: 'subiekt-nexo' }]).length === 1,
    'a drifted site is reported'
  );
  assert(
    diffIdentity('k', 'subiekt-gt', [{ label: 'x', value: 'subiekt' }]).length === 2,
    'a retired value is reported BOTH as a drift and as retired'
  );
  assert(
    diffIdentity('k', 'subiekt-gt', [{ label: 'x', value: null }]).length === 1,
    'a missing declaration is a violation, never a silent pass'
  );

  console.log(`check-subiekt-identity-mirror --self-check passed (${assertions.length} assertions)`);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  main().catch((error) => {
    console.error(`check-subiekt-identity-mirror: ${error.message}`);
    process.exit(1);
  });
}
