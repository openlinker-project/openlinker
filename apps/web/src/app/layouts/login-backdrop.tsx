/**
 * Login Backdrop
 *
 * The demo login page's background (#4029): a blurred, inert, non-selectable
 * live view of the panel, cross-fading slowly between Analytics, Orders and
 * Shipments. It is built from the REAL app pieces - `SidebarBrand` and
 * `SidebarNav` from the app shell, `PageLayout`, `StatusBadge`, `DataTable`,
 * `CommandPaletteTrigger` and the analytics `AnalyticsKpiCard` - so it follows
 * every change to the app instead of drifting as a screenshot would. The
 * figures are example data, like the demo's own made-up shop, and nothing
 * here calls the API (the visitor is not signed in). Words, numbers and the
 * currency follow the active language: zloty in Polish, euro in English.
 *
 * Lives in `app/` because it imports the app shell. Reduced motion shows one
 * still scene with no drift.
 *
 * @module app/layouts
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AnalyticsKpiCard, type AnalyticsKpiDelta } from '../../features/analytics';
import { interpolate, useFormat, useLocale, useMessages, type Messages } from '../../shared/i18n';
import type { ResolvedCopy } from '../../shared/i18n/copy.types';
import { Button } from '../../shared/ui/button';
import { CommandPaletteTrigger } from '../../shared/ui/command-palette';
import { DataTable } from '../../shared/ui/data-table';
import { PageLayout } from '../../shared/ui/page-layout';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { SidebarBrand, SidebarNav } from '../app-shell';
import type { NavCounts } from '../hooks/use-nav-counts';
import type { NavGroup } from '../nav-registry.types';

// The smallest panel the backdrop lays out; a larger screen gets a larger
// panel rather than this one blown up.
const APP_W = 1280;
const APP_H = 800;
// At most this much larger than life. Scaling a fixed 1280x800 frame to fill
// a 3340x1440 screen made it 2.6x: giant, soft and cropped. Instead the frame
// takes the screen's own proportions, so a wide monitor shows the panel the
// way it looks on a wide monitor.
const MAX_SCALE = 1.5;
// The backdrop box overhangs the page by this much on every side, so the blur
// has no light edge (`.login-backdrop { inset: -30px }`).
const BLEED = 30;
// Below 1024 px the app shell itself switches to its phone layout (no sidebar,
// a menu button). There the backdrop shows that layout at real size, built from
// the same components, instead of shrinking the desktop panel to a thumbnail.
const SHELL_DESKTOP_MIN_W = 1024;

interface FrameSize {
  width: number;
  height: number;
  scale: number;
  offset: number;
}

/**
 * Fill `box`. A desktop-sized page gets a panel laid out at least APP_W x APP_H
 * and never scaled past MAX_SCALE; a narrower one gets the phone panel at 1:1,
 * inset by the bleed so it lines up with the page.
 */
export function backdropFrame(boxWidth: number, boxHeight: number): FrameSize {
  if (boxWidth - 2 * BLEED < SHELL_DESKTOP_MIN_W) {
    return {
      width: Math.max(0, boxWidth - 2 * BLEED),
      height: Math.max(0, boxHeight - 2 * BLEED),
      scale: 1,
      offset: BLEED,
    };
  }
  const scale = Math.min(Math.max(boxWidth / APP_W, boxHeight / APP_H), MAX_SCALE);
  return {
    width: Math.max(APP_W, Math.ceil(boxWidth / scale)),
    height: Math.max(APP_H, Math.ceil(boxHeight / scale)),
    scale,
    offset: 0,
  };
}
const SCENE_EVERY_MS = 6500;

// Example amounts are in złoty; English shows them in euro at a round example
// rate, so a Polish visitor sees a Polish shop and an English one a euro shop.
const PLN_PER_EUR = 4.25;

type BackdropCopy = ResolvedCopy<Messages['login']>['backdrop'];
type NavKey = keyof BackdropCopy['nav'];
type StatusKey = keyof BackdropCopy['status'];

const NAV_LAYOUT: Array<{
  label: NavKey;
  items: Array<{ label: NavKey; to: string; end?: true; countKey?: keyof NavCounts }>;
}> = [
  {
    label: 'operations',
    items: [
      { label: 'analytics', to: '/', end: true },
      { label: 'insights', to: '/insights' },
      { label: 'orders', to: '/orders', countKey: 'orders' },
      { label: 'products', to: '/products' },
      { label: 'customers', to: '/customers', countKey: 'customers' },
      { label: 'listings', to: '/listings', countKey: 'listings' },
      { label: 'shipments', to: '/shipments' },
      { label: 'returns', to: '/returns' },
      { label: 'salesDocuments', to: '/sales-documents' },
    ],
  },
  {
    label: 'diagnostics',
    items: [
      { label: 'jobs', to: '/jobs', countKey: 'jobsFailed' },
      { label: 'webhooks', to: '/webhooks', countKey: 'webhooksFailed' },
      { label: 'cursors', to: '/cursors' },
    ],
  },
  {
    label: 'platform',
    items: [
      { label: 'connections', to: '/connections', countKey: 'connections' },
      { label: 'adapters', to: '/adapters' },
      { label: 'settings', to: '/settings' },
    ],
  },
];

const NAV_COUNTS: NavCounts = {
  orders: 26,
  customers: 19,
  listings: 148,
  jobsFailed: 0,
  webhooksFailed: 0,
  connections: 6,
};

const KPIS = {
  revenue: { pln: 48210, delta: 0.124, trend: [31, 34, 33, 38, 41, 39, 44, 47] },
  orders: { count: 312, delta: 0.081, trend: [18, 22, 20, 24, 23, 26, 27, 29] },
  aov: { pln: 154.52, delta: 0.039, trend: [140, 146, 143, 149, 151, 150, 153, 155] },
  cancelled: { count: 6, share: 0.019, trend: [2, 1, 2, 1, 1, 2, 1, 1] },
};

const CHANNEL_ROWS = [
  { key: 'a', channel: 'Allegro', orders: 164, pln: 25070, share: 0.52 },
  { key: 'p', channel: 'PrestaShop', orders: 71, pln: 11090, share: 0.23 },
  { key: 'w', channel: 'WooCommerce', orders: 46, pln: 7230, share: 0.15 },
  { key: 'e', channel: 'Erli', orders: 31, pln: 4820, share: 0.1 },
];

// `product` indexes `copy.products`.
const PRODUCT_ROWS: Array<{
  key: string;
  product: keyof BackdropCopy['products'];
  sku: string;
  units: number;
  pln: number;
}> = [
  { key: '1', product: 'p1', sku: 'HD-MER-GRY-M', units: 42, pln: 8358 },
  { key: '2', product: 'p2', sku: 'SH-AER-BLK-42', units: 37, pln: 7363 },
  { key: '3', product: 'p3', sku: 'BG-CNV-NAT', units: 61, pln: 3599 },
  { key: '4', product: 'p4', sku: 'BT-THR-750', units: 54, pln: 3186 },
  { key: '5', product: 'p5', sku: 'SR-LIN-WHT-L', units: 23, pln: 3197 },
  { key: '6', product: 'p6', sku: 'HT-WOL-NVY', units: 48, pln: 1872 },
  { key: '7', product: 'p7', sku: 'WL-LTH-BRN', units: 19, pln: 1691 },
  { key: '8', product: 'p8', sku: 'SK-COT-3P', units: 66, pln: 1584 },
];

/** How long ago: minutes, hours, or yesterday. */
type Ago = ['minutes' | 'hours', number] | ['yesterday'];
type Badge = [StatusKey, StatusBadgeTone];

// `customer` indexes `copy.customers`.
const ORDER_ROWS: Array<{
  key: string;
  id: string;
  when: Ago;
  customer: keyof BackdropCopy['customers'];
  channel: string;
  status: Badge;
  ship: Badge;
  pln: number;
}> = [
  {
    key: '1',
    id: '#A-4821',
    when: ['minutes', 2],
    customer: 'c01',
    channel: 'Allegro',
    status: ['new', 'info'],
    ship: ['notShipped', 'neutral'],
    pln: 189,
  },
  {
    key: '2',
    id: '#A-4820',
    when: ['minutes', 18],
    customer: 'c02',
    channel: 'Allegro',
    status: ['processing', 'review'],
    ship: ['labelReady', 'info'],
    pln: 249,
  },
  {
    key: '3',
    id: '#W-1187',
    when: ['minutes', 42],
    customer: 'c03',
    channel: 'WooCommerce',
    status: ['processing', 'review'],
    ship: ['dispatched', 'success'],
    pln: 89.9,
  },
  {
    key: '4',
    id: '#P-3312',
    when: ['hours', 1],
    customer: 'c04',
    channel: 'PrestaShop',
    status: ['shipped', 'success'],
    ship: ['inTransit', 'success'],
    pln: 412.5,
  },
  {
    key: '5',
    id: '#E-0954',
    when: ['hours', 2],
    customer: 'c05',
    channel: 'Erli',
    status: ['pending', 'warning'],
    ship: ['notShipped', 'neutral'],
    pln: 64.99,
  },
  {
    key: '6',
    id: '#A-4818',
    when: ['hours', 3],
    customer: 'c06',
    channel: 'Allegro',
    status: ['delivered', 'success'],
    ship: ['delivered', 'success'],
    pln: 129,
  },
  {
    key: '7',
    id: '#A-4817',
    when: ['hours', 4],
    customer: 'c07',
    channel: 'Allegro',
    status: ['delivered', 'success'],
    ship: ['delivered', 'success'],
    pln: 79.98,
  },
  {
    key: '8',
    id: '#W-1186',
    when: ['hours', 5],
    customer: 'c08',
    channel: 'WooCommerce',
    status: ['shipped', 'success'],
    ship: ['inTransit', 'success'],
    pln: 154,
  },
  {
    key: '9',
    id: '#A-4816',
    when: ['hours', 5],
    customer: 'c09',
    channel: 'Allegro',
    status: ['processing', 'review'],
    ship: ['labelReady', 'info'],
    pln: 219.9,
  },
  {
    key: '10',
    id: '#P-3311',
    when: ['hours', 6],
    customer: 'c10',
    channel: 'PrestaShop',
    status: ['delivered', 'success'],
    ship: ['delivered', 'success'],
    pln: 98.5,
  },
  {
    key: '11',
    id: '#E-0953',
    when: ['hours', 7],
    customer: 'c11',
    channel: 'Erli',
    status: ['shipped', 'success'],
    ship: ['inTransit', 'success'],
    pln: 139,
  },
  {
    key: '12',
    id: '#A-4815',
    when: ['hours', 8],
    customer: 'c12',
    channel: 'Allegro',
    status: ['delivered', 'success'],
    ship: ['delivered', 'success'],
    pln: 59.99,
  },
  {
    key: '13',
    id: '#A-4814',
    when: ['hours', 9],
    customer: 'c13',
    channel: 'Allegro',
    status: ['delivered', 'success'],
    ship: ['delivered', 'success'],
    pln: 305,
  },
  {
    key: '14',
    id: '#W-1185',
    when: ['yesterday'],
    customer: 'c14',
    channel: 'WooCommerce',
    status: ['delivered', 'success'],
    ship: ['delivered', 'success'],
    pln: 74.9,
  },
  {
    key: '15',
    id: '#P-3310',
    when: ['yesterday'],
    customer: 'c15',
    channel: 'PrestaShop',
    status: ['cancelled', 'neutral'],
    ship: ['notShipped', 'neutral'],
    pln: 49,
  },
  {
    key: '16',
    id: '#A-4813',
    when: ['yesterday'],
    customer: 'c16',
    channel: 'Allegro',
    status: ['delivered', 'success'],
    ship: ['delivered', 'success'],
    pln: 189,
  },
];

const SHIPMENT_ROWS: Array<{
  key: string;
  tracking: string;
  order: string;
  carrier: string;
  status: Badge;
  updated: Ago;
}> = [
  {
    key: '1',
    tracking: '6800 0921 4471 0052 1188 40',
    order: '#A-4820',
    carrier: 'InPost Paczkomat',
    status: ['labelReady', 'info'],
    updated: ['minutes', 18],
  },
  {
    key: '2',
    tracking: '0000 3471 2209 1PL',
    order: '#W-1187',
    carrier: 'DPD',
    status: ['dispatched', 'success'],
    updated: ['minutes', 40],
  },
  {
    key: '3',
    tracking: '6800 0921 4470 9921 0042 11',
    order: '#P-3312',
    carrier: 'InPost Kurier',
    status: ['inTransit', 'success'],
    updated: ['hours', 1],
  },
  {
    key: '4',
    tracking: '6800 0921 4470 8812 3310 07',
    order: '#A-4818',
    carrier: 'InPost Paczkomat',
    status: ['delivered', 'success'],
    updated: ['hours', 3],
  },
  {
    key: '5',
    tracking: '0000 3470 9981 4PL',
    order: '#A-4817',
    carrier: 'DPD',
    status: ['delivered', 'success'],
    updated: ['hours', 4],
  },
  {
    key: '6',
    tracking: '6800 0921 4470 7731 0094 52',
    order: '#W-1186',
    carrier: 'InPost Kurier',
    status: ['inTransit', 'success'],
    updated: ['hours', 5],
  },
  {
    key: '7',
    tracking: '0000 3470 9876 2PL',
    order: '#A-4816',
    carrier: 'DPD',
    status: ['labelReady', 'info'],
    updated: ['hours', 5],
  },
  {
    key: '8',
    tracking: '6800 0921 4470 6620 1187 33',
    order: '#P-3311',
    carrier: 'InPost Paczkomat',
    status: ['delivered', 'success'],
    updated: ['hours', 6],
  },
  {
    key: '9',
    tracking: '6800 0921 4470 5519 2276 18',
    order: '#E-0953',
    carrier: 'InPost Paczkomat',
    status: ['inTransit', 'success'],
    updated: ['hours', 7],
  },
  {
    key: '10',
    tracking: '0000 3470 9654 7PL',
    order: '#A-4815',
    carrier: 'DPD',
    status: ['delivered', 'success'],
    updated: ['hours', 8],
  },
  {
    key: '11',
    tracking: '6800 0921 4470 4408 3365 09',
    order: '#A-4814',
    carrier: 'InPost Paczkomat',
    status: ['delivered', 'success'],
    updated: ['hours', 9],
  },
  {
    key: '12',
    tracking: '6800 0921 4470 3397 4454 71',
    order: '#W-1185',
    carrier: 'InPost Kurier',
    status: ['delivered', 'success'],
    updated: ['yesterday'],
  },
  {
    key: '13',
    tracking: '0000 3470 9432 1PL',
    order: '#A-4813',
    carrier: 'DPD',
    status: ['delivered', 'success'],
    updated: ['yesterday'],
  },
  {
    key: '14',
    tracking: '6800 0921 4470 2286 5543 26',
    order: '#A-4812',
    carrier: 'InPost Paczkomat',
    status: ['delivered', 'success'],
    updated: ['yesterday'],
  },
];

const mono = (value: string): ReactElement => <span className="mono-text">{value}</span>;
const noop = (): void => undefined;

type SceneKey = 'analytics' | 'orders' | 'shipments';

interface Scene {
  crumb: string;
  to: string;
  render: () => ReactNode;
}

/** The three scenes in the active language, with amounts in its currency. */
function useScenes(): { scenes: Record<SceneKey, Scene>; nav: NavGroup[]; copy: BackdropCopy } {
  const copy = useMessages('login').backdrop;
  const { locale } = useLocale();
  const format = useFormat();
  return useMemo(() => {
    const currency = locale === 'pl' ? 'PLN' : 'EUR';
    const amount = (pln: number): number => (currency === 'PLN' ? pln : pln / PLN_PER_EUR);
    const money = (pln: number): string =>
      format.money(Math.round(amount(pln) * 100) / 100, currency);
    const total = (pln: number): string =>
      format.number(Math.round(amount(pln)), {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      });
    const count = (value: number): string => format.number(value);
    const share = (fraction: number): string => format.percent(fraction);
    const ago = (when: Ago): string =>
      when[0] === 'yesterday' ? copy.ago.yesterday : interpolate(copy.ago[when[0]], { n: when[1] });
    const badge = ([key, tone]: Badge, withDot = false): ReactElement => (
      <StatusBadge tone={tone} withDot={withDot}>
        {copy.status[key]}
      </StatusBadge>
    );
    const up = (fraction: number): AnalyticsKpiDelta => {
      const formatted = share(fraction);
      return {
        formatted,
        tone: 'success',
        direction: 'up',
        basisLabel: copy.analytics.basis,
        spokenText: interpolate(copy.analytics.up, { value: formatted }),
      };
    };
    const a = copy.analytics;
    const kpis = [
      {
        label: a.revenue,
        value: total(KPIS.revenue.pln),
        metric: a.revenueMetric,
        delta: up(KPIS.revenue.delta),
        trend: KPIS.revenue.trend,
      },
      {
        label: a.orders,
        value: count(KPIS.orders.count),
        metric: a.ordersMetric,
        delta: up(KPIS.orders.delta),
        trend: KPIS.orders.trend,
      },
      {
        label: a.aov,
        value: money(KPIS.aov.pln),
        metric: a.aovMetric,
        delta: up(KPIS.aov.delta),
        trend: KPIS.aov.trend,
      },
      {
        label: a.cancelled,
        value: count(KPIS.cancelled.count),
        metric: interpolate(a.cancelledMetric, { share: share(KPIS.cancelled.share) }),
        delta: {
          formatted: share(0),
          tone: 'neutral',
          direction: 'flat',
          basisLabel: a.basis,
          spokenText: a.noChange,
        } satisfies AnalyticsKpiDelta,
        trend: KPIS.cancelled.trend,
      },
    ];
    const nav: NavGroup[] = NAV_LAYOUT.map((group) => ({
      kind: 'live',
      label: copy.nav[group.label],
      items: group.items.map((item) => ({ ...item, label: copy.nav[item.label] })),
    }));
    const scenes: Record<SceneKey, Scene> = {
      analytics: {
        crumb: copy.nav.analytics,
        to: '/',
        render: () => (
          <PageLayout
            eyebrow={copy.nav.operations}
            title={copy.nav.analytics}
            description={a.description}
            actions={<Button tone="secondary">{a.settings}</Button>}
          >
            <section className="status-strip status-strip--analytics">
              {kpis.map((kpi) => (
                <AnalyticsKpiCard
                  key={kpi.label}
                  label={kpi.label}
                  infotipLabel={kpi.label}
                  definitions={[]}
                  value={kpi.value}
                  metric={kpi.metric}
                  delta={kpi.delta}
                  trend={{
                    values: kpi.trend,
                    tone: kpi.delta.tone === 'success' ? 'success' : 'neutral',
                    ariaLabel: kpi.label,
                  }}
                />
              ))}
            </section>
            <DataTable
              rows={CHANNEL_ROWS}
              rowKey={(row) => row.key}
              columns={[
                { id: 'c', header: a.channel, cell: (row) => row.channel },
                {
                  id: 'o',
                  header: a.orders,
                  align: 'right',
                  cell: (row) => mono(count(row.orders)),
                },
                { id: 'r', header: a.revenue, align: 'right', cell: (row) => mono(total(row.pln)) },
                { id: 's', header: a.share, align: 'right', cell: (row) => mono(share(row.share)) },
              ]}
            />
            <DataTable
              rows={PRODUCT_ROWS}
              rowKey={(row) => row.key}
              columns={[
                { id: 'p', header: a.topProducts, cell: (row) => copy.products[row.product] },
                { id: 'k', header: a.sku, cell: (row) => mono(row.sku) },
                { id: 'u', header: a.units, align: 'right', cell: (row) => mono(count(row.units)) },
                { id: 'r', header: a.revenue, align: 'right', cell: (row) => mono(total(row.pln)) },
              ]}
            />
          </PageLayout>
        ),
      },
      orders: {
        crumb: copy.nav.orders,
        to: '/orders',
        render: () => (
          <PageLayout
            eyebrow={copy.nav.operations}
            title={copy.nav.orders}
            actions={
              <Button tone="ghost" className="button--sm">
                {copy.refresh}
                <span className="button__shortcut">R</span>
              </Button>
            }
          >
            <DataTable
              rows={ORDER_ROWS}
              rowKey={(row) => row.key}
              columns={[
                {
                  id: 'order',
                  header: copy.orders.order,
                  cell: (row) => (
                    <span>
                      <strong className="mono-text">{row.id}</strong>
                      <br />
                      <span className="page-description">{ago(row.when)}</span>
                    </span>
                  ),
                },
                {
                  id: 'customer',
                  header: copy.orders.customer,
                  cell: (row) => copy.customers[row.customer],
                },
                { id: 'channel', header: copy.orders.channel, cell: (row) => row.channel },
                {
                  id: 'status',
                  header: copy.orders.status,
                  cell: (row) => badge(row.status, true),
                },
                { id: 'shipment', header: copy.orders.shipment, cell: (row) => badge(row.ship) },
                {
                  id: 'money',
                  header: copy.orders.total,
                  align: 'right',
                  cell: (row) => mono(money(row.pln)),
                },
              ]}
            />
          </PageLayout>
        ),
      },
      shipments: {
        crumb: copy.nav.shipments,
        to: '/shipments',
        render: () => (
          <PageLayout
            eyebrow={copy.nav.operations}
            title={copy.nav.shipments}
            description={copy.shipments.description}
          >
            <DataTable
              rows={SHIPMENT_ROWS}
              rowKey={(row) => row.key}
              columns={[
                { id: 't', header: copy.shipments.tracking, cell: (row) => mono(row.tracking) },
                { id: 'o', header: copy.shipments.order, cell: (row) => mono(row.order) },
                { id: 'c', header: copy.shipments.carrier, cell: (row) => row.carrier },
                { id: 's', header: copy.shipments.status, cell: (row) => badge(row.status, true) },
                { id: 'u', header: copy.shipments.updated, cell: (row) => ago(row.updated) },
              ]}
            />
          </PageLayout>
        ),
      },
    };
    return { scenes, nav, copy };
  }, [copy, locale, format]);
}

const TOUR = ['analytics', 'orders', 'shipments'] as const;

export function LoginBackdrop(): ReactElement {
  const reduce = useReducedMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FrameSize>({ width: APP_W, height: APP_H, scale: 1, offset: 0 });
  const [index, setIndex] = useState(0);
  const { scenes, nav, copy } = useScenes();

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFrame(backdropFrame(entry.contentRect.width, entry.contentRect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduce) return undefined;
    const id = setInterval(() => setIndex((n) => (n + 1) % TOUR.length), SCENE_EVERY_MS);
    return () => clearInterval(id);
  }, [reduce]);

  const key = TOUR[reduce ? 1 : index] ?? 'orders';
  const scene = scenes[key];

  return (
    <div className="login-backdrop" ref={boxRef} aria-hidden="true" inert>
      <div
        className="login-backdrop__frame"
        style={{
          left: frame.offset,
          top: frame.offset,
          width: frame.width,
          height: frame.height,
          transform: `scale(${frame.scale})`,
        }}
      >
        <div className="login-backdrop__drift">
          <div className="shell">
            <div className="shell-sidebar">
              <SidebarBrand />
              <SidebarNav
                ariaLabel="Preview"
                counts={NAV_COUNTS}
                groups={nav}
                activeTo={scene.to}
              />
              <div className="shell-workspace">
                <div className="shell-workspace__header">
                  <strong className="shell-workspace__name">{copy.workspace}</strong>
                </div>
                <div className="shell-workspace__user">
                  <span className="shell-workspace__username">{copy.user}</span>
                </div>
              </div>
            </div>
            <div className="shell-main">
              <header className="shell-topbar">
                <button type="button" className="shell-topbar__hamburger" tabIndex={-1}>
                  <span aria-hidden="true">☰</span>
                </button>
                <nav className="shell-crumbs">
                  <span className="shell-crumbs__group">{copy.nav.operations}</span>
                  <span className="shell-crumbs__sep" aria-hidden="true">
                    /
                  </span>
                  <span className="shell-crumbs__current login-backdrop__crumb">
                    <AnimatePresence initial={false}>
                      <motion.span
                        key={scene.crumb}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1 }}
                      >
                        {scene.crumb}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                </nav>
                <CommandPaletteTrigger onClick={noop} tabIndex={-1} />
                <div className="shell-topbar__spacer" />
                <Button tone="ghost" className="shell-topbar__alerts" tabIndex={-1}>
                  {copy.alerts} <span>0</span>
                </Button>
                <span className="shell-user-chip">
                  <span className="shell-user-chip__avatar">
                    {copy.user.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="shell-user-chip__name">{copy.user}</span>
                </span>
              </header>
              {/* The real app re-keys .shell-content per route for a quick cut; as a background that
                  reads as a slideshow, so scenes overlap and cross-fade slowly instead. */}
              <main className="shell-content login-backdrop__scenes">
                <AnimatePresence initial={false}>
                  <motion.div
                    key={key}
                    className="login-backdrop__scene"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 1.4, ease: [0.45, 0, 0.25, 1] }}
                  >
                    {scene.render()}
                  </motion.div>
                </AnimatePresence>
              </main>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
