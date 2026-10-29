/**
 * G11 CSV - server-side CSV export (#3589, #3590; M26 `export-*`)
 *
 * Four reports (sales by channel, top products, margin by channel, margin by
 * product), each the same query as its JSON route with `format=csv`. The file
 * is parsed and compared with the JSON the screen is built from, and with the
 * rendered tables, for the same filters. Format rules: comma, UTF-8 BOM,
 * `# key: value` header lines, at most 366 days per file.
 *
 * CSV-7 is the second place SQL is used to seed (decision): it adds synthetic
 * order lines so a 366-day export has thousands of rows, then removes them.
 *
 * @module tests/oms-mvp/g11
 */
import { execFileSync } from 'node:child_process';
import { test, expect } from '../../../src/fixtures/g11';
import { parseCsv, type ParsedCsv } from '../../../src/support/g11/csv';
import type { G11Http, G11Response } from '../../../src/support/g11/http';
import { MarginPanelPage, type ExportReport } from '../../../src/pages/margin-panel.page';
import { liveWindow, utcDay, windowOfDays } from '../../../src/support/g11/ranges';
import type { MarginFig } from '../../../src/support/g11/cost';

type Range = { from: string; to: string };

const REPORTS: Record<ExportReport, { path: string; filename: RegExp }> = {
  'sales-channel': { path: '/analytics/sales', filename: /^openlinker_sales-by-channel_/ },
  'top-products': { path: '/analytics/top-products', filename: /^openlinker_top-products_/ },
  'margin-channel': { path: '/analytics/margin', filename: /^openlinker_margin-by-channel_/ },
  'margin-product': { path: '/analytics/margin/products', filename: /^openlinker_margin-by-product_/ },
};

const csvOf = (http: G11Http, report: ExportReport, range: Range, extra: Record<string, string | number | undefined> = {}): Promise<G11Response> =>
  http.get(REPORTS[report].path, { query: { ...range, ...extra, format: 'csv' } });

const digits = (value: string): string => value.replace(/\D/g, '');

const PRODUCT_PAGE = 100;

async function allMarginProducts(http: G11Http, range: Range): Promise<Array<MarginFig & { productId: string; name: string | null; sku: string | null }>> {
  const items: Array<MarginFig & { productId: string; name: string | null; sku: string | null }> = [];
  for (let offset = 0; ; offset += PRODUCT_PAGE) {
    const response = await http.get('/analytics/margin/products', { query: { ...range, limit: PRODUCT_PAGE, offset } });
    expect(response.status).toBe(200);
    const body = response.json<{ items: typeof items; total: number }>();
    items.push(...body.items);
    if (body.items.length < PRODUCT_PAGE || offset + PRODUCT_PAGE >= body.total) return items;
  }
}

test.describe('G11 CSV - export @g11', () => {
  test.setTimeout(600_000);

  test('CSV-1 the Export CSV button downloads a text/csv file for the current filters', async ({ openAs, http }) => {
    const page = await openAs('admin');
    const panel = new MarginPanelPage(page);
    const range = liveWindow();
    await panel.goto(range);
    await expect(panel.panel).toBeVisible();
    const download = await panel.download('margin-channel');
    expect(download.suggestedFilename()).toMatch(REPORTS['margin-channel'].filename);
    expect(download.suggestedFilename()).toContain(range.from);
    const response = await csvOf(http.admin, 'margin-channel', range);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toMatch(/^text\/csv/);
    expect(response.headers.get('content-disposition') ?? '').toMatch(/attachment; filename=".*\.csv"/);
  });

  test('CSV-2 the file equals the JSON the screen is built from, for the same filters', async ({ http }) => {
    const range = liveWindow();

    // Sales by channel (net).
    const sales = (await http.admin.get('/analytics/sales', { query: { ...range, basis: 'net' } })).json<{
      channels: Array<{ sourceConnectionId: string; netRevenue: number; orderCount: number; unitsSold: number }>;
    }>();
    const salesCsv = parseCsv((await csvOf(http.admin, 'sales-channel', range, { basis: 'net' })).buffer);
    expect(salesCsv.header).toContain('net_sales');
    for (const channel of sales.channels) {
      const row = salesCsv.rows.find((r) => r.connection_id === channel.sourceConnectionId);
      expect(row, `sales CSV row for ${channel.sourceConnectionId}`).toBeDefined();
      expect(row!.net_sales).toBe(channel.netRevenue.toFixed(2));
      expect(Number(row!.orders)).toBe(channel.orderCount);
    }

    // Margin by channel.
    const margin = (await http.admin.get('/analytics/margin', { query: range })).json<{
      channels: Array<MarginFig & { sourceConnectionId: string }>;
    }>();
    const marginCsv = parseCsv((await csvOf(http.admin, 'margin-channel', range)).buffer);
    for (const channel of margin.channels) {
      const row = marginCsv.rows.find((r) => r.connection_id === channel.sourceConnectionId);
      expect(row, `margin CSV row for ${channel.sourceConnectionId}`).toBeDefined();
      expect(row!.net_revenue).toBe(channel.netRevenue.toFixed(2));
      expect(row!.cost_of_goods).toBe(channel.costOfGoods.toFixed(2));
      expect(row!.gross_margin).toBe(channel.marginPct === null ? '' : channel.grossMargin.toFixed(2));
    }

    // Margin by product.
    const products = await allMarginProducts(http.admin, range);
    const productCsv = parseCsv((await csvOf(http.admin, 'margin-product', range)).buffer);
    expect(productCsv.rows.length, 'one CSV row per ranked product').toBe(products.length);
    for (const product of products) {
      const row = productCsv.rows.find((r) => r.product_id === product.productId);
      expect(row, `margin product ${product.productId}`).toBeDefined();
      expect(row!.net_revenue).toBe(product.netRevenue.toFixed(2));
      expect(row!.cost_of_goods).toBe(product.costOfGoods.toFixed(2));
    }

    // Top products (net).
    const top = (await http.admin.get('/analytics/top-products', { query: { ...range, limit: 100, basis: 'net' } })).json<{
      items: Array<{ productId: string; netRevenue: number; units: number }>;
    }>();
    const topCsv = parseCsv((await csvOf(http.admin, 'top-products', range, { basis: 'net' })).buffer);
    for (const item of top.items) {
      const row = topCsv.rows.find((r) => r.product_id === item.productId);
      expect(row, `top product ${item.productId}`).toBeDefined();
      expect(row!.net_sales).toBe(item.netRevenue.toFixed(2));
      expect(Number(row!.units)).toBe(item.units);
    }
  });

  test('CSV-2 (screen) the rendered margin tables carry the same amounts as the file', async ({ openAs, http, ctx }) => {
    const range = liveWindow();
    const connectionId = ctx.setup.connections.prestashop;
    test.skip(!connectionId, 'needs a PrestaShop connection');
    const page = await openAs('admin');
    const panel = new MarginPanelPage(page);
    await panel.goto(range);
    await expect(panel.channelRow(connectionId!)).toBeVisible();
    const marginCsv = parseCsv((await csvOf(http.admin, 'margin-channel', range)).buffer);
    const row = marginCsv.rows.find((r) => r.connection_id === connectionId);
    expect(row, 'the channel is in the file').toBeDefined();
    const screenText = digits((await panel.channelRow(connectionId!).textContent()) ?? '');
    expect(screenText, 'net revenue on screen').toContain(digits(row!.net_revenue));
    expect(screenText, 'cost of goods on screen').toContain(digits(row!.cost_of_goods));
  });

  test('CSV-3 format: comma, UTF-8 BOM, # header lines stating range, currency, basis and time', async ({ http }) => {
    const range = liveWindow();
    for (const report of Object.keys(REPORTS) as ExportReport[]) {
      const response = await csvOf(http.admin, report, range);
      expect(response.status, report).toBe(200);
      const parsed: ParsedCsv = parseCsv(response.buffer);
      expect(parsed.hasBom, `${report}: BOM`).toBe(true);
      const keys = Object.keys(parsed.comments).join('|').toLowerCase();
      expect(keys, `${report}: range`).toMatch(/range/);
      expect(keys, `${report}: currency`).toMatch(/currency/);
      expect(keys, `${report}: basis`).toMatch(/basis/);
      expect(keys, `${report}: generated`).toMatch(/generated/);
      expect(parsed.header.length, `${report}: comma-separated header`).toBeGreaterThan(2);
      expect(response.headers.get('content-disposition') ?? '', report).toMatch(/_[A-Z]{3}_(net|gross)\.csv"/);
    }
    // Diacritics survive: the file equals the JSON name character for character.
    const products = (await http.admin.get('/analytics/top-products', { query: { ...range, limit: 100 } })).json<{
      items: Array<{ productId: string; name: string | null }>;
    }>();
    const csv = parseCsv((await csvOf(http.admin, 'top-products', range)).buffer);
    for (const item of products.items.filter((i) => i.name && /[^\x00-\x7f]/.test(i.name))) {
      expect(csv.rows.find((r) => r.product_id === item.productId)?.product).toBe(item.name);
    }
  });

  test('CSV-4 a product name starting with a formula character is neutralised in the file', () => {
    test.fixme(
      true,
      'no flow can give a catalogue product the name =HYPERLINK(...) (names are master-owned and the decisions allow SQL only for G11-G and CSV-7); ' +
        'the csvCell guard is asserted in libs/shared/src/csv specs and the controller specs.',
    );
  });

  test('CSV-5 a range over 366 days is refused with a code and a plain message; the UI shows it', async ({ openAs, http }) => {
    const tooWide = { from: utcDay(-400), to: utcDay(1) };
    for (const report of Object.keys(REPORTS) as ExportReport[]) {
      const response = await csvOf(http.admin, report, tooWide);
      expect(response.status, report).toBe(400);
      const body = response.json<{ code?: string; message: string }>();
      expect(body.code, report).toBe('EXPORT_RANGE_TOO_WIDE');
      expect(body.message, report).toMatch(/366 days/);
      expect(response.headers.get('content-type') ?? '', 'not a file').not.toMatch(/^text\/csv/);
    }

    const page = await openAs('admin');
    const panel = new MarginPanelPage(page);
    await panel.goto(tooWide);
    await panel.exportButton('margin-channel').click();
    await expect(panel.exportStatus).toContainText(/366 days/);
    await page.getByTestId('export-change-range').click();
    await expect(page.locator('input[aria-label="Order date from"]')).toBeFocused();
    await page.getByTestId('export-retry').click();
    await expect(panel.exportStatus).toBeVisible();
  });

  test('CSV-6 exactly 366 days is accepted', async ({ http }) => {
    const range = windowOfDays(366, utcDay(1));
    for (const report of Object.keys(REPORTS) as ExportReport[]) {
      const response = await csvOf(http.admin, report, range);
      expect(response.status, report).toBe(200);
    }
  });

  test('CSV-7 a large export streams: first byte well before the end, no timeout', async ({ ctx, http, db }) => {
    const rowCount = Number(process.env.E2E_G11_CSV_ROWS ?? 20_000);
    const range = windowOfDays(366, utcDay(1));
    const memoryBefore = apiMemory(ctx.setup.apiContainer);
    db.exec(`
      INSERT INTO order_line_items ("orderRecordId","lineNumber","productId","variantId",quantity,"unitPrice","sourceConnectionId","placedAt","taxRate","taxSource","taxRateReadAt","costState")
      SELECT o."orderRecordId", 100000 + g, 'ol_product_g11perf_' || g, NULL, 1, 10.00, o."sourceConnectionId", o."placedAt", o."taxRate", o."taxSource", o."taxRateReadAt", 'not-recorded'
        FROM generate_series(1, ${Math.trunc(rowCount)}) g,
             (SELECT * FROM order_line_items WHERE "placedAt" IS NOT NULL ORDER BY "placedAt" DESC LIMIT 1) o`);
    try {
      const timing = await http.admin.streamTiming('/analytics/margin/products', { query: { ...range, format: 'csv' } });
      const memoryAfter = apiMemory(ctx.setup.apiContainer);
      test.info().annotations.push({
        type: 'csv-7',
        description: JSON.stringify({ rowCount, ...timing, memoryBefore, memoryAfter }),
      });
      expect(timing.status).toBe(200);
      expect(timing.totalMs, 'finished without a timeout').toBeLessThan(300_000);
      expect(timing.chunks, 'delivered in more than one chunk').toBeGreaterThan(1);
      expect(timing.ttfbMs, 'first byte arrives before the end').toBeLessThan(timing.totalMs);
    } finally {
      db.exec(`DELETE FROM order_line_items WHERE "productId" LIKE 'ol_product_g11perf_%'`);
    }
  });

  test('CSV-8 JSON and CSV come from one query: the same products, the same figures', async ({ http }) => {
    const range = liveWindow();
    const json = await allMarginProducts(http.admin, range);
    const csv = parseCsv((await csvOf(http.admin, 'margin-product', range)).buffer);
    expect(new Set(csv.rows.map((r) => r.product_id))).toEqual(new Set(json.map((p) => p.productId)));
    const week = parseCsv((await csvOf(http.admin, 'margin-channel', range, { bucket: 'week' })).buffer);
    const day = parseCsv((await csvOf(http.admin, 'margin-channel', range, { bucket: 'day' })).buffer);
    expect(week.rows.map((r) => r.net_revenue)).toEqual(day.rows.map((r) => r.net_revenue));
  });

  test('CSV-9 basis and display currency: the headers say what was written; margin stays net', async ({ openAs, http }) => {
    const range = liveWindow();
    const gross = parseCsv((await csvOf(http.admin, 'sales-channel', range, { basis: 'gross' })).buffer);
    expect(gross.header).toContain('gmv');
    expect(gross.comments['vat basis']).toMatch(/gross/i);
    const net = parseCsv((await csvOf(http.admin, 'sales-channel', range, { basis: 'net' })).buffer);
    expect(net.header).toContain('net_sales');
    expect(net.comments['vat basis']).toMatch(/net/i);

    const marginGross = await csvOf(http.admin, 'margin-channel', range, { basis: 'gross' });
    expect(parseCsv(marginGross.buffer).comments.basis, 'margin is always net').toMatch(/net/i);
    expect(marginGross.headers.get('content-disposition') ?? '').toMatch(/_net\.csv"/);

    const displayed = parseCsv((await csvOf(http.admin, 'sales-channel', range, { displayCurrency: 'EUR' })).buffer);
    const note = displayed.comments['display currency'];
    test.info().annotations.push({ type: 'display-currency-note', description: note ?? '(none: file already in the reporting currency or converted)' });

    const page = await openAs('admin');
    const panel = new MarginPanelPage(page);
    await panel.goto({ ...range, netGrossBasis: 'gross' });
    await expect(panel.exportButton('sales-channel')).toBeVisible();
    const download = await panel.download('sales-channel');
    expect(download.suggestedFilename()).toMatch(/_gross\.csv$/);
  });

  test('CSV-10 margin files carry net revenue, cost, margin and coverage, and say how many lines were left out', async ({ http }) => {
    const range = liveWindow();
    const channel = parseCsv((await csvOf(http.admin, 'margin-channel', range)).buffer);
    for (const column of ['net_revenue', 'covered_net_revenue', 'cost_of_goods', 'gross_margin', 'margin_pct', 'cost_coverage_pct']) {
      expect(channel.header, `margin by channel: ${column}`).toContain(column);
    }
    const margin = (await http.admin.get('/analytics/margin', { query: range })).json<{ headline: MarginFig }>();
    const left = margin.headline.gaps.reduce((s, g) => s + g.lineCount, 0);
    if (left > 0) {
      expect(channel.commentLines.join('\n')).toMatch(new RegExp(`${left} lines`));
    }
    const product = parseCsv((await csvOf(http.admin, 'margin-product', range)).buffer);
    for (const column of ['product', 'sku', 'net_revenue', 'cost_of_goods', 'gross_margin', 'cost_coverage_pct', 'product_id']) {
      expect(product.header, `margin by product: ${column}`).toContain(column);
    }
    test.info().annotations.push({
      type: 'gap-reasons',
      description: 'the file states the number of lines left out; the per-reason split is on screen (margin-coverage-details), not a CSV column.',
    });
  });

  test('CSV-11 a viewer exports too', async ({ openAs, http }) => {
    const range = liveWindow();
    for (const report of Object.keys(REPORTS) as ExportReport[]) {
      expect((await csvOf(http.viewer, report, range)).status, report).toBe(200);
    }
    const page = await openAs('viewer');
    const panel = new MarginPanelPage(page);
    await panel.goto(range);
    await expect(panel.panel).toBeVisible();
    const download = await panel.download('margin-channel');
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('CSV-12 an empty range is a file with headers and no data rows, not an error', async ({ http }) => {
    const empty = { from: '2001-01-01', to: '2001-01-31' };
    for (const report of Object.keys(REPORTS) as ExportReport[]) {
      const response = await csvOf(http.admin, report, empty);
      expect(response.status, report).toBe(200);
      const parsed = parseCsv(response.buffer);
      expect(parsed.hasBom).toBe(true);
      expect(parsed.header.length, `${report}: header row`).toBeGreaterThan(2);
      const dataRows = parsed.rows.filter((r) => r.channel !== 'Total');
      expect(dataRows.length, `${report}: no data rows`).toBe(0);
    }
  });
});

function apiMemory(container: string | undefined): string | null {
  if (!container) return null;
  try {
    return execFileSync('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', container], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
