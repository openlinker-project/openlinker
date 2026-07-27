/**
 * Shared Transactional Email Layout
 *
 * Theme-aware shell composed by every HTML email OpenLinker sends (#1748).
 * Colors are compile-time hex constants derived from the app design tokens
 * in `apps/web/src/index.css` (email clients cannot parse OKLCH or CSS
 * custom properties) - the derivation record is the design artifact linked
 * from #1748. Light values are inlined per element as the always-works
 * baseline; the dark palette is applied by the `<style>` block in `<head>`
 * under `@media (prefers-color-scheme: dark)`, so the email follows the
 * reader's system theme where the client supports it (Apple Mail,
 * Thunderbird; Gmail strips the media query and keeps the branded light
 * version). Kept in `apps/api` (not `libs/core`) - rendering detail of
 * mailer calls, not a domain concern.
 *
 * @module apps/api/src/auth/templates
 */

export interface EmailLayoutInput {
  /** Document title and the card's h1. Must be pre-escaped by the caller if dynamic. */
  title: string;
  /** Mono uppercase label naming the system area speaking (e.g. "Account", "Security"). */
  eyebrow: string;
  /** Pre-escaped HTML placed between the connector mark and the meta footer. */
  contentHtml: string;
  /** Pre-escaped HTML paragraphs for the bordered meta footer. */
  metaHtml: string;
}

/**
 * Email palette derived from the app design tokens (see module header).
 * Light: `--bg-muted`/`--bg-surface`/`--text-*`/`--border-*`/`--accent-primary`
 * at hue 80/50; dark: the same tokens under `html[data-theme='dark']`.
 */
export const EMAIL_COLORS = {
  light: {
    canvas: '#f3f1ee',
    card: '#ffffff',
    well: '#f3f1ee',
    ink: '#191610',
    slate: '#45423c',
    mist: '#6b6864',
    rule: '#ece9e5',
    ruleStrong: '#dad7d2',
    accent: '#ec6f00',
    onAccent: '#16100d',
    link: '#0465af',
  },
  dark: {
    canvas: '#08090b',
    card: '#121417',
    well: '#1d1f24',
    ink: '#f0f2f6',
    slate: '#b5b7be',
    mist: '#7d8088',
    rule: '#1d1f24',
    ruleStrong: '#2b2e34',
    accent: '#fa7c20',
    onAccent: '#120c09',
    link: '#5bb9ff',
  },
} as const;

export const EMAIL_SANS_STACK =
  "'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
export const EMAIL_MONO_STACK =
  "'IBM Plex Mono',ui-monospace,Menlo,Consolas,'Liberation Mono',monospace";

/**
 * Escapes the handful of characters that matter when interpolating
 * user-controlled text (usernames, links) into an HTML body.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const L = EMAIL_COLORS.light;
const D = EMAIL_COLORS.dark;

/**
 * The app's button pattern carried into email: dark ink on the accent,
 * not white-on-color. `safeHref` must already be HTML-escaped.
 */
export function renderCtaButton(label: string, safeHref: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0;">
                  <tr>
                    <td class="em-btn" style="border-radius:8px; background-color:${L.accent};">
                      <a href="${safeHref}" class="em-btn-a" style="display:inline-block; padding:12px 26px; font-size:14px; font-weight:600; color:${L.onAccent}; text-decoration:none; border-radius:8px;">${label}</a>
                    </td>
                  </tr>
                </table>`;
}

/**
 * Muted well carrying the raw fallback URL in the mono stack - machine
 * strings always render as machine strings. `safeHref` must already be
 * HTML-escaped.
 */
export function renderFallbackLinkWell(safeHref: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="em-well" style="background-color:${L.well}; border:1px solid ${L.rule}; border-radius:8px; padding:12px 16px;">
                      <p class="em-mist" style="margin:0 0 6px 0; font-size:12px; line-height:1.5; color:${L.mist};">Or paste this link into your browser:</p>
                      <p style="margin:0; font-family:${EMAIL_MONO_STACK}; font-size:12px; line-height:1.55; word-break:break-all;"><a href="${safeHref}" class="em-link" style="color:${L.link};">${safeHref}</a></p>
                    </td>
                  </tr>
                </table>`;
}

export function renderEmailLayout({ title, eyebrow, contentHtml, metaHtml }: EmailLayoutInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      @media (prefers-color-scheme: dark) {
        body, .em-canvas { background-color: ${D.canvas} !important; }
        .em-card { background-color: ${D.card} !important; border-color: ${D.rule} !important; }
        .em-ink { color: ${D.ink} !important; }
        .em-slate { color: ${D.slate} !important; }
        .em-mist { color: ${D.mist} !important; }
        .em-rule { border-color: ${D.rule} !important; }
        .em-accent-bg { background-color: ${D.accent} !important; }
        .em-accent { color: ${D.accent} !important; }
        .em-btn { background-color: ${D.accent} !important; }
        .em-btn-a { color: ${D.onAccent} !important; }
        .em-well { background-color: ${D.well} !important; border-color: ${D.ruleStrong} !important; }
        .em-link { color: ${D.link} !important; }
      }
    </style>
  </head>
  <body class="em-canvas" style="margin:0; padding:0; background-color:${L.canvas}; font-family:${EMAIL_SANS_STACK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-canvas" style="background-color:${L.canvas}; padding:36px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-card" style="max-width:560px; background-color:${L.card}; border:1px solid ${L.rule}; border-radius:12px;">
            <tr>
              <td style="padding:32px 36px 0 36px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td><span class="em-ink" style="font-size:17px; font-weight:600; letter-spacing:-0.015em; color:${L.ink};">Open<span class="em-accent" style="color:${L.accent};">Linker</span></span></td>
                    <td align="right"><span class="em-mist" style="font-family:${EMAIL_MONO_STACK}; font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:${L.mist};">${eyebrow}</span></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 36px 26px 36px; font-size:0; line-height:0;">
                <span class="em-accent-bg" style="display:inline-block; width:6px; height:6px; border-radius:50%; background-color:${L.accent}; vertical-align:middle;"></span><span class="em-accent-bg" style="display:inline-block; width:34px; height:2px; border-radius:2px; background-color:${L.accent}; vertical-align:middle; margin:0 3px;"></span><span class="em-accent-bg" style="display:inline-block; width:6px; height:6px; border-radius:50%; background-color:${L.accent}; vertical-align:middle;"></span>
              </td>
            </tr>
            <tr>
              <td style="padding:0 36px;">
                <h1 class="em-ink" style="margin:0 0 14px 0; font-size:21px; line-height:1.3; font-weight:600; letter-spacing:-0.015em; color:${L.ink};">${title}</h1>
                ${contentHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:0 36px 32px 36px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="em-rule" style="border-top:1px solid ${L.rule}; padding-top:18px;">
                      ${metaHtml}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
            <tr>
              <td style="padding:14px 4px 0 4px;">
                <p class="em-mist" style="margin:0; font-size:11px; line-height:1.6; color:${L.mist};">OpenLinker &middot; open-source e-commerce orchestration</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
