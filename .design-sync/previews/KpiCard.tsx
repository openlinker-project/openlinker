import { KpiCard } from '@openlinker/web';

/**
 * Ported from /dev/ui (primitives-section.tsx "KPI & metric cards" + the
 * patterns-section settings strip). Tone is a real axis: `.kpi-card--{tone}`
 * recolours the top accent rule, the label, the value and the description.
 */

const grid4 = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 } as const;
const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 } as const;

export const Tones = () => (
  <div style={grid4}>
    <KpiCard label="Mappings synced" value="1,284" tone="neutral" />
    <KpiCard label="Pending review" value="6" tone="warning" />
    <KpiCard label="Conflicts" value="0" tone="success" />
    <KpiCard label="Sync failures · 24h" value="14" tone="error" />
  </div>
);

export const WithDescription = () => (
  <div style={grid4}>
    <KpiCard label="Revenue · MTD" value="€184,902" tone="success" description="▲ 8.1% vs April" />
    <KpiCard label="Sync failures · 24h" value="14" tone="error" description="▲ 3 since 02:00" />
    <KpiCard
      label="Active offers"
      value="8,412"
      tone="neutral"
      description="Allegro 4,902 · PrestaShop 3,510"
    />
    <KpiCard label="Last full sync" value="3 m ago" tone="neutral" description="Allegro · Main" />
  </div>
);

export const WithSparkline = () => (
  <div style={grid2}>
    <KpiCard
      label="Orders · 7d"
      value="2,847"
      tone="success"
      sparkline={[18, 22, 19, 27, 31, 26, 34, 30, 38, 41, 37, 45, 49, 52]}
      sparklineAriaLabel="Orders trend over 14 days"
      description="▲ 12.4% vs previous 7d"
    />
    <KpiCard
      label="Webhook rejections · 7d"
      value="63"
      tone="error"
      sparkline={[2, 3, 1, 4, 6, 5, 9, 7, 12, 11, 14, 18, 22, 27]}
      sparklineAriaLabel="Webhook rejection trend over 14 days"
      description="▲ 41 since Monday"
    />
  </div>
);

export const WithValueSuffix = () => (
  <div style={grid2}>
    <KpiCard label="Ingest lag · p95" value="42" valueSuffix="s" tone="warning" />
    <KpiCard label="Channels live" value="4" valueSuffix="/ 6" tone="neutral" />
  </div>
);
