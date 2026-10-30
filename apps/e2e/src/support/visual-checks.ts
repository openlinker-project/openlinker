/**
 * Visual-parity checks (#3912)
 *
 * Reusable measurements for `visual.spec.ts`: horizontal overflow (page-level
 * and text clipped by `overflow: hidden|clip`), WCAG text contrast, and a
 * screenshot pair (live UI + the committed mockup in the same viewport/theme).
 * Each check returns a typed result instead of asserting, so the spec decides
 * what fails and `summary.json` can report every state, passing or not.
 *
 * Contrast limits, stated so a green run is not over-read: the computed
 * `color` is compared with the first opaque `background-color` found walking
 * up the ancestors (semi-transparent layers are alpha-blended); background
 * IMAGES and gradients are not sampled, and element opacity is folded into the
 * text alpha. Text over an image is therefore reported against whatever solid
 * colour sits beneath it.
 *
 * @module support
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

export type VisualTheme = 'light' | 'dark';

/** Where screenshots and `summary.json` land, relative to `apps/e2e`. */
export const VISUAL_OUTPUT_DIR = path.join('test-results', 'delivery-on-documents');

/** localStorage key the app's ThemeProvider persists an explicit choice under. */
const THEME_STORAGE_KEY = 'openlinker.theme';

const MOCKUP_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/plans/mockups/delivery-on-documents.html',
);

/** The mockup's three views (URL hash). */
export type MockupView = 'mapowania' | 'start' | 'kreator';

export interface ClippedElement {
  selector: string;
  text: string;
  scrollWidth: number;
  clientWidth: number;
  /** True when the element opts into `text-overflow: ellipsis` (deliberate truncation). */
  ellipsis: boolean;
}

export interface OverflowResult {
  ok: boolean;
  documentOverflow: boolean;
  documentScrollWidth: number;
  documentClientWidth: number;
  clipped: ClippedElement[];
}

export interface ContrastOffender {
  selector: string;
  text: string;
  color: string;
  background: string;
  ratio: number;
  required: number;
}

export interface ContrastResult {
  ok: boolean;
  /** How many text-bearing elements were measured. */
  checked: number;
  offenders: ContrastOffender[];
}

export interface VisualStateSummary {
  state: string;
  width: number;
  theme: VisualTheme;
  overflowOk: boolean;
  documentOverflow: boolean;
  clipped: ClippedElement[];
  contrastOk: boolean;
  contrastChecked: number;
  contrastOffenders: ContrastOffender[];
  screenshot: string;
  mockupScreenshot: string | null;
}

/** Put the page in a theme the way the app does: emulated media plus the persisted choice. */
export async function applyTheme(page: Page, theme: VisualTheme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // storage can be disabled; the data-theme attribute below still applies
      }
      document.documentElement.setAttribute('data-theme', value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
}

/** Horizontal-overflow check over `rootSelector`'s subtree. */
export async function checkOverflow(page: Page, rootSelector: string): Promise<OverflowResult> {
  const raw = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const doc = document.documentElement;

    const describe = (el: Element): string => {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && parts.length < 4 && node !== document.body) {
        const id = node.id ? `#${node.id}` : '';
        const cls =
          typeof node.className === 'string' && node.className.trim()
            ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`
            : '';
        parts.unshift(`${node.tagName.toLowerCase()}${id}${cls}`);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };

    const clipped: Array<{
      selector: string;
      text: string;
      scrollWidth: number;
      clientWidth: number;
      ellipsis: boolean;
    }> = [];
    if (root) {
      for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
        const style = getComputedStyle(el);
        if (style.overflowX !== 'hidden' && style.overflowX !== 'clip') continue;
        const text = (el.textContent ?? '').trim();
        if (text === '') continue;
        // Visually-hidden screen-reader text is clipped to 1px on purpose.
        if (el.classList.contains('sr-only') || el.closest('.sr-only') !== null) continue;
        if (el.scrollWidth <= el.clientWidth + 1) continue;
        clipped.push({
          selector: describe(el),
          text: text.slice(0, 80),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          ellipsis: style.textOverflow === 'ellipsis',
        });
      }
    }
    return {
      rootFound: root !== null,
      documentScrollWidth: doc.scrollWidth,
      documentClientWidth: doc.clientWidth,
      clipped,
    };
  }, rootSelector);

  if (!raw.rootFound) {
    throw new Error(`checkOverflow: root element not found: ${rootSelector}`);
  }
  const documentOverflow = raw.documentScrollWidth > raw.documentClientWidth + 1;
  return {
    ok: !documentOverflow && raw.clipped.length === 0,
    documentOverflow,
    documentScrollWidth: raw.documentScrollWidth,
    documentClientWidth: raw.documentClientWidth,
    clipped: raw.clipped,
  };
}

/** WCAG 2.x text-contrast check over `rootSelector`'s subtree. */
export async function checkContrast(
  page: Page,
  rootSelector: string,
  theme: VisualTheme,
): Promise<ContrastResult> {
  const raw = await page.evaluate(
    ([selector, fallbackTheme]) => {
      const root = document.querySelector(selector);
      if (!root) return null;

      type Rgba = { r: number; g: number; b: number; a: number };
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      // Normalise ANY computed CSS colour (rgb, color(srgb ...), oklch ...) through a canvas.
      const parse = (value: string): Rgba => {
        if (!ctx) return { r: 0, g: 0, b: 0, a: 0 };
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        // getImageData premultiplies away alpha only on the canvas; recover straight alpha.
        const a = d[3] / 255;
        return a === 0
          ? { r: 0, g: 0, b: 0, a: 0 }
          : { r: d[0] / a, g: d[1] / a, b: d[2] / a, a };
      };

      const over = (top: Rgba, below: Rgba): Rgba => {
        const a = top.a + below.a * (1 - top.a);
        if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
        return {
          r: (top.r * top.a + below.r * below.a * (1 - top.a)) / a,
          g: (top.g * top.a + below.g * below.a * (1 - top.a)) / a,
          b: (top.b * top.a + below.b * below.a * (1 - top.a)) / a,
          a,
        };
      };

      const luminance = ({ r, g, b }: Rgba): number => {
        const lin = (c: number): number => {
          const s = Math.min(255, Math.max(0, c)) / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };

      const base: Rgba =
        fallbackTheme === 'dark' ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };

      const backgroundOf = (el: Element): Rgba => {
        const layers: Rgba[] = [];
        let node: Element | null = el;
        while (node) {
          const bg = parse(getComputedStyle(node).backgroundColor);
          if (bg.a > 0) layers.push(bg);
          if (bg.a >= 1) break;
          node = node.parentElement;
        }
        let acc: Rgba = layers.length > 0 && layers[layers.length - 1].a >= 1
          ? layers[layers.length - 1]
          : base;
        const upper = layers.length > 0 && layers[layers.length - 1].a >= 1
          ? layers.slice(0, -1)
          : layers;
        for (let i = upper.length - 1; i >= 0; i -= 1) acc = over(upper[i], acc);
        return acc;
      };

      const opacityOf = (el: Element): number => {
        let product = 1;
        let node: Element | null = el;
        while (node) {
          product *= Number.parseFloat(getComputedStyle(node).opacity || '1');
          node = node.parentElement;
        }
        return product;
      };

      const isVisible = (el: Element): boolean => {
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        return el.getClientRects().length > 0;
      };

      const describe = (el: Element): string => {
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && parts.length < 3 && node !== document.body) {
          const id = node.id ? `#${node.id}` : '';
          const cls =
            typeof node.className === 'string' && node.className.trim()
              ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`
              : '';
          parts.unshift(`${node.tagName.toLowerCase()}${id}${cls}`);
          node = node.parentElement;
        }
        return parts.join(' > ');
      };

      const css = (c: Rgba): string =>
        `rgba(${String(Math.round(c.r))}, ${String(Math.round(c.g))}, ${String(Math.round(c.b))}, ${c.a.toFixed(2)})`;

      const offenders: Array<{
        selector: string;
        text: string;
        color: string;
        background: string;
        ratio: number;
        required: number;
      }> = [];
      let checked = 0;

      for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
        const ownText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => (n.textContent ?? '').trim())
          .join(' ')
          .trim();
        if (ownText === '' || !isVisible(el)) continue;

        const style = getComputedStyle(el);
        const bg = backgroundOf(el);
        const rawColor = parse(style.color);
        const fg = over({ ...rawColor, a: rawColor.a * opacityOf(el) }, bg);
        const l1 = luminance(fg);
        const l2 = luminance(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

        const size = Number.parseFloat(style.fontSize);
        const weight = Number.parseInt(style.fontWeight, 10) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const required = large ? 3 : 4.5;

        checked += 1;
        if (ratio < required) {
          offenders.push({
            selector: describe(el),
            text: ownText.slice(0, 80),
            color: css(fg),
            background: css(bg),
            ratio: Math.round(ratio * 100) / 100,
            required,
          });
        }
      }
      return { checked, offenders };
    },
    [rootSelector, theme] as const,
  );

  if (raw === null) {
    throw new Error(`checkContrast: root element not found: ${rootSelector}`);
  }
  return { ok: raw.offenders.length === 0, checked: raw.checked, offenders: raw.offenders };
}

/** `<state>-<width>-<theme>` - the stem every artefact of one state shares. */
export function stateStem(state: string, width: number, theme: VisualTheme): string {
  return `${state}-${String(width)}-${theme}`;
}

/** Screenshot the live page into the output directory; returns the file path. */
export async function captureScreenshot(
  page: Page,
  state: string,
  width: number,
  theme: VisualTheme,
): Promise<string> {
  await mkdir(VISUAL_OUTPUT_DIR, { recursive: true });
  const file = path.join(VISUAL_OUTPUT_DIR, `${stateStem(state, width, theme)}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/**
 * Screenshot the committed mockup at the same viewport and theme. Navigates the
 * given page, so call it AFTER the live checks for that state.
 */
export async function captureMockupScreenshot(
  page: Page,
  view: MockupView,
  state: string,
  width: number,
  height: number,
  theme: VisualTheme,
  interact?: (page: Page) => Promise<void>,
): Promise<string> {
  await mkdir(VISUAL_OUTPUT_DIR, { recursive: true });
  await page.setViewportSize({ width, height });
  await page.goto(`file://${MOCKUP_FILE}#${view}`);
  await page.waitForLoadState('networkidle');
  await applyTheme(page, theme);
  if (interact) await interact(page);
  const file = path.join(VISUAL_OUTPUT_DIR, `${stateStem(state, width, theme)}-mockup.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

export interface VisualStateInput {
  state: string;
  width: number;
  theme: VisualTheme;
  /** CSS selector of the state's root element (a tabpanel, a dialog, a wizard step). */
  rootSelector: string;
}

/** Run overflow + contrast + the live screenshot for one state. */
export async function runVisualChecks(
  page: Page,
  input: VisualStateInput,
): Promise<VisualStateSummary> {
  const overflow = await checkOverflow(page, input.rootSelector);
  const contrast = await checkContrast(page, input.rootSelector, input.theme);
  const screenshot = await captureScreenshot(page, input.state, input.width, input.theme);
  return {
    state: input.state,
    width: input.width,
    theme: input.theme,
    overflowOk: overflow.ok,
    documentOverflow: overflow.documentOverflow,
    clipped: overflow.clipped,
    contrastOk: contrast.ok,
    contrastChecked: contrast.checked,
    contrastOffenders: contrast.offenders,
    screenshot,
    mockupScreenshot: null,
  };
}

/** Write `summary.json` for the orchestrator's report. */
export async function writeVisualSummary(results: readonly VisualStateSummary[]): Promise<string> {
  await mkdir(VISUAL_OUTPUT_DIR, { recursive: true });
  const file = path.join(VISUAL_OUTPUT_DIR, 'summary.json');
  await writeFile(file, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  return file;
}
