#!/usr/bin/env node
/**
 * check-cross-context-imports.mjs
 *
 * Lint-time invariant for the cross-context coupling policy documented at
 * docs/architecture-overview.md § Cross-context dependencies in core.
 *
 * Rule. Inside `libs/core/src/<ctx>/**`, when a file imports from
 * `@openlinker/core/<other-ctx>` (i.e. across a context boundary), the
 * imported symbols MUST be on the published-contract surface:
 *
 *   - `I*Service` service interfaces                  (e.g. IIntegrationsService)
 *   - `is*` capability type-guards                    (e.g. isOfferCreator)
 *   - `*Port` capability ports                        (e.g. OfferManagerPort)
 *   - `*Module` NestJS module classes                 (for `imports: [...]` only)
 *   - `*Exception` / `*Error` domain exceptions       (e.g. ConnectionNotFoundException)
 *   - `UPPER_SNAKE_CASE` constants (incl. *_TOKEN)    (e.g. CORE_ENTITY_TYPE, EVENT_PUBLISHER_TOKEN)
 *   - any other identifier (domain entities, value objects, plain types) —
 *     these are part of the contract surface and may be value-imported.
 *
 * Deny patterns (always rejected, including for value imports):
 *
 *   - `*RepositoryPort` — repository ports are intra-context; cross-context
 *     callers go through the service interface seam.
 *   - `*OrmEntity`      — TypeORM-decorated; infrastructure detail.
 *   - `*Adapter`        — adapter classes are infrastructure; sibling
 *                         contexts get behaviour via service interfaces.
 *   - `*Dto`            — application DTOs are owned by the source context.
 *   - default imports, namespace imports — barrels don't have defaults;
 *     wildcard introspection is reserved for the barrel-purity spec.
 *
 * The matcher fires ONLY on bare `@openlinker/core/<ctx>` (no subpath).
 * Documented sub-barrels (`/services`, `/orm-entities`, `/testing`) are
 * governed by separate ESLint rules in `.eslintrc.js` and are out of
 * scope here.
 *
 * Scope. Today the rule applies to `libs/core/src/<ctx>/**` only — that
 * matches the audit. Extending the same gate to `libs/integrations/**`
 * and `apps/{api,worker}/src/**` is tracked in #719.
 *
 * Allow-list. Pre-existing cross-context repository-port couplings
 * (10 production files + 10 spec mocks = 20 (file, symbol) entries) are
 * allow-listed here BY (file, symbol) pair until they're rewired through
 * the proper service-interface seam. Tracked in #718. Allow-listing a
 * path only silences the specific repository-port name listed against
 * it — any new deny-pattern import added to the same file still fails
 * the build. When a rewire ships, drop its entries together.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const coreSrc = join(repoRoot, 'libs', 'core', 'src');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.turbo',
]);

const VALID_EXTS = new Set(['.ts', '.tsx']);

/**
 * Per-(file, symbol) allow-list. Each entry exempts a single repository
 * port name on a single file. New deny-pattern imports added to one of
 * these files still fail the build — the gate is the specific name, not
 * the path. Grouped by rewire target so each rewire's entries drop
 * together when #718 lands its corresponding PR.
 */
const ALLOW_LIST = new Map([
  // (Slice 1 of #718 — products repository-port callers — rewired via
  // IProductsService and dropped from this list. See PR for #718.)

  // listings → sync.SyncJobRepositoryPort — rewire via ISyncJobsService
  [
    'libs/core/src/listings/application/services/offer-status-poll.service.ts',
    new Set(['SyncJobRepositoryPort']),
  ],
  [
    'libs/core/src/listings/application/services/__tests__/offer-status-poll.service.spec.ts',
    new Set(['SyncJobRepositoryPort']),
  ],

  // content → listings.OfferMappingRepositoryPort — rewire via IListingsService
  [
    'libs/core/src/content/application/services/content-state-reader.service.ts',
    new Set(['OfferMappingRepositoryPort']),
  ],
  [
    'libs/core/src/content/application/services/content-state-reader.service.spec.ts',
    new Set(['OfferMappingRepositoryPort']),
  ],
  [
    'libs/core/src/content/application/services/integrations-content-publisher.service.ts',
    new Set(['OfferMappingRepositoryPort']),
  ],
  [
    'libs/core/src/content/application/services/integrations-content-publisher.service.spec.ts',
    new Set(['OfferMappingRepositoryPort']),
  ],

  // ai → integrations.IntegrationCredentialRepositoryPort — rewire via ICredentialsService
  [
    'libs/core/src/ai/application/services/ai-provider-key.service.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],
  [
    'libs/core/src/ai/application/services/ai-provider-key.service.spec.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],
  [
    'libs/core/src/ai/infrastructure/adapters/credentials-ai-provider.adapter.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],
  [
    'libs/core/src/ai/infrastructure/adapters/credentials-ai-provider.adapter.spec.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],

  // orders → sync.ConnectionCursorRepositoryPort — rewire via ISyncCursorsService
  [
    'libs/core/src/orders/application/services/order-ingestion.service.ts',
    new Set(['ConnectionCursorRepositoryPort']),
  ],
  [
    'libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts',
    new Set(['ConnectionCursorRepositoryPort']),
  ],
]);

const DENY_PATTERNS = [
  /RepositoryPort$/,
  /OrmEntity$/,
  /Adapter$/,
  /Dto$/,
];

const ALLOW_PATTERNS = [
  /^I[A-Z][A-Za-z]*Service$/, // I*Service interfaces
  /^is[A-Z][A-Za-z]+$/, // is* capability guards
  /Port$/, // *Port (capability ports). Deny *RepositoryPort cases already short-circuited.
  /Module$/, // NestJS *Module
  /(Exception|Error)$/, // domain exceptions
  /^[A-Z][A-Z0-9_]+$/, // UPPER_SNAKE_CASE constants (incl. *_TOKEN)
];

/**
 * Parse all cross-context imports in a single file. Returns an array of
 * `{ line, source, kind, names }` records. Multi-line imports are
 * handled by reading the whole file and matching on the joined content,
 * then re-resolving line numbers from the match offset.
 */
function parseImports(content) {
  const records = [];
  const lineStartOffsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineStartOffsets.push(i + 1);
  }
  const offsetToLine = (offset) => {
    let lo = 0;
    let hi = lineStartOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStartOffsets[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  // The `<ctx>` capture's `[a-z-]+` between `/core/` and the closing
  // quote enforces the bare `@openlinker/core/<ctx>` shape — sub-barrels
  // like `/services`, `/orm-entities`, `/testing` (which carry an extra
  // `/` segment) are excluded by construction and governed by separate
  // ESLint rules in `.eslintrc.js`.
  const pattern =
    /import\s+(?<kind>type\s+)?(?:(?<default>[A-Za-z_$][\w$]*)|\*\s+as\s+(?<ns>[A-Za-z_$][\w$]*)|\{(?<named>[^}]+)\})\s*(?:from\s+)?['"](?<source>@openlinker\/core\/[a-z-]+)['"]/gs;

  let m;
  while ((m = pattern.exec(content)) !== null) {
    const line = offsetToLine(m.index);
    const source = m.groups.source;
    if (m.groups.named !== undefined) {
      const names = m.groups.named
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => n.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim());
      records.push({ line, source, kind: m.groups.kind ? 'type-named' : 'named', names });
    } else if (m.groups.default !== undefined) {
      records.push({ line, source, kind: 'default', names: [m.groups.default] });
    } else if (m.groups.ns !== undefined) {
      records.push({ line, source, kind: 'namespace', names: [m.groups.ns] });
    }
  }
  return records;
}

/**
 * Classify a single imported name. Deny patterns are checked first, then
 * allow patterns. Unrecognized names are default-allowed — they're
 * treated as domain entities / value objects / plain types, which are
 * part of the published contract surface and may be value-imported.
 */
function classifyName(name) {
  for (const pat of DENY_PATTERNS) {
    if (pat.test(name)) return { allowed: false, reason: `matches deny pattern ${pat.source}` };
  }
  for (const pat of ALLOW_PATTERNS) {
    if (pat.test(name)) return { allowed: true };
  }
  return { allowed: true };
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await walk(join(dir, entry.name))));
    } else if (entry.isFile()) {
      if (VALID_EXTS.has('.' + entry.name.split('.').pop())) {
        files.push(join(dir, entry.name));
      }
    }
  }
  return files;
}

function importerContext(repoRelPath) {
  // libs/core/src/<ctx>/...
  const parts = repoRelPath.split(sep);
  if (parts.length < 4 || parts[0] !== 'libs' || parts[1] !== 'core' || parts[2] !== 'src') return null;
  return parts[3];
}

function targetContext(source) {
  return source.replace(/^@openlinker\/core\//, '');
}

async function main() {
  const files = await walk(coreSrc);
  let totalImports = 0;
  let checkedFiles = 0;
  const violations = [];

  for (const file of files) {
    const repoRel = relative(repoRoot, file);
    const myCtx = importerContext(repoRel);
    if (!myCtx) continue;
    checkedFiles += 1;

    const content = await readFile(file, 'utf8');
    const imports = parseImports(content);

    for (const imp of imports) {
      const tgtCtx = targetContext(imp.source);
      if (tgtCtx === myCtx) continue; // same-context, not a cross-context import
      totalImports += 1;

      // Default / namespace imports are denied outright (no allow-list
      // exception today — barrel-purity tests live outside libs/core/src).
      if (imp.kind === 'default') {
        violations.push({
          file: repoRel,
          line: imp.line,
          source: imp.source,
          symbol: imp.names[0],
          reason: 'default imports are not part of the cross-context contract surface (barrels have no default export)',
        });
        continue;
      }
      if (imp.kind === 'namespace') {
        violations.push({
          file: repoRel,
          line: imp.line,
          source: imp.source,
          symbol: `* as ${imp.names[0]}`,
          reason: 'wildcard imports are reserved for barrel-purity tests; everywhere else use named imports',
        });
        continue;
      }

      const allowedForFile = ALLOW_LIST.get(repoRel);
      for (const name of imp.names) {
        const cls = classifyName(name);
        if (!cls.allowed) {
          if (allowedForFile?.has(name)) continue; // pre-existing, tracked in #718
          violations.push({
            file: repoRel,
            line: imp.line,
            source: imp.source,
            symbol: name,
            reason: cls.reason,
          });
        }
      }
    }
  }

  const allowListEntryCount = Array.from(ALLOW_LIST.values()).reduce(
    (sum, set) => sum + set.size,
    0,
  );

  if (violations.length === 0) {
    console.log(
      `✓ check-cross-context-imports: ${totalImports} cross-context import(s) across ${checkedFiles} file(s). All conform.`,
    );
    if (allowListEntryCount > 0) {
      console.log(
        `  (${allowListEntryCount} pre-existing (file, symbol) entries allow-listed across ${ALLOW_LIST.size} file(s); see script header and #718.)`,
      );
    }
    process.exit(0);
  }

  console.error(`✗ check-cross-context-imports: ${violations.length} violation(s).\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    import: { ${v.symbol} } from '${v.source}'`);
    console.error(`    rule:   ${v.reason}`);
    console.error(`    docs:   docs/architecture-overview.md#cross-context-dependencies-in-core`);
    console.error('');
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('check-cross-context-imports: fatal error:', err);
  process.exit(1);
});
