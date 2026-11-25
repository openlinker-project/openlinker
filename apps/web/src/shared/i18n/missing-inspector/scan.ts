/**
 * Fallback scanner
 *
 * A pure walk over a DOM subtree that finds every marked string on screen:
 * text (as a range that may span several text nodes, since `renderRich`
 * splits one sentence around its tags) and the attributes an operator cannot
 * read in place. It reads the DOM and changes nothing; painting is the
 * overlay's job, so this part is testable without a layout engine.
 *
 * @module shared/i18n/missing-inspector
 */
import { markerIdsIn, tokenizeMarkers } from './markers';

export const InspectedAttributeValues = [
  'placeholder',
  'title',
  'aria-label',
  'aria-description',
  'alt',
  'value',
  'option',
] as const;
export type InspectedAttribute = (typeof InspectedAttributeValues)[number];

/** A `StaticRange`-shaped span; the overlay turns it into a live `Range`. */
export interface TextSpan {
  readonly startContainer: Node;
  readonly startOffset: number;
  readonly endContainer: Node;
  readonly endOffset: number;
}

export type ScanFinding =
  | { readonly kind: 'text'; readonly id: number; readonly element: Element; readonly span: TextSpan }
  | {
      readonly kind: 'attribute';
      readonly id: number;
      readonly element: Element;
      readonly attribute: InspectedAttribute;
    };

/** The inspector's own UI carries this attribute and is never scanned. */
export const INSPECTOR_UI_ATTRIBUTE = 'data-i18n-inspector';

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
const PLAIN_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'aria-description', 'alt'] as const;

interface OpenMarker {
  readonly id: number;
  readonly node: Node;
  readonly offset: number;
  readonly element: Element;
}

function scanAttributes(element: Element, findings: ScanFinding[]): void {
  for (const attribute of PLAIN_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value === null) continue;
    for (const id of markerIdsIn(value)) findings.push({ kind: 'attribute', id, element, attribute });
  }
  // The property, not the attribute: React sets a controlled input's value
  // without writing the attribute.
  const isValueBearer =
    element instanceof HTMLInputElement ||
    element instanceof HTMLButtonElement ||
    element instanceof HTMLTextAreaElement;
  if (isValueBearer) {
    for (const id of markerIdsIn(element.value)) {
      findings.push({ kind: 'attribute', id, element, attribute: 'value' });
    }
  }
  // A closed native select shows its options nowhere a highlight can paint,
  // so their text is reported on the select itself.
  if (element instanceof HTMLSelectElement) {
    const seen = new Set<number>();
    for (const option of Array.from(element.options)) {
      for (const id of markerIdsIn(option.text)) {
        if (seen.has(id)) continue;
        seen.add(id);
        findings.push({ kind: 'attribute', id, element, attribute: 'option' });
      }
    }
  }
}

function scanText(
  text: Text,
  parent: Element,
  stack: OpenMarker[],
  findings: ScanFinding[],
): void {
  for (const token of tokenizeMarkers(text.data)) {
    if (token.type === 'open') {
      stack.push({ id: token.id, node: text, offset: token.index + token.length, element: parent });
      continue;
    }
    const open = stack.pop();
    if (open === undefined) continue;
    findings.push({
      kind: 'text',
      id: open.id,
      element: open.element,
      span: {
        startContainer: open.node,
        startOffset: open.offset,
        endContainer: text,
        endOffset: token.index,
      },
    });
  }
}

function scanElement(element: Element, stack: OpenMarker[], findings: ScanFinding[]): void {
  if (SKIPPED_TAGS.has(element.tagName) || element.hasAttribute(INSPECTOR_UI_ATTRIBUTE)) return;
  scanAttributes(element, findings);
  // Option text is reported on its select (above); never as a text range.
  if (element instanceof HTMLSelectElement) return;
  const depth = stack.length;
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) scanText(child as Text, element, stack, findings);
    else if (child.nodeType === Node.ELEMENT_NODE) scanElement(child as Element, stack, findings);
  }
  // A marker opened in this element and never closed (text cut short) ends
  // with the element, so it cannot swallow text that follows it.
  while (stack.length > depth) {
    const open = stack.pop();
    if (open === undefined) break;
    findings.push({
      kind: 'text',
      id: open.id,
      element: open.element,
      span: {
        startContainer: open.node,
        startOffset: open.offset,
        endContainer: element,
        endOffset: element.childNodes.length,
      },
    });
  }
}

export function scanForFallbacks(root: Element): ScanFinding[] {
  const findings: ScanFinding[] = [];
  scanElement(root, [], findings);
  return findings;
}
