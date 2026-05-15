#!/usr/bin/env node
/**
 * check-cross-context-imports.mjs
 *
 * Lint-time invariant for the cross-context coupling policy documented at
 * docs/architecture-overview.md § Cross-context dependencies in core.
 *
 * Rule. When a file imports from `@openlinker/core/<ctx>` and the file
 * is in a scope this script walks (`libs/core/src/<ctx>/**`,
 * `libs/integrations/**`, `apps/{api,worker}/**`), the imported symbols
 * MUST be on the published-contract surface:
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
 * Scope. The walker descends into:
 *   - `libs/core/src/<ctx>/**`                          (#713/#721)
 *   - `libs/integrations/<plugin>/**`                   (#719)
 *   - `apps/{api,worker}/**` (covers src + integration tests)  (#719)
 *
 * Same-context skip applies ONLY when the importer is under
 * `libs/core/src/<ctx>/` — plugins and host apps have no "context" they
 * could match against, so every `@openlinker/core/<ctx>` import from
 * those scopes is by definition cross-context and is always checked.
 *
 * `libs/plugin-sdk/src/**` is out of scope today (no current violations);
 * extending the walker if a violation surfaces is a one-line change.
 *
 * Allow-list. Pre-existing cross-context repository-port couplings are
 * allow-listed here BY (file, symbol) pair until they're rewired through
 * the proper service-interface seam:
 *   - Core-to-core entries → tracked in #718.
 *   - Plugin + app entries → tracked in #722 (filed alongside #719).
 * Allow-listing a path only silences the specific repository-port name
 * listed against it — any new deny-pattern import added to the same
 * file still fails the build. When a rewire ships, drop its entries
 * together.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

/**
 * Directory roots the walker descends into. Each entry is a path-segment
 * tuple resolved against `repoRoot`. Same-context skip applies only to
 * files under `libs/core/src/` (see `importerScope` below).
 */
const WALKER_ROOTS = [
  ['libs', 'core', 'src'],
  ['libs', 'integrations'],
  ['apps', 'api'],
  ['apps', 'worker'],
];

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
 * together when its corresponding PR lands (core-scope: #718; plugin +
 * app scope: #722).
 */
const ALLOW_LIST = new Map([
  // (Slice 1 of #718 — products repository-port callers — rewired via
  // IProductsService and dropped from this list. See PR for #718.)
  // ─── Core-scope (#713/#721) — tracked in #718 ───────────────────────

  // inventory → products.ProductRepositoryPort — rewire via IProductsService
  [
    'libs/core/src/inventory/application/services/inventory-query.service.ts',
    new Set(['ProductRepositoryPort']),
  ],
  [
    'libs/core/src/inventory/application/services/__tests__/inventory-query.service.spec.ts',
    new Set(['ProductRepositoryPort']),
  ],

  // orders → products.ProductVariantRepositoryPort — rewire via IProductsService
  [
    'libs/core/src/orders/application/services/order-item-ref-resolver.service.ts',
    new Set(['ProductVariantRepositoryPort']),
  ],
  [
    'libs/core/src/orders/application/services/__tests__/order-item-ref-resolver.service.spec.ts',
    new Set(['ProductVariantRepositoryPort']),
  ],

  // listings → products.ProductVariantRepositoryPort — rewire via IProductsService
  [
    'libs/core/src/listings/application/services/offer-mapping-sync.service.ts',
    new Set(['ProductVariantRepositoryPort']),
  ],
  [
    'libs/core/src/listings/application/services/__tests__/offer-mapping-sync.service.spec.ts',
    new Set(['ProductVariantRepositoryPort']),
  ],
  [
    'libs/core/src/listings/application/services/offer-builder.service.ts',
    new Set(['ProductVariantRepositoryPort']),
  ],
  [
    'libs/core/src/listings/application/services/__tests__/offer-builder.service.spec.ts',
    new Set(['ProductVariantRepositoryPort']),
  ],

  // (Slice 2 of #718 — sync repository-port callers — rewired via
  // ISyncJobsService + ISyncCursorsService and dropped from this list.
  // See PR for #718 slice 2.)

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

  // ─── Plugins + apps (#719) — tracked in #722 ────────────────────────

  // apps → users.UserRepositoryPort — rewire via IUsersService
  ['apps/api/src/auth/auth.service.ts', new Set(['UserRepositoryPort'])],
  ['apps/api/src/auth/auth.service.spec.ts', new Set(['UserRepositoryPort'])],
  ['apps/api/src/auth/bootstrap-admin.service.ts', new Set(['UserRepositoryPort'])],
  ['apps/api/src/auth/bootstrap-admin.service.spec.ts', new Set(['UserRepositoryPort'])],

  // apps → users.PasswordResetTokenRepositoryPort + UserRepositoryPort — rewire via IUsersService
  [
    'apps/api/src/auth/password-reset.service.ts',
    new Set(['PasswordResetTokenRepositoryPort', 'UserRepositoryPort']),
  ],
  [
    'apps/api/src/auth/password-reset.service.spec.ts',
    new Set(['PasswordResetTokenRepositoryPort', 'UserRepositoryPort']),
  ],

  // apps → users.RefreshTokenRepositoryPort — rewire via IUsersService
  ['apps/api/src/auth/refresh-token.service.ts', new Set(['RefreshTokenRepositoryPort'])],
  ['apps/api/src/auth/refresh-token.service.spec.ts', new Set(['RefreshTokenRepositoryPort'])],

  // apps + worker → sync.SyncJobRepositoryPort — rewire via ISyncJobsService
  ['apps/api/src/integrations/http/connection.controller.ts', new Set(['SyncJobRepositoryPort'])],
  [
    'apps/api/src/integrations/http/connection.controller.spec.ts',
    new Set(['SyncJobRepositoryPort']),
  ],
  ['apps/api/src/sync/http/sync.controller.ts', new Set(['SyncJobRepositoryPort'])],
  ['apps/api/src/sync/http/sync.controller.spec.ts', new Set(['SyncJobRepositoryPort'])],
  ['apps/worker/src/sync/job-intake.consumer.ts', new Set(['SyncJobRepositoryPort'])],
  [
    'apps/worker/src/sync/__tests__/job-intake.consumer.spec.ts',
    new Set(['SyncJobRepositoryPort']),
  ],
  ['apps/worker/src/sync/sync-job.runner.ts', new Set(['SyncJobRepositoryPort'])],
  ['apps/worker/src/sync/__tests__/sync-job.runner.spec.ts', new Set(['SyncJobRepositoryPort'])],
  [
    'apps/worker/test/integration/allegro-offer-quantity-update-e2e.int-spec.ts',
    new Set(['SyncJobRepositoryPort']),
  ],
  [
    'apps/worker/test/integration/job-intake-execution.int-spec.ts',
    new Set(['SyncJobRepositoryPort']),
  ],
  [
    'apps/worker/test/integration/marketplace-offers-sync-e2e.int-spec.ts',
    new Set(['SyncJobRepositoryPort']),
  ],
  [
    'apps/worker/test/integration/master-inventory-sync-all-e2e.int-spec.ts',
    new Set(['SyncJobRepositoryPort']),
  ],
  [
    'apps/worker/test/integration/product-sync-e2e.int-spec.ts',
    new Set(['SyncJobRepositoryPort']),
  ],

  // apps + worker → sync.ConnectionCursorRepositoryPort — rewire via ISyncCursorsService
  ['apps/api/src/cursors/http/cursors.controller.ts', new Set(['ConnectionCursorRepositoryPort'])],
  [
    'apps/api/src/cursors/http/cursors.controller.spec.ts',
    new Set(['ConnectionCursorRepositoryPort']),
  ],
  ['apps/api/src/integrations/http/allegro.controller.ts', new Set(['ConnectionCursorRepositoryPort'])],
  [
    'apps/api/src/integrations/http/allegro.controller.spec.ts',
    new Set(['ConnectionCursorRepositoryPort']),
  ],
  [
    'apps/worker/src/sync/handlers/marketplace-offers-sync.handler.ts',
    new Set(['ConnectionCursorRepositoryPort']),
  ],
  [
    'apps/worker/src/sync/handlers/__tests__/marketplace-offers-sync.handler.spec.ts',
    new Set(['ConnectionCursorRepositoryPort']),
  ],

  // worker → sync.{SyncJobRepositoryPort + ConnectionCursorRepositoryPort} — rewire via ISyncJobsService + ISyncCursorsService
  [
    'apps/worker/test/integration/allegro-cursor-persistence.int-spec.ts',
    new Set(['SyncJobRepositoryPort', 'ConnectionCursorRepositoryPort']),
  ],
  [
    'apps/worker/test/integration/allegro-order-sync-e2e.int-spec.ts',
    new Set(['SyncJobRepositoryPort', 'ConnectionCursorRepositoryPort']),
  ],

  // apps → webhooks.WebhookDeliveryRepositoryPort — rewire via IWebhooksService
  [
    'apps/api/src/webhooks/application/handlers/webhook-to-job.handler.ts',
    new Set(['WebhookDeliveryRepositoryPort']),
  ],
  [
    'apps/api/src/webhooks/application/services/webhook-delivery-query.service.ts',
    new Set(['WebhookDeliveryRepositoryPort']),
  ],
  [
    'apps/api/src/webhooks/application/services/__tests__/webhook-delivery-query.service.spec.ts',
    new Set(['WebhookDeliveryRepositoryPort']),
  ],
  [
    'apps/api/src/webhooks/application/services/webhook.service.ts',
    new Set(['WebhookDeliveryRepositoryPort']),
  ],
  [
    'apps/api/src/webhooks/application/services/webhook.service.spec.ts',
    new Set(['WebhookDeliveryRepositoryPort']),
  ],

  // apps + plugin → integrations.IntegrationCredentialRepositoryPort — rewire via ICredentialsService
  [
    'apps/api/src/integrations/application/services/allegro-oauth.service.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],
  [
    'apps/api/src/integrations/application/services/allegro-oauth.service.spec.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],
  [
    'apps/api/src/integrations/application/services/connection.service.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],
  [
    'apps/api/src/integrations/application/services/connection.service.spec.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],
  [
    'apps/api/test/integration/ai-provider-settings.int-spec.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],
  [
    'apps/api/test/integration/connection-credentials.int-spec.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],
  [
    'libs/integrations/allegro/src/allegro-integration.module.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],
  [
    'libs/integrations/allegro/src/infrastructure/token-refresh/allegro-token-refresh.service.ts',
    new Set(['IntegrationCredentialRepositoryPort']),
  ],

  // apps + plugin → customers.CustomerProjectionRepositoryPort — rewire via ICustomersService
  [
    'apps/api/src/customers/http/customers.controller.ts',
    new Set(['CustomerProjectionRepositoryPort']),
  ],
  [
    'apps/api/src/customers/http/customers.controller.spec.ts',
    new Set(['CustomerProjectionRepositoryPort']),
  ],
  [
    'apps/worker/test/integration/allegro-masked-email-identity.int-spec.ts',
    new Set(['CustomerProjectionRepositoryPort']),
  ],
  [
    'libs/integrations/prestashop/src/prestashop-plugin.ts',
    new Set(['CustomerProjectionRepositoryPort']),
  ],
  [
    'libs/integrations/prestashop/src/__tests__/prestashop-plugin.spec.ts',
    new Set(['CustomerProjectionRepositoryPort']),
  ],
  [
    'libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts',
    new Set(['CustomerProjectionRepositoryPort']),
  ],
  [
    'libs/integrations/prestashop/src/prestashop-integration.module.ts',
    new Set(['CustomerProjectionRepositoryPort']),
  ],
  [
    'libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts',
    new Set(['CustomerProjectionRepositoryPort']),
  ],
  [
    'libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-order-processor-manager.adapter.spec.ts',
    new Set(['CustomerProjectionRepositoryPort']),
  ],
  [
    'libs/integrations/prestashop/src/infrastructure/provisioners/prestashop-address-provisioner.ts',
    new Set(['CustomerProjectionRepositoryPort']),
  ],
  [
    'libs/integrations/prestashop/src/infrastructure/provisioners/__tests__/prestashop-address-provisioner.spec.ts',
    new Set(['CustomerProjectionRepositoryPort']),
  ],

  // apps → orders.OrderRecordRepositoryPort — rewire via IOrdersService
  ['apps/api/src/orders/http/orders.controller.ts', new Set(['OrderRecordRepositoryPort'])],
  ['apps/api/src/orders/http/orders.controller.spec.ts', new Set(['OrderRecordRepositoryPort'])],
  [
    'apps/api/test/integration/order-record-attempts.int-spec.ts',
    new Set(['OrderRecordRepositoryPort']),
  ],

  // apps → products.{ProductRepositoryPort, ProductVariantRepositoryPort} — rewire via IProductsService
  ['apps/api/test/integration/products-read.int-spec.ts', new Set(['ProductRepositoryPort'])],

  // apps → listings.{OfferMappingRepositoryPort, OfferCreationRecordRepositoryPort} +
  //        products.ProductVariantRepositoryPort — rewire via IListingsService + IProductsService
  [
    'apps/api/src/listings/http/listings.controller.ts',
    new Set([
      'OfferCreationRecordRepositoryPort',
      'OfferMappingRepositoryPort',
      'ProductVariantRepositoryPort',
    ]),
  ],
  [
    'apps/api/src/listings/http/listings.controller.spec.ts',
    new Set([
      'OfferCreationRecordRepositoryPort',
      'OfferMappingRepositoryPort',
      'ProductVariantRepositoryPort',
    ]),
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

/**
 * Classify the importer's scope. Returns:
 *   - `{ kind: 'core', ctx }`         — `libs/core/src/<ctx>/...`
 *   - `{ kind: 'integration', plugin }` — `libs/integrations/<plugin>/...`
 *   - `{ kind: 'app', app }`          — `apps/api/...` or `apps/worker/...`
 *   - `null`                          — file is outside any walked scope
 *
 * Same-context skip is gated on `kind === 'core'` in main().
 */
function importerScope(repoRelPath) {
  const parts = repoRelPath.split(sep);
  if (parts.length >= 4 && parts[0] === 'libs' && parts[1] === 'core' && parts[2] === 'src') {
    return { kind: 'core', ctx: parts[3] };
  }
  if (parts.length >= 3 && parts[0] === 'libs' && parts[1] === 'integrations') {
    return { kind: 'integration', plugin: parts[2] };
  }
  if (parts.length >= 2 && parts[0] === 'apps' && (parts[1] === 'api' || parts[1] === 'worker')) {
    return { kind: 'app', app: parts[1] };
  }
  return null;
}

function targetContext(source) {
  return source.replace(/^@openlinker\/core\//, '');
}

async function main() {
  const files = [];
  for (const root of WALKER_ROOTS) {
    files.push(...(await walk(join(repoRoot, ...root))));
  }
  let totalImports = 0;
  let checkedFiles = 0;
  const violations = [];

  for (const file of files) {
    const repoRel = relative(repoRoot, file);
    const myScope = importerScope(repoRel);
    if (!myScope) continue;
    checkedFiles += 1;

    const content = await readFile(file, 'utf8');
    const imports = parseImports(content);

    for (const imp of imports) {
      const tgtCtx = targetContext(imp.source);
      // Same-context skip applies only when the importer is core — plugins
      // and apps have no counterpart context to match against.
      if (myScope.kind === 'core' && tgtCtx === myScope.ctx) continue;
      totalImports += 1;

      // Default / namespace imports are denied outright (no allow-list
      // exception today — barrel-purity tests live outside the walked scopes).
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
          if (allowedForFile?.has(name)) continue; // pre-existing, tracked in #718 (core) or #722 (plugins/apps)
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
        `  (${allowListEntryCount} pre-existing (file, symbol) entries allow-listed across ${ALLOW_LIST.size} file(s); see script header, #718, and #722.)`,
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
