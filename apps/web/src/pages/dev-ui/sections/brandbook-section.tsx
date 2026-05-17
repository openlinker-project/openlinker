/**
 * Brandbook section (#775)
 *
 * Token catalogue + brand identity. Renders the full design-token
 * surface (color, type, spacing, radii, shadows, motion, tracking)
 * with live samples so a designer or operator can audit any token by
 * eye without leaving the app.
 *
 * @module pages/dev-ui/sections
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface SwatchProps {
  token: string;
  label: string;
}

function Swatch({ token, label }: SwatchProps): ReactElement {
  return (
    <div className="ds-swatch">
      <div className="ds-swatch__chip" style={{ background: `var(${token})` }} />
      <span className="ds-swatch__name">{label}</span>
      <span className="ds-swatch__token">{token}</span>
    </div>
  );
}

interface SectionProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}

function DsSection({ title, subtitle, children }: SectionProps): ReactElement {
  return (
    <section className="ds-section">
      <h3 className="ds-section__title">{title}</h3>
      {subtitle ? <p className="ds-section__sub">{subtitle}</p> : null}
      {children}
    </section>
  );
}

const SURFACE_TOKENS: SwatchProps[] = [
  { token: '--bg-canvas', label: 'canvas' },
  { token: '--bg-shell', label: 'shell' },
  { token: '--bg-surface', label: 'surface' },
  { token: '--bg-surface-elevated', label: 'surface-elevated' },
  { token: '--bg-surface-muted', label: 'surface-muted' },
  { token: '--bg-surface-hover', label: 'surface-hover' },
  { token: '--bg-strong', label: 'strong' },
  { token: '--bg-muted', label: 'muted' },
];

const ACCENT_TOKENS: SwatchProps[] = [
  { token: '--accent-primary', label: 'accent' },
  { token: '--accent-primary-hover', label: 'accent-hover' },
  { token: '--accent-primary-active', label: 'accent-active' },
  { token: '--accent-primary-soft', label: 'accent-soft' },
  { token: '--accent-primary-soft-strong', label: 'accent-soft-strong' },
  { token: '--accent-primary-border', label: 'accent-border' },
];

const STATUS_TOKENS: { name: string; base: string; soft: string; fg: string }[] = [
  { name: 'success', base: '--status-success', soft: '--status-success-soft', fg: '--status-success-fg' },
  { name: 'warning', base: '--status-warning', soft: '--status-warning-soft', fg: '--status-warning-fg' },
  { name: 'error', base: '--status-error', soft: '--status-error-soft', fg: '--status-error-fg' },
  { name: 'info', base: '--status-info', soft: '--status-info-soft', fg: '--status-info-fg' },
  { name: 'review', base: '--status-review', soft: '--status-review-soft', fg: '--status-review-fg' },
  { name: 'conflict', base: '--status-conflict', soft: '--status-conflict-soft', fg: '--status-conflict-strong' },
];

const TEXT_TOKENS: SwatchProps[] = [
  { token: '--text-primary', label: 'primary' },
  { token: '--text-secondary', label: 'secondary' },
  { token: '--text-muted', label: 'muted' },
  { token: '--text-disabled', label: 'disabled' },
  { token: '--text-inverse', label: 'inverse' },
  { token: '--text-on-primary', label: 'on-accent' },
];

const SPACING_TOKENS: { name: string; value: string; width: string }[] = [
  { name: '--space-1', value: '4px',  width: '4px'  },
  { name: '--space-2', value: '8px',  width: '8px'  },
  { name: '--space-3', value: '12px', width: '12px' },
  { name: '--space-4', value: '16px', width: '16px' },
  { name: '--space-5', value: '24px', width: '24px' },
  { name: '--space-6', value: '32px', width: '32px' },
  { name: '--space-7', value: '48px', width: '48px' },
  { name: '--space-8', value: '64px', width: '64px' },
];

const RADII_TOKENS: { name: string; value: string; rounded: string }[] = [
  { name: '--radius-xs', value: '4px',  rounded: '4px'  },
  { name: '--radius-sm', value: '6px',  rounded: '6px'  },
  { name: '--radius-md', value: '8px',  rounded: '8px'  },
  { name: '--radius-lg', value: '10px', rounded: '10px' },
  { name: '--radius-xl', value: '14px', rounded: '14px' },
  { name: '--radius-pill', value: '9999px', rounded: '9999px' },
];

const SHADOW_TOKENS: { name: string }[] = [
  { name: '--shadow-xs' },
  { name: '--shadow-sm' },
  { name: '--shadow-md' },
  { name: '--shadow-lg' },
  { name: '--shadow-soft' },
  { name: '--shadow-soft-hover' },
  { name: '--shadow-overlay' },
];

export function BrandbookSection(): ReactElement {
  return (
    <div className="ds-stack" style={{ gap: 'var(--space-6)' }}>
      <DsSection
        title="Identity"
        subtitle="OpenLinker is an operator cockpit for multi-channel commerce. The visual identity favours information density and signal clarity — a serious instrument, not a generic admin."
      >
        <div className="ds-row" style={{ gap: 'var(--space-5)' }}>
          <div className="ds-brand-mark" aria-hidden="true" />
          <div className="ds-stack" style={{ gap: 0 }}>
            <span className="ds-eyebrow">Wordmark</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: 'var(--tracking-tight)' }}>OpenLinker</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
              IBM Plex Sans · 600 weight · tight tracking
            </span>
          </div>
        </div>
      </DsSection>

      <DsSection
        title="Color · Surfaces"
        subtitle="Warm-neutral light, cool-neutral dark. Every surface lives on an OKLCH ramp so both themes share a single perceptual model."
      >
        <div className="ds-grid ds-grid--4">
          {SURFACE_TOKENS.map((s) => (
            <Swatch key={s.token} {...s} />
          ))}
        </div>
      </DsSection>

      <DsSection
        title="Color · Accent"
        subtitle="Signal-orange brand accent. Used sparingly: primary buttons, active-tab underline, KPI top-rule, pulsing dot, focus rings."
      >
        <div className="ds-grid ds-grid--3">
          {ACCENT_TOKENS.map((s) => (
            <Swatch key={s.token} {...s} />
          ))}
        </div>
      </DsSection>

      <DsSection
        title="Color · Status"
        subtitle="Five status hues spaced for distinction. Each ships with `*`, `*-soft`, `*-border`, and `*-fg` so badges, alerts, and inline emphasis all draw from the same source."
      >
        <div className="ds-grid ds-grid--3">
          {STATUS_TOKENS.map((t) => (
            <div key={t.name} className="ds-stack" style={{ gap: 'var(--space-2)' }}>
              <span className="ds-eyebrow">{t.name}</span>
              <div className="ds-grid ds-grid--3">
                <Swatch token={t.base} label="base" />
                <Swatch token={t.soft} label="soft" />
                <Swatch token={t.fg} label="fg" />
              </div>
            </div>
          ))}
        </div>
      </DsSection>

      <DsSection title="Color · Text">
        <div className="ds-grid ds-grid--3">
          {TEXT_TOKENS.map((t) => (
            <div key={t.token} className="ds-swatch">
              <div className="ds-swatch__chip" style={{ background: `var(${t.token})` }} />
              <span className="ds-swatch__name">{t.label}</span>
              <span className="ds-swatch__token">{t.token}</span>
            </div>
          ))}
        </div>
      </DsSection>

      <DsSection
        title="Typography"
        subtitle="IBM Plex Sans for body and headings; IBM Plex Mono for identifiers, numerics, eyebrows, and code. Tabular figures on every number."
      >
        <div className="ds-type-ramp ds-surface">
          <div className="ds-type-ramp__row">
            <span className="ds-type-ramp__label">Display 4xl</span>
            <span className="ds-type-ramp__value tabular" style={{ fontSize: '2.125rem', fontWeight: 600, letterSpacing: 'var(--tracking-tight)', lineHeight: 1.05 }}>
              12,847 · €184k MTD
            </span>
          </div>
          <div className="ds-type-ramp__row">
            <span className="ds-type-ramp__label">Title 2xl</span>
            <span className="ds-type-ramp__value" style={{ fontSize: '1.25rem', fontWeight: 600, letterSpacing: 'var(--tracking-tight)' }}>
              Order ol_order_a4f3 · Allegro
            </span>
          </div>
          <div className="ds-type-ramp__row">
            <span className="ds-type-ramp__label">Body md</span>
            <span className="ds-type-ramp__value" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Body copy reads at thirteen-to-fifteen pixels with IBM Plex Sans for clean technical operations text.
            </span>
          </div>
          <div className="ds-type-ramp__row">
            <span className="ds-type-ramp__label">Code sm</span>
            <span className="ds-type-ramp__value mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              ol_offer_8d72fa3c · allegro.publicapi.v1 · status=published
            </span>
          </div>
          <div className="ds-type-ramp__row">
            <span className="ds-type-ramp__label">Eyebrow xs</span>
            <span className="ds-type-ramp__value mono" style={{ fontSize: '0.6875rem', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Last 7 days · Live · UTC+02:00
            </span>
          </div>
        </div>
      </DsSection>

      <DsSection title="Spacing · 4px grid">
        <div className="ds-surface">
          {SPACING_TOKENS.map((s) => (
            <div key={s.name} className="ds-scale-row">
              <span className="ds-scale-row__name">{s.name}</span>
              <div className="ds-scale-row__bar" style={{ width: s.width }} />
              <span className="ds-scale-row__value">{s.value}</span>
            </div>
          ))}
        </div>
      </DsSection>

      <DsSection title="Radius scale">
        <div className="ds-surface">
          {RADII_TOKENS.map((r) => (
            <div key={r.name} className="ds-radius-row">
              <span className="ds-radius-row__name">{r.name}</span>
              <div className="ds-radius-row__sample" style={{ borderRadius: r.rounded }} />
              <span className="ds-radius-row__value">{r.value}</span>
            </div>
          ))}
        </div>
      </DsSection>

      <DsSection title="Shadow scale">
        <div className="ds-grid ds-grid--4">
          {SHADOW_TOKENS.map((s) => (
            <div
              key={s.name}
              className="ds-shadow-card"
              style={{ boxShadow: `var(${s.name})` } as CSSProperties}
            >
              <span className="ds-shadow-card__name">{s.name}</span>
            </div>
          ))}
        </div>
      </DsSection>

      <DsSection
        title="Motion"
        subtitle="Fast for control feedback (120 ms), normal for layout transitions (180 ms), slow only for overlays (280 ms). Easings standardise across the system."
      >
        <div className="ds-surface ds-stack">
          <div className="ds-row">
            <span className="ds-eyebrow" style={{ minWidth: '8rem' }}>--duration-fast</span>
            <span className="mono" style={{ fontSize: '0.8125rem' }}>120 ms</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Button hover, focus ring, input border</span>
          </div>
          <div className="ds-row">
            <span className="ds-eyebrow" style={{ minWidth: '8rem' }}>--duration-normal</span>
            <span className="mono" style={{ fontSize: '0.8125rem' }}>180 ms</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Tab change, dropdown reveal</span>
          </div>
          <div className="ds-row">
            <span className="ds-eyebrow" style={{ minWidth: '8rem' }}>--duration-slow</span>
            <span className="mono" style={{ fontSize: '0.8125rem' }}>280 ms</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Dialog enter, sheet slide</span>
          </div>
        </div>
      </DsSection>
    </div>
  );
}
