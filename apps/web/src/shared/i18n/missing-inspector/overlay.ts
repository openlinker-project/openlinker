/**
 * Fallback overlay
 *
 * Paints what the scanner found, without touching the application's text:
 * - element text: a wavy underline through the CSS Custom Highlight API, on
 *   the exact range. No node is added, so React reconciliation and layout
 *   are unaffected. Where the API is missing, or the text sits in an SVG
 *   (chart axes and legends, where a highlight does not paint), a box is
 *   drawn in a fixed overlay layer from `Range.getClientRects()` instead.
 * - placeholders: a `data-i18n-missing` token styles `::placeholder`.
 * - attributes the operator cannot read in place: a dashed outline and a
 *   corner badge naming them. The badge lives in the overlay layer, never
 *   inside the element.
 * - a tooltip on hover or focus naming namespace, key, text and kind.
 *
 * Colours come from the status-warning tokens, so it follows light and dark.
 *
 * @module shared/i18n/missing-inspector
 */
import type { FallbackEntry } from './registry';
import { INSPECTOR_UI_ATTRIBUTE, type InspectedAttribute, type ScanFinding } from './scan';

export const MISSING_ATTRIBUTE = 'data-i18n-missing';
export const OUTLINE_ATTRIBUTE = 'data-i18n-missing-outline';
const HIGHLIGHT_NAME = 'i18n-missing';

export const FALLBACK_KIND_LABELS: Readonly<Record<FallbackEntry['kind'], string>> = {
  missing: 'missing key',
  empty: 'empty string',
  'plural-form': 'missing plural form',
};

const STYLES = `
::highlight(${HIGHLIGHT_NAME}) {
  text-decoration: underline wavy var(--status-warning);
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
  background-color: var(--status-warning-soft);
}
[${MISSING_ATTRIBUTE}~="placeholder"]::placeholder {
  text-decoration: underline wavy var(--status-warning);
}
[${OUTLINE_ATTRIBUTE}] {
  outline: 2px dashed var(--status-warning) !important;
  outline-offset: 2px;
}
.i18n-inspector-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483000;
}
.i18n-inspector-box {
  position: fixed;
  border-bottom: 2px dashed var(--status-warning);
  background: var(--status-warning-soft);
  opacity: 0.6;
}
.i18n-inspector-badge {
  position: fixed;
  transform: translate(-100%, -60%);
  padding: 0 4px;
  border-radius: 4px;
  border: 1px solid var(--status-warning);
  background: var(--status-warning-soft);
  color: var(--status-warning-fg);
  font: 600 10px/16px var(--font-mono);
  white-space: nowrap;
}
.i18n-inspector-flash {
  position: fixed;
  border: 2px solid var(--status-warning);
  border-radius: 4px;
  animation: i18n-inspector-flash 1.2s ease-out forwards;
}
@keyframes i18n-inspector-flash {
  from { opacity: 1; }
  to { opacity: 0; }
}
.i18n-inspector-tooltip {
  position: fixed;
  max-width: 420px;
  padding: 6px 8px;
  border: 1px solid var(--status-warning-border);
  border-radius: 6px;
  background: var(--bg-surface-elevated);
  color: var(--text-primary);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
  font: 12px/1.4 var(--font-sans);
}
.i18n-inspector-tooltip__entry + .i18n-inspector-tooltip__entry {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--status-warning-border);
}
.i18n-inspector-tooltip__key {
  font-family: var(--font-mono);
  font-weight: 600;
}
.i18n-inspector-tooltip__meta {
  color: var(--status-warning-fg);
  font-family: var(--font-mono);
  font-size: 11px;
}
`;

interface HighlightLike {
  readonly size: number;
}
type HighlightConstructor = new (...ranges: Range[]) => HighlightLike;
interface HighlightRegistryLike {
  set(name: string, highlight: HighlightLike): void;
  delete(name: string): void;
}

function highlightApi(): { registry: HighlightRegistryLike; Highlight: HighlightConstructor } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistryLike } }).CSS;
  const Highlight = (globalThis as { Highlight?: HighlightConstructor }).Highlight;
  if (css?.highlights === undefined || Highlight === undefined) return null;
  return { registry: css.highlights, Highlight };
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toRange(finding: Extract<ScanFinding, { kind: 'text' }>): Range | null {
  try {
    const range = document.createRange();
    range.setStart(finding.span.startContainer, finding.span.startOffset);
    range.setEnd(finding.span.endContainer, finding.span.endOffset);
    return range;
  } catch {
    // A node detached between scan and paint; the next pass picks it up.
    return null;
  }
}

function inSvg(finding: Extract<ScanFinding, { kind: 'text' }>): boolean {
  return finding.element instanceof SVGElement || finding.element.closest('svg') !== null;
}

function contains(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export interface Overlay {
  paint(findings: readonly ScanFinding[]): void;
  /** Re-place boxes and badges after a scroll or resize, without rescanning. */
  reposition(): void;
  flash(target: Element | Range): void;
  clear(): void;
}

export function createOverlay(lookup: (id: number) => FallbackEntry | undefined, sentinel: string): Overlay {
  const style = document.createElement('style');
  style.setAttribute(INSPECTOR_UI_ATTRIBUTE, sentinel);
  style.textContent = STYLES;
  document.head.append(style);

  const layer = element('div', 'i18n-inspector-layer');
  layer.setAttribute(INSPECTOR_UI_ATTRIBUTE, sentinel);
  layer.setAttribute('aria-hidden', 'true');
  const boxes = element('div', '');
  const tooltip = element('div', 'i18n-inspector-tooltip');
  tooltip.hidden = true;
  layer.append(boxes, tooltip);
  document.body.append(layer);

  const api = highlightApi();
  let findings: readonly ScanFinding[] = [];
  let ranges: { range: Range; id: number; boxed: boolean }[] = [];
  let marked = new Set<Element>();

  const drawBoxes = (): void => {
    const fragment = document.createDocumentFragment();
    for (const { range, boxed } of ranges) {
      if (!boxed) continue;
      for (const rect of Array.from(range.getClientRects())) {
        const box = element('div', 'i18n-inspector-box');
        Object.assign(box.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        fragment.append(box);
      }
    }
    const attributesByElement = new Map<Element, Set<InspectedAttribute>>();
    for (const finding of findings) {
      if (finding.kind !== 'attribute' || finding.attribute === 'placeholder') continue;
      const set = attributesByElement.get(finding.element) ?? new Set<InspectedAttribute>();
      set.add(finding.attribute);
      attributesByElement.set(finding.element, set);
    }
    for (const [target, attributes] of attributesByElement) {
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const badge = element('div', 'i18n-inspector-badge', [...attributes].join(' · '));
      Object.assign(badge.style, { left: `${rect.right}px`, top: `${rect.top}px` });
      fragment.append(badge);
    }
    boxes.replaceChildren(fragment);
  };

  const paint = (next: readonly ScanFinding[]): void => {
    findings = next;
    ranges = [];
    for (const finding of next) {
      if (finding.kind !== 'text') continue;
      const range = toRange(finding);
      if (range !== null) ranges.push({ range, id: finding.id, boxed: api === null || inSvg(finding) });
    }
    if (api !== null) {
      const painted = ranges.filter((entry) => !entry.boxed).map((entry) => entry.range);
      if (painted.length > 0) api.registry.set(HIGHLIGHT_NAME, new api.Highlight(...painted));
      else api.registry.delete(HIGHLIGHT_NAME);
    }

    const tokens = new Map<Element, Set<InspectedAttribute>>();
    for (const finding of next) {
      if (finding.kind !== 'attribute') continue;
      const set = tokens.get(finding.element) ?? new Set<InspectedAttribute>();
      set.add(finding.attribute);
      tokens.set(finding.element, set);
    }
    for (const stale of marked) {
      if (tokens.has(stale)) continue;
      stale.removeAttribute(MISSING_ATTRIBUTE);
      stale.removeAttribute(OUTLINE_ATTRIBUTE);
    }
    for (const [target, attributes] of tokens) {
      const value = [...attributes].join(' ');
      if (target.getAttribute(MISSING_ATTRIBUTE) !== value) target.setAttribute(MISSING_ATTRIBUTE, value);
      const outline = [...attributes].some((attribute) => attribute !== 'placeholder');
      if (outline) target.setAttribute(OUTLINE_ATTRIBUTE, '');
      else target.removeAttribute(OUTLINE_ATTRIBUTE);
    }
    marked = new Set(tokens.keys());
    drawBoxes();
  };

  const showTooltip = (ids: readonly number[], x: number, y: number): void => {
    const entries = ids.map(lookup).filter((entry): entry is FallbackEntry => entry !== undefined);
    if (entries.length === 0) {
      tooltip.hidden = true;
      return;
    }
    tooltip.replaceChildren(
      ...entries.map((entry) => {
        const block = element('div', 'i18n-inspector-tooltip__entry');
        block.append(
          element('div', 'i18n-inspector-tooltip__key', `${entry.namespace}.${entry.keyPath}`),
          element('div', '', entry.text),
          element('div', 'i18n-inspector-tooltip__meta', FALLBACK_KIND_LABELS[entry.kind]),
        );
        return block;
      }),
    );
    tooltip.hidden = false;
    const left = Math.min(x + 12, window.innerWidth - tooltip.offsetWidth - 8);
    const top = y + 16 + tooltip.offsetHeight > window.innerHeight ? y - tooltip.offsetHeight - 8 : y + 16;
    Object.assign(tooltip.style, { left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px` });
  };

  const idsAt = (x: number, y: number, target: Element | null): number[] => {
    const ids = new Set<number>();
    const owner = target?.closest(`[${MISSING_ATTRIBUTE}]`);
    if (owner) {
      for (const finding of findings) {
        if (finding.kind === 'attribute' && finding.element === owner) ids.add(finding.id);
      }
    }
    for (const { range, id } of ranges) {
      if (Array.from(range.getClientRects()).some((rect) => contains(rect, x, y))) ids.add(id);
    }
    return [...ids];
  };

  let pending = false;
  const onPointerMove = (event: PointerEvent): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const target = event.target instanceof Element ? event.target : null;
      showTooltip(idsAt(event.clientX, event.clientY, target), event.clientX, event.clientY);
    });
  };
  const onFocusIn = (event: FocusEvent): void => {
    if (!(event.target instanceof Element)) return;
    const focused = event.target;
    const ids = new Set<number>();
    for (const finding of findings) {
      const node = finding.kind === 'text' ? finding.span.startContainer : finding.element;
      if (focused === finding.element || focused.contains(node)) ids.add(finding.id);
    }
    const rect = focused.getBoundingClientRect();
    showTooltip([...ids], rect.left, rect.bottom);
  };
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', () => {
    tooltip.hidden = true;
  });

  return {
    paint,
    reposition: drawBoxes,
    flash(target): void {
      const rect = target.getBoundingClientRect();
      const flash = element('div', 'i18n-inspector-flash');
      Object.assign(flash.style, {
        left: `${rect.left - 4}px`,
        top: `${rect.top - 4}px`,
        width: `${rect.width + 8}px`,
        height: `${rect.height + 8}px`,
      });
      layer.append(flash);
      window.setTimeout(() => flash.remove(), 1300);
    },
    clear(): void {
      paint([]);
      tooltip.hidden = true;
    },
  };
}
