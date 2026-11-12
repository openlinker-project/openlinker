/**
 * Fallback scanner and panel model - unit tests
 *
 * @module shared/i18n/missing-inspector
 */
import { afterEach, describe, expect, it } from 'vitest';
import { encodeMarker } from './markers';
import { buildPanelGroups, formatPanelList } from './panel-model';
import { createFallbackRegistry } from './registry';
import { INSPECTOR_UI_ATTRIBUTE, scanForFallbacks } from './scan';

function textOf(span: { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number }): string {
  const range = document.createRange();
  range.setStart(span.startContainer, span.startOffset);
  range.setEnd(span.endContainer, span.endOffset);
  return range.toString();
}

/** Parses markup into a detached root, without assigning `innerHTML`. */
function rootFrom(markup: string): HTMLDivElement {
  const root = document.createElement('div');
  root.append(document.createRange().createContextualFragment(markup));
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('scanForFallbacks', () => {
  it('should find marked text, including a sentence split around a tag', () => {
    const root = rootFrom(`<p>${encodeMarker(1, 'Saved')}</p><p>${encodeMarker(2, 'Read the ')}<a>guide</a>${'\u2063\u2061'} first</p><p>Zapisano</p>`);

    const text = scanForFallbacks(root).filter((finding) => finding.kind === 'text');
    expect(text.map((finding) => finding.id)).toEqual([1, 2]);
    expect(text.map((finding) => (finding.kind === 'text' ? textOf(finding.span) : '')).map((value) =>
      value.replace(/[\u200B-\u200D\u2060-\u2064]/g, ''),
    )).toEqual(['Saved', 'Read the guide']);
  });

  it('should close a marker left open at the end of its element', () => {
    const root = rootFrom(`<span>\u2063\u2062\u200C\u2064Cut sho</span><span>after</span>`);
    const [finding] = scanForFallbacks(root);
    expect(finding?.kind).toBe('text');
    if (finding?.kind === 'text') expect(finding.element.textContent).toContain('Cut sho');
  });

  it('should report placeholders, each attribute, input values and select options', () => {
    const root = document.createElement('div');
    const input = document.createElement('input');
    input.setAttribute('placeholder', encodeMarker(1, 'Search'));
    input.value = encodeMarker(2, 'Default');
    const button = document.createElement('button');
    button.setAttribute('title', encodeMarker(3, 'Close'));
    button.setAttribute('aria-label', encodeMarker(4, 'Close dialog'));
    button.setAttribute('aria-description', encodeMarker(5, 'Closes'));
    const image = document.createElement('img');
    image.setAttribute('alt', encodeMarker(6, 'Logo'));
    const select = document.createElement('select');
    select.append(new Option(encodeMarker(7, 'All')), new Option('Wszystkie'));
    root.append(input, button, image, select);
    document.body.append(root);

    const attributes = scanForFallbacks(root).map((finding) =>
      finding.kind === 'attribute' ? `${finding.id}:${finding.attribute}` : `${finding.id}:text`,
    );
    expect(attributes).toEqual([
      '1:placeholder',
      '2:value',
      '3:title',
      '4:aria-label',
      '5:aria-description',
      '6:alt',
      '7:option',
    ]);
  });

  it('should skip the inspector UI and scripts', () => {
    const root = rootFrom(`<div ${INSPECTOR_UI_ATTRIBUTE}>${encodeMarker(1, 'x')}</div><script>${encodeMarker(2, 'y')}</script>`);
    expect(scanForFallbacks(root)).toEqual([]);
  });
});

describe('buildPanelGroups', () => {
  it('should list keys on screen with their usages and keys only read as not on screen', () => {
    const registry = createFallbackRegistry();
    const onScreen = registry.tag({ namespace: 'orders', path: ['title'], shown: 'Orders', kind: 'missing' });
    registry.tag({ namespace: 'ui', path: ['documentTitle'], shown: 'OpenLinker', kind: 'empty' });
    const root = rootFrom(`<h1>${onScreen}</h1><input placeholder="${onScreen}">`);

    const groups = buildPanelGroups(scanForFallbacks(root), new Set([1]), registry.get);
    expect(groups.map((group) => group.namespace)).toEqual(['orders', 'ui']);
    expect(groups[0]?.rows[0]?.usages).toEqual(['text', 'placeholder']);
    expect(groups[1]?.rows[0]?.usages).toEqual([]);
    expect(groups[1]?.rows[0]?.target).toBeNull();
    expect(formatPanelList(groups)).toBe('orders.title\nui.documentTitle');
  });
});
