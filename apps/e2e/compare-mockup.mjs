/**
 * Measures the pack-bench mockup and the real screen at one viewport and
 * prints both, so the parity diff is numbers rather than impressions.
 */
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = 'http://localhost:38090';
const MOCKUP = path.resolve('../../docs/plans/mockups/pack-bench-redesign.html');
const VIEWPORT = { width: 1440, height: 1000 };

const PROBE = `(() => {
  const g = (sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    return {
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      font: c.fontSize + '/' + c.fontWeight + ' ' + c.fontFamily.split(',')[0],
      color: c.color,
      bg: c.backgroundColor,
      border: c.borderTopWidth + ' ' + c.borderTopColor,
      radius: c.borderTopLeftRadius,
      pad: c.paddingTop + ' ' + c.paddingRight + ' ' + c.paddingBottom + ' ' + c.paddingLeft,
      cols: c.gridTemplateColumns === 'none' ? undefined : c.gridTemplateColumns,
      text: (el.textContent || '').trim().slice(0, 70),
    };
  };
  return { g };
})()`;

async function probe(page, map) {
  return page.evaluate(
    ([m, src]) => {
      const { g } = eval(src);
      const out = {};
      for (const [key, sel] of Object.entries(m)) out[key] = g(sel);
      return out;
    },
    [map, PROBE]
  );
}

const MOCKUP_MAP = {
  topbar: '.topbar',
  identityBar: '.identity-bar',
  metricRow: '.metric-row',
  metricCard: '.metric-card',
  metricLabel: '.metric-card__label',
  metricValue: '.metric-card__value',
  grid: '.bench-grid',
  railPanel: '.bench-grid > aside.panel',
  railSearch: '.rail__search',
  railSearchInput: '.rail__search input',
  railTabs: '.rail__tabs',
  railTab: '.rail__tab',
  sectionLabel: '.rail__section-label',
  railRow: '.rail-row',
  railRowRef: '.rail-row__ref',
  railRowBuyer: '.rail-row__buyer',
  railRowMeta: '.rail-row__meta',
  mainPanel: '.bench-grid > main.panel',
  orderHead: '.order-head',
  orderHeadField: '.order-head__field dt',
  orderHeadValue: '.order-head__field dd',
  hero: '.hero-line',
  heroSwatch: '.hero-line__swatch',
  heroName: '.hero-line__name',
  heroIds: '.hero-line__ids',
  heroInput: '.hero-line__scan input',
  heroCountValue: '.hero-line__count-value',
  heroCountLabel: '.hero-line__count-label',
  progressBlock: '.progress-block',
  progressBar: '.progress-bar',
  progressFill: '.progress-bar__fill',
  linesWrap: '.lines-wrap',
  linesHead: '.lines-wrap__head',
  linesTable: 'table.lines',
  linesTh: 'table.lines thead th:nth-child(2)',
  linesRow: 'table.lines tbody tr',
  docs: '.docs',
  docCard: '.doc-card',
  activity: '.activity',
};

const APP_MAP = {
  topbar: '.bench-topbar',
  identityBar: '.bench-identity-bar',
  metricRow: '.bench-metric-row',
  metricCard: '.bench-metric-card',
  metricLabel: '.bench-metric-card__label',
  metricValue: '.bench-metric-card__value',
  grid: '.bench-grid',
  railPanel: '.bench-rail',
  railSearch: '.bench-rail__search',
  railSearchInput: '.bench-rail__search input',
  railTabs: '.bench-rail__tabs',
  railTab: '.bench-rail__tab',
  sectionLabel: '.bench-rail__section-label',
  railRow: '.bench-work-row',
  railRowRef: '.bench-work-row__reference',
  railRowBuyer: '.bench-work-row__buyer',
  railRowMeta: '.bench-work-row__meta',
  mainPanel: '.bench-main',
  orderHead: '.bench-parcel__header',
  orderHeadField: '.bench-parcel__identity .eyebrow',
  orderHeadValue: '.bench-parcel__identity span:nth-child(2)',
  hero: '.bench-hero',
  heroSwatch: '.bench-hero__swatch',
  heroName: '.bench-hero__name',
  heroIds: '.bench-hero__ids',
  heroInput: '.bench-hero__scan input',
  heroCountValue: '.bench-hero__count-value',
  heroCountLabel: '.bench-hero__count-label',
  progressBlock: '.bench-parcel__progress-block',
  progressBar: '.bench-parcel__progress-track',
  progressFill: '.bench-parcel__progress-fill',
  linesWrap: '.bench-parcel__lines-wrap',
  linesHead: '.bench-parcel__lines-caption',
  linesTable: '.bench-parcel__lines',
  linesTh: '.bench-parcel__lines-head > span:nth-child(2)',
  linesRow: '.bench-parcel-line',
  docs: '.bench-documents',
  docCard: '.bench-documents__card',
  activity: '.bench-activity',
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT });

// --- mockup, light mode ---
const m = await ctx.newPage();
await m.goto(`file://${MOCKUP}`, { waitUntil: 'networkidle' });
await m.waitForTimeout(300);
await m.locator('#themeToggle').click();
await m.waitForTimeout(300);
const mockup = await probe(m, MOCKUP_MAP);

// --- app, parcel open ---
const a = await ctx.newPage();
await a.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await a.getByPlaceholder('Username or email').fill('admin');
await a.getByPlaceholder('Enter your password').fill('admin');
await a.locator('button[type="submit"]').first().click();
await a.waitForTimeout(1500);
await a.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
await a.waitForTimeout(1500);
await a.getByRole('button', { name: 'Open parcel' }).first().click();
await a.waitForTimeout(1800);
const app = await probe(a, APP_MAP);

const keys = Object.keys(MOCKUP_MAP);
const rows = [];
for (const k of keys) {
  rows.push({ key: k, mockup: mockup[k], app: app[k] });
}
console.log(JSON.stringify(rows, null, 1));

await browser.close();
