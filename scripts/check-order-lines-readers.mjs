#!/usr/bin/env node
/**
 * check-order-lines-readers.mjs
 *
 * Lint-time invariant for ADR-083 decision 9 (#3607): an order has a COMMERCIAL
 * line list (`order.items`, what the buyer paid for) and a PHYSICAL one
 * (`OrderRecord.physicalItems`, bundles expanded to components). Every stock,
 * reservation, routing and decrement site must read the physical list.
 *
 * The failure this guards is silent: a site still reading `order.items` for
 * stock treats "no row matched a component line" as a normal outcome, so a
 * bundle order reserves, routes or decrements the bundle SKU instead of its
 * components and nothing throws. The compiler cannot see it, so the build does.
 *
 * HOW. Every production file that reads the commercial lines
 * (`order.items`, `.orderItems`, `orderSnapshot.items`) must be listed in
 * ALLOWED with the reason it keeps commercial grain (ADR-083 decision 8). A new
 * file that reads them fails until its author either switches to
 * `physicalItems` (a stock site) or adds an entry here with a reason (a
 * commercial site: documents, margin, returns line resolution, the destination
 * mirror, ...). A stale entry - a file that no longer reads the lines, or no
 * longer exists - fails too, so the list cannot become a standing licence.
 *
 * TEXTUAL, like its siblings: comment lines are skipped, no TypeScript parse.
 * Tests, fixtures and migrations are out of scope.
 *
 * Usage:
 *   node scripts/check-order-lines-readers.mjs
 *   node scripts/check-order-lines-readers.mjs --self-check
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SCAN_ROOTS = [
  'libs/core/src',
  'libs/oms/src',
  'apps/api/src',
  'apps/worker/src',
];

const READS_COMMERCIAL_LINES =
  /\b(?:order|channelOrder|incoming)\.items\b|\.orderItems\b|\b(?:orderSnapshot|snapshot)\??\.items\b/;

const COMMERCIAL = {
  document: 'documents keep the commercial grain (ADR-083 decision 8)',
  returns: 'return line resolution keeps the commercial grain (ADR-083 decision 8)',
  projection: 'a commercial projection of the order: what the buyer bought',
  analytics: 'order_line_items / margin / analytics keep the commercial grain (decision 8)',
  edit: 'the operator edit overlay works on the commercial lines; its follow-ups fan out via componentLineIdsOf',
  shipment: 'shipment_lines coverage is joined back to the snapshot items (decision 8)',
  entity: 'the OrderRecord / snapshot plumbing that DEFINES the two lists',
};

/** file (repo-relative, posix) -> why it may read the commercial lines. */
export const ALLOWED = new Map([
  ['apps/api/src/bench/application/services/bench-parcel.service.ts', 'reads the bundle line NAME the buyer saw to head a bundle group at the bench (#3624); the grouping itself comes from the frozen expansion'],
  ['apps/api/src/mcp/tools/read/get-order.tool.ts', COMMERCIAL.projection],
  ['apps/api/src/orders/application/services/order-edit.service.ts', COMMERCIAL.edit],
  ['apps/api/src/orders/http/dto/edit-order-request.dto.ts', COMMERCIAL.edit],
  ['apps/api/src/returns/http/return-writes.controller.ts', COMMERCIAL.returns],
  ['apps/worker/src/sync/return-order-line-resolver.service.ts', COMMERCIAL.returns],
  ['libs/core/src/fiscalization/application/mappers/order-to-register-transaction-command.mapper.ts', COMMERCIAL.document],
  ['libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.ts', COMMERCIAL.document],
  ['libs/core/src/invoicing/application/services/auto-issue-trigger.service.ts', COMMERCIAL.document],
  ['libs/core/src/listings/application/services/offer-stock-restore.service.ts', 'cancellation restore: commercial variants stay, physical ones are added (#3931 owns bundle offers)'],
  ['libs/core/src/orders/application/services/order-ingestion.service.ts', 'ingestion: resolves the commercial lines, freezes the expansion, mirrors to destinations, snapshots cost'],
  ['libs/core/src/orders/application/services/order-line-cost.service.ts', 'the cost snapshot at ingestion (decision 8)'],
  ['libs/core/src/orders/application/services/order-record.service.ts', COMMERCIAL.entity],
  ['libs/core/src/orders/application/services/order-source-amendment-effects.service.ts', 'compares the source\'s commercial lines with the work; bundle lines are folded to commercial grain by assessForEdit and fanned out to components by componentsOfLine (ADR-083)'],
  ['libs/core/src/orders/application/services/order-sync.service.ts', 'the destination mirror sends order.items as they are (decision 8); stock steps use physicalProductIds'],
  ['libs/core/src/orders/domain/entities/order-record.entity.ts', COMMERCIAL.entity],
  ['libs/core/src/orders/domain/order-amendment-diff.ts', 'the amendment diff compares commercial lines (decision 8)'],
  ['libs/core/src/orders/domain/order-analytics-projection.ts', COMMERCIAL.analytics],
  ['libs/core/src/orders/domain/order-export-columns.ts', COMMERCIAL.projection],
  ['libs/core/src/orders/domain/order-from-ready-snapshot.ts', COMMERCIAL.entity],
  ['libs/core/src/orders/domain/order-search-text.ts', COMMERCIAL.projection],
  ['libs/core/src/orders/domain/order-summary-projection.ts', COMMERCIAL.projection],
  ['libs/core/src/orders/domain/types/order-edits.types.ts', COMMERCIAL.edit],
  ['libs/core/src/sales-documents/domain/types/gross-price-eligibility.types.ts', COMMERCIAL.document],
  ['libs/core/src/sales-documents/domain/types/shipping-tax-split.types.ts', COMMERCIAL.document],
  ['libs/core/src/shipping/application/services/shipment-line.service.ts', COMMERCIAL.shipment],
]);

const isTestFile = (path) =>
  /\.(spec|int-spec|e2e-spec)\.ts$/.test(path) ||
  path.includes('/__tests__/') ||
  path.includes('/testing/') ||
  path.includes('/migrations/') ||
  path.includes('/dist/') ||
  path.includes('/node_modules/');

/** True when a non-comment line of `source` reads the commercial lines. */
export function readsCommercialLines(source) {
  return source.split('\n').some((line) => {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false;
    return READS_COMMERCIAL_LINES.test(line);
  });
}

/** Pure verdict over `{path -> source}` and an allowlist; returns the failure messages. */
export function evaluate(sources, allowed) {
  const failures = [];
  const reading = new Set();
  for (const [path, source] of sources) {
    if (readsCommercialLines(source)) reading.add(path);
  }
  for (const path of reading) {
    if (!allowed.has(path)) {
      failures.push(
        `${path}: reads the commercial order lines (order.items / orderItems / orderSnapshot.items). ` +
          'A stock, reservation, routing or decrement site must read OrderRecord.physicalItems (ADR-083). ' +
          'A commercial-grain site must be added to ALLOWED in scripts/check-order-lines-readers.mjs with a reason.',
      );
    }
  }
  for (const path of allowed.keys()) {
    if (!reading.has(path)) {
      failures.push(
        `${path}: listed in ALLOWED but no longer reads the commercial order lines (or no longer exists). Remove the entry.`,
      );
    }
  }
  return failures;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) yield full;
  }
}

async function collect() {
  const sources = new Map();
  for (const root of SCAN_ROOTS) {
    for await (const file of walk(join(repoRoot, root))) {
      const rel = relative(repoRoot, file).split(sep).join('/');
      if (isTestFile(rel)) continue;
      sources.set(rel, await readFile(file, 'utf8'));
    }
  }
  return sources;
}

function selfCheck() {
  const stock = "const lines = order.items.map((i) => i.id);";
  const physical = 'const lines = record.physicalItems.map((i) => i.id);';
  const commented = ' * the order.items stay commercial';
  const cases = [
    ['a new stock reader fails', evaluate(new Map([['a.ts', stock]]), new Map()).length === 1],
    ['physicalItems passes', evaluate(new Map([['a.ts', physical]]), new Map()).length === 0],
    ['an allowed reader passes', evaluate(new Map([['a.ts', stock]]), new Map([['a.ts', 'why']])).length === 0],
    ['a stale entry fails', evaluate(new Map([['a.ts', physical]]), new Map([['a.ts', 'why']])).length === 1],
    ['a comment does not count', evaluate(new Map([['a.ts', commented]]), new Map()).length === 0],
    ['orderSnapshot.items counts', readsCommercialLines('const x = record.orderSnapshot.items;')],
    ['.orderItems counts', readsCommercialLines('record.orderItems.map(f)')],
  ];
  const bad = cases.filter(([, ok]) => !ok);
  for (const [name] of bad) console.error(`self-check FAILED: ${name}`);
  if (bad.length > 0) process.exit(1);
  console.log(`check-order-lines-readers self-check: ${cases.length} cases ok`);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else if (process.argv[1] && process.argv[1].endsWith('check-order-lines-readers.mjs')) {
  const failures = evaluate(await collect(), ALLOWED);
  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  console.log('check-order-lines-readers: ok');
}
