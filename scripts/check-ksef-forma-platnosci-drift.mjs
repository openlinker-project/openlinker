#!/usr/bin/env node
/**
 * TFormaPlatnosci Declaration Drift Guard (#1311)
 *
 * The FA(3) `TFormaPlatnosci` code list (`'1'..'7'`) is declared three times
 * by design — plugin connection-config layer, FA3 schema layer, and the FE
 * setup schema in `apps/web` — with cross-reference comments at each site.
 * This script makes the "add the 8th code in all three places" instruction
 * self-enforcing at the repo level (PR #1317 review): the KSeF package's own
 * jest suite compares the two in-package arrays by import, while the FE array
 * lives in a different workspace package — asserting it from a backend jest
 * suite required a 7-level relative path into `apps/web`, coupling the plugin
 * package's tests to the monorepo layout. Repo-root invariants are exactly
 * what the `check:invariants` family is for, so the cross-package comparison
 * lives here instead.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain.
 *
 * Exits non-zero when any declaration is missing (moved/renamed) or when the
 * three value lists diverge.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const DECLARATIONS = [
  {
    file: 'libs/integrations/ksef/src/domain/types/ksef-connection.types.ts',
    constName: 'KsefFormaPlatnosciValues',
  },
  {
    file: 'libs/integrations/ksef/src/infrastructure/fa3/domain/fa3-schema.types.ts',
    constName: 'Fa3FormaPlatnosciValues',
  },
  {
    file: 'apps/web/src/plugins/ksef/components/ksef-setup.schema.ts',
    constName: 'KSEF_FORMA_PLATNOSCI_VALUES',
  },
];

function extractValues({ file, constName }) {
  const source = readFileSync(resolve(ROOT, file), 'utf8');
  // Tolerant of an optional type annotation, arbitrary whitespace, and a
  // Prettier multi-line wrap of the array (the `[^\]]` char class matches
  // newlines) — PR #1317 review flagged the earlier single-line-only shape
  // as brittle once an 8th code makes the array wrap.
  const match = source.match(
    new RegExp(
      `export const ${constName}(?:\\s*:[^=]+?)?\\s*=\\s*\\[([^\\]]*)\\]\\s*as const;`,
    ),
  );
  if (match === null) {
    console.error(
      `check-ksef-forma-platnosci-drift: declaration \`${constName}\` not found in ${file} — ` +
        'if it moved or was renamed, update DECLARATIONS in this script.',
    );
    process.exit(1);
  }
  return match[1]
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .map((token) => token.trim().replace(/^'(.*)'$/, '$1'))
    .filter((token) => token.length > 0);
}

const [reference, ...rest] = DECLARATIONS.map((decl) => ({
  ...decl,
  values: extractValues(decl),
}));

let drifted = false;
for (const decl of rest) {
  if (JSON.stringify(decl.values) !== JSON.stringify(reference.values)) {
    drifted = true;
    console.error(
      `check-ksef-forma-platnosci-drift: ${decl.constName} (${decl.file}) = [${decl.values.join(', ')}] ` +
        `diverges from ${reference.constName} (${reference.file}) = [${reference.values.join(', ')}]. ` +
        'A TFormaPlatnosci code must be added/removed in all three declaration sites.',
    );
  }
}

if (drifted) {
  process.exit(1);
}
