import { MetricCard } from '@openlinker/web';

/**
 * Ported from /dev/ui: the orders-cockpit KPI strip (patterns-section) and the
 * neutral operations strip (primitives-section). `.metric-card--{tone}` tints
 * the card border and the value, so tone is a genuine axis here.
 */

const grid4 = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 } as const;
const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 } as const;

export const OrdersCockpitStrip = () => (
  <div style={grid4}>
    <MetricCard label="Open" value="142" />
    <MetricCard label="Paid · 24h" value="512" tone="success" />
    <MetricCard label="Pending" value="38" tone="warning" />
    <MetricCard label="Failed · 24h" value="14" tone="error" />
  </div>
);

export const Neutral = () => (
  <div style={grid4}>
    <MetricCard label="Open orders" value="142" />
    <MetricCard label="Avg ingest lag" value="42 s" />
    <MetricCard label="Webhook QPS" value="3.8" />
    <MetricCard label="Channels live" value="4 / 6" tone="info" />
  </div>
);

export const WithDescription = () => (
  <div style={grid2}>
    <MetricCard
      label="Unmapped variants"
      value="217"
      tone="warning"
      description="Blocking 3 bulk publishes on Allegro · Main"
    />
    <MetricCard
      label="Dead-lettered jobs"
      value="9"
      tone="error"
      description="Oldest 2026-05-17 04:11 UTC+02"
    />
  </div>
);

export const WithTrend = () => (
  <div style={grid2}>
    <MetricCard label="Revenue · 24h" value="€12,480.55" tone="success" trend="▲ 6.2%" />
    <MetricCard label="Cancellations · 24h" value="11" tone="error" trend="▲ 4 vs yesterday" />
  </div>
);
