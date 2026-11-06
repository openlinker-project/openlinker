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
 * here calls the API (the visitor is not signed in).
 *
 * Lives in `app/` because it imports the app shell. Reduced motion shows one
 * still scene with no drift.
 *
 * @module app/layouts
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AnalyticsKpiCard, type AnalyticsKpiDelta } from '../../features/analytics';
import { Button } from '../../shared/ui/button';
import { CommandPaletteTrigger } from '../../shared/ui/command-palette';
import { DataTable } from '../../shared/ui/data-table';
import { PageLayout } from '../../shared/ui/page-layout';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { SidebarBrand, SidebarNav } from '../app-shell';
import type { NavCounts } from '../hooks/use-nav-counts';
import type { NavGroup } from '../nav-registry.types';

const APP_W = 1280;
const APP_H = 800;
const SCENE_EVERY_MS = 6500;

const NAV_GROUPS: NavGroup[] = [
  {
    kind: 'live',
    label: 'Operations',
    items: [
      { label: 'Analytics', to: '/', end: true },
      { label: 'Insights', to: '/insights' },
      { label: 'Orders', to: '/orders', countKey: 'orders' },
      { label: 'Products', to: '/products' },
      { label: 'Customers', to: '/customers', countKey: 'customers' },
      { label: 'Listings', to: '/listings', countKey: 'listings' },
      { label: 'Shipments', to: '/shipments' },
      { label: 'Returns', to: '/returns' },
      { label: 'Sales documents', to: '/sales-documents' },
    ],
  },
  {
    kind: 'live',
    label: 'Diagnostics',
    items: [
      { label: 'Jobs & Logs', to: '/jobs', countKey: 'jobsFailed' },
      { label: 'Webhooks', to: '/webhooks', countKey: 'webhooksFailed' },
      { label: 'Cursors', to: '/cursors' },
    ],
  },
  {
    kind: 'live',
    label: 'Platform',
    items: [
      { label: 'Connections', to: '/connections', countKey: 'connections' },
      { label: 'Adapters', to: '/adapters' },
      { label: 'Settings', to: '/settings' },
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

interface Kpi {
  label: string;
  value: string;
  metric: string;
  delta: AnalyticsKpiDelta;
  trend: number[];
}

const up = (formatted: string): AnalyticsKpiDelta => ({
  formatted,
  tone: 'success',
  direction: 'up',
  basisLabel: 'vs previous 14 days',
  spokenText: `Up ${formatted}`,
});

const KPIS: Kpi[] = [
  {
    label: 'Revenue',
    value: '48 210 zł',
    metric: 'Gross, all channels',
    delta: up('12,4%'),
    trend: [31, 34, 33, 38, 41, 39, 44, 47],
  },
  {
    label: 'Orders',
    value: '312',
    metric: 'Placed in the period',
    delta: up('8,1%'),
    trend: [18, 22, 20, 24, 23, 26, 27, 29],
  },
  {
    label: 'Average order value',
    value: '154,52 zł',
    metric: 'Revenue per order',
    delta: up('3,9%'),
    trend: [140, 146, 143, 149, 151, 150, 153, 155],
  },
  {
    label: 'Cancelled',
    value: '6',
    metric: '1,9% of orders',
    delta: {
      formatted: '0,0%',
      tone: 'neutral',
      direction: 'flat',
      basisLabel: 'vs previous 14 days',
      spokenText: 'No change',
    },
    trend: [2, 1, 2, 1, 1, 2, 1, 1],
  },
];

const CHANNEL_ROWS = [
  { key: 'a', channel: 'Allegro', orders: '164', revenue: '25 070 zł', share: '52%' },
  { key: 'p', channel: 'PrestaShop', orders: '71', revenue: '11 090 zł', share: '23%' },
  { key: 'w', channel: 'WooCommerce', orders: '46', revenue: '7 230 zł', share: '15%' },
  { key: 'e', channel: 'Erli', orders: '31', revenue: '4 820 zł', share: '10%' },
];

type Badge = [string, StatusBadgeTone];

const ORDER_ROWS: Array<{
  key: string;
  id: string;
  when: string;
  customer: string;
  channel: string;
  status: Badge;
  ship: Badge;
  money: string;
}> = [
  {
    key: '1',
    id: '#A-4821',
    when: '2 min ago',
    customer: 'Marta Wiśniewska',
    channel: 'Allegro',
    status: ['New', 'info'],
    ship: ['Not shipped', 'neutral'],
    money: '189,00 zł',
  },
  {
    key: '2',
    id: '#A-4820',
    when: '18 min ago',
    customer: 'Tomasz Wójcik',
    channel: 'Allegro',
    status: ['Processing', 'review'],
    ship: ['Label ready', 'info'],
    money: '249,00 zł',
  },
  {
    key: '3',
    id: '#W-1187',
    when: '42 min ago',
    customer: 'Katarzyna Lis',
    channel: 'WooCommerce',
    status: ['Processing', 'review'],
    ship: ['Dispatched', 'success'],
    money: '89,90 zł',
  },
  {
    key: '4',
    id: '#P-3312',
    when: '1 h ago',
    customer: 'Michał Zieliński',
    channel: 'PrestaShop',
    status: ['Shipped', 'success'],
    ship: ['In transit', 'success'],
    money: '412,50 zł',
  },
  {
    key: '5',
    id: '#E-0954',
    when: '2 h ago',
    customer: 'Agnieszka Kowalczyk',
    channel: 'Erli',
    status: ['Pending', 'warning'],
    ship: ['Not shipped', 'neutral'],
    money: '64,99 zł',
  },
  {
    key: '6',
    id: '#A-4818',
    when: '3 h ago',
    customer: 'Paweł Kamiński',
    channel: 'Allegro',
    status: ['Delivered', 'success'],
    ship: ['Delivered', 'success'],
    money: '129,00 zł',
  },
  {
    key: '7',
    id: '#A-4817',
    when: '4 h ago',
    customer: 'Ewa Szymańska',
    channel: 'Allegro',
    status: ['Delivered', 'success'],
    ship: ['Delivered', 'success'],
    money: '79,98 zł',
  },
];

const SHIPMENT_ROWS: Array<{
  key: string;
  tracking: string;
  order: string;
  carrier: string;
  status: Badge;
  updated: string;
}> = [
  {
    key: '1',
    tracking: '6800 0921 4471 0052 1188 40',
    order: '#A-4820',
    carrier: 'InPost Paczkomat',
    status: ['Label ready', 'info'],
    updated: '18 min ago',
  },
  {
    key: '2',
    tracking: '0000 3471 2209 1PL',
    order: '#W-1187',
    carrier: 'DPD',
    status: ['Dispatched', 'success'],
    updated: '40 min ago',
  },
  {
    key: '3',
    tracking: '6800 0921 4470 9921 0042 11',
    order: '#P-3312',
    carrier: 'InPost Kurier',
    status: ['In transit', 'success'],
    updated: '1 h ago',
  },
  {
    key: '4',
    tracking: '6800 0921 4470 8812 3310 07',
    order: '#A-4818',
    carrier: 'InPost Paczkomat',
    status: ['Delivered', 'success'],
    updated: '3 h ago',
  },
  {
    key: '5',
    tracking: '0000 3470 9981 4PL',
    order: '#A-4817',
    carrier: 'DPD',
    status: ['Delivered', 'success'],
    updated: '4 h ago',
  },
];

const mono = (value: string): ReactElement => <span className="mono-text">{value}</span>;
const noop = (): void => undefined;

interface Scene {
  crumb: string;
  to: string;
  render: () => ReactNode;
}

const SCENES: Record<'analytics' | 'orders' | 'shipments', Scene> = {
  analytics: {
    crumb: 'Analytics',
    to: '/',
    render: () => (
      <PageLayout
        eyebrow="Operations"
        title="Analytics"
        description="Sales across connected channels, with clear data coverage."
        actions={<Button tone="secondary">Analytics settings</Button>}
      >
        <section className="status-strip status-strip--analytics">
          {KPIS.map((kpi) => (
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
            { id: 'c', header: 'Channel', cell: (row) => row.channel },
            { id: 'o', header: 'Orders', align: 'right', cell: (row) => mono(row.orders) },
            { id: 'r', header: 'Revenue', align: 'right', cell: (row) => mono(row.revenue) },
            { id: 's', header: 'Share', align: 'right', cell: (row) => mono(row.share) },
          ]}
        />
      </PageLayout>
    ),
  },
  orders: {
    crumb: 'Orders',
    to: '/orders',
    render: () => (
      <PageLayout
        eyebrow="Operations"
        title="Orders"
        actions={
          <Button tone="ghost" className="button--sm">
            Refresh<span className="button__shortcut">R</span>
          </Button>
        }
      >
        <DataTable
          rows={ORDER_ROWS}
          rowKey={(row) => row.key}
          columns={[
            {
              id: 'order',
              header: 'Order',
              cell: (row) => (
                <span>
                  <strong className="mono-text">{row.id}</strong>
                  <br />
                  <span className="page-description">{row.when}</span>
                </span>
              ),
            },
            { id: 'customer', header: 'Customer', cell: (row) => row.customer },
            { id: 'channel', header: 'Channel', cell: (row) => row.channel },
            {
              id: 'status',
              header: 'Status',
              cell: (row) => (
                <StatusBadge tone={row.status[1]} withDot>
                  {row.status[0]}
                </StatusBadge>
              ),
            },
            {
              id: 'shipment',
              header: 'Shipment',
              cell: (row) => <StatusBadge tone={row.ship[1]}>{row.ship[0]}</StatusBadge>,
            },
            { id: 'money', header: 'Total', align: 'right', cell: (row) => mono(row.money) },
          ]}
        />
      </PageLayout>
    ),
  },
  shipments: {
    crumb: 'Shipments',
    to: '/shipments',
    render: () => (
      <PageLayout
        eyebrow="Operations"
        title="Shipments"
        description="Labels, tracking numbers and delivery status for every carrier."
      >
        <DataTable
          rows={SHIPMENT_ROWS}
          rowKey={(row) => row.key}
          columns={[
            { id: 't', header: 'Tracking', cell: (row) => mono(row.tracking) },
            { id: 'o', header: 'Order', cell: (row) => mono(row.order) },
            { id: 'c', header: 'Carrier', cell: (row) => row.carrier },
            {
              id: 's',
              header: 'Status',
              cell: (row) => (
                <StatusBadge tone={row.status[1]} withDot>
                  {row.status[0]}
                </StatusBadge>
              ),
            },
            { id: 'u', header: 'Updated', cell: (row) => row.updated },
          ]}
        />
      </PageLayout>
    ),
  },
};

const TOUR = ['analytics', 'orders', 'shipments'] as const;

export function LoginBackdrop(): ReactElement {
  const reduce = useReducedMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setScale(Math.max(entry.contentRect.width / APP_W, entry.contentRect.height / APP_H));
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
  const scene = SCENES[key];

  return (
    <div className="login-backdrop" ref={boxRef} aria-hidden="true" inert>
      <div
        className="login-backdrop__frame"
        style={{ width: APP_W, height: APP_H, transform: `scale(${scale})` }}
      >
        <div className="login-backdrop__drift">
          <div className="shell">
            <div className="shell-sidebar">
              <SidebarBrand />
              <SidebarNav
                ariaLabel="Preview"
                counts={NAV_COUNTS}
                groups={NAV_GROUPS}
                activeTo={scene.to}
              />
              <div className="shell-workspace">
                <div className="shell-workspace__header">
                  <strong className="shell-workspace__name">Default organization</strong>
                </div>
                <div className="shell-workspace__user">
                  <span className="shell-workspace__username">kasia</span>
                </div>
              </div>
            </div>
            <div className="shell-main">
              <header className="shell-topbar">
                <nav className="shell-crumbs">
                  <span className="shell-crumbs__group">Operations</span>
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
                  Alerts <span>0</span>
                </Button>
                <span className="shell-user-chip">
                  <span className="shell-user-chip__avatar">KA</span>
                  <span className="shell-user-chip__name">kasia</span>
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
