#!/usr/bin/env node
/**
 * Design Token Drift Guard (#611)
 *
 * Cross-checks the typed `tokens` catalog at
 * `apps/web/src/shared/theme/tokens.ts` against the CSS custom-property
 * declarations in `apps/web/src/index.css`. Fails fast on any token in
 * the catalog that is NOT declared in CSS — that would silently break
 * plugin authors importing the token and getting `undefined` at runtime.
 *
 * Direction: catalog → CSS (one-directional in v1). Orphaned `--*-*`
 * declarations in CSS that aren't in the catalog are tolerated today —
 * they may be internal-only or pre-public surface. A future tightening
 * can add the reverse check with an opt-out list.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain.
 *
 * Exits non-zero on drift, with one line per orphaned token name.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const TOKENS_FILE = resolve(ROOT, 'apps/web/src/shared/theme/tokens.ts');
const CSS_FILE = resolve(ROOT, 'apps/web/src/index.css');

// Catches every `'<name>': 'var(--<name>)',` entry in the catalog.
const CATALOG_ENTRY_RE = /'([a-zA-Z0-9-]+)':\s*'var\(--([a-zA-Z0-9-]+)\)'/g;
// Catches `--<name>:` declarations in CSS (the LHS of any var declaration).
const CSS_DECL_RE = /--([a-zA-Z0-9-]+)\s*:/g;

function extractCatalogTokens() {
  const source = readFileSync(TOKENS_FILE, 'utf8');
  const tokens = new Map(); // key → cssName (should match)
  let match;
  while ((match = CATALOG_ENTRY_RE.exec(source)) !== null) {
    const [, key, cssName] = match;
    if (key !== cssName) {
      // Catalog invariant: the object key MUST match the CSS variable
      // name. Mismatch is a bug — fail loud.
      throw new Error(
        `tokens.ts entry mismatch: key '${key}' references 'var(--${cssName})' — keys must match the CSS variable name exactly`,
      );
    }
    tokens.set(key, cssName);
  }
  return tokens;
}

function extractCssDeclarations() {
  const source = readFileSync(CSS_FILE, 'utf8');
  const declarations = new Set();
  let match;
  while ((match = CSS_DECL_RE.exec(source)) !== null) {
    declarations.add(match[1]);
  }
  return declarations;
}

function main() {
  const catalog = extractCatalogTokens();
  const cssDecls = extractCssDeclarations();

  const orphans = [];
  for (const tokenName of catalog.keys()) {
    if (!cssDecls.has(tokenName)) {
      orphans.push(tokenName);
    }
  }

  if (catalog.size === 0) {
    console.error('design-tokens: catalog is empty — tokens.ts found no entries');
    process.exit(1);
  }

  if (orphans.length > 0) {
    console.error(
      `design-tokens: ${orphans.length} catalog entr${orphans.length === 1 ? 'y' : 'ies'} missing from apps/web/src/index.css:`,
    );
    for (const name of orphans) {
      console.error(`  --${name}`);
    }
    console.error(
      `\nEither declare the missing token(s) in index.css or remove the catalog entry.`,
    );
    process.exit(1);
  }

  console.log(`design-tokens: OK (${catalog.size} tokens, all declared in index.css)`);
}

main();
