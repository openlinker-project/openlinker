/**
 * Inspector panel
 *
 * A floating, collapsible list in the bottom corner: every key that fell
 * back to English on this screen, grouped by namespace, with where it is
 * used. Clicking a row scrolls to it and flashes it; "Copy list" copies
 * `namespace.keyPath` lines. Plain DOM outside React, so it neither renders
 * through the app's tree nor shows up in the scan; its text is developer
 * English and is never translated.
 *
 * @module shared/i18n/missing-inspector
 */
import { FALLBACK_KIND_LABELS } from './overlay';
import { countRows, formatPanelList, type PanelGroup, type PanelRow } from './panel-model';
import { INSPECTOR_UI_ATTRIBUTE } from './scan';

const STYLES = `
.i18n-inspector-panel {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 2147483001;
  width: min(440px, calc(100vw - 24px));
  max-height: min(60vh, 520px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--status-warning-border);
  border-radius: 8px;
  background: var(--bg-surface-elevated);
  color: var(--text-primary);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
  font: 12px/1.4 var(--font-sans);
}
.i18n-inspector-panel[hidden] { display: none; }
.i18n-inspector-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--status-warning-soft);
  border-radius: 8px 8px 0 0;
}
.i18n-inspector-panel__title {
  flex: 1;
  font-weight: 600;
  color: var(--status-warning-fg);
}
.i18n-inspector-panel button {
  font: inherit;
  padding: 2px 6px;
  border: 1px solid var(--status-warning-border);
  border-radius: 4px;
  background: var(--bg-surface);
  color: inherit;
  cursor: pointer;
}
.i18n-inspector-panel__body { overflow: auto; padding: 4px 0; }
.i18n-inspector-panel__options { display: flex; gap: 6px; padding: 4px 8px; align-items: center; }
.i18n-inspector-panel__group {
  padding: 6px 8px 2px;
  font: 600 11px/1.4 var(--font-mono);
  color: var(--text-muted);
  text-transform: uppercase;
}
.i18n-inspector-panel__row {
  display: block;
  width: 100%;
  text-align: left;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  padding: 4px 8px !important;
}
.i18n-inspector-panel__row:hover,
.i18n-inspector-panel__row:focus-visible { background: var(--bg-surface-hover) !important; }
.i18n-inspector-panel__key { font-family: var(--font-mono); font-weight: 600; }
.i18n-inspector-panel__text { color: var(--text-secondary); }
.i18n-inspector-panel__meta { font-family: var(--font-mono); font-size: 11px; color: var(--status-warning-fg); }
.i18n-inspector-panel__empty { padding: 8px; color: var(--text-muted); }
`;

export interface PanelCallbacks {
  readonly onSelect: (row: PanelRow) => void;
  readonly onCopy: (text: string) => void;
  readonly onKeepAcrossRoutesChange: (keep: boolean) => void;
}

export interface Panel {
  render(groups: readonly PanelGroup[], languageName: string): void;
  setVisible(visible: boolean): void;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function describeUsage(row: PanelRow): string {
  const where = row.usages.length > 0 ? row.usages.join(', ') : 'read but not on screen';
  return `${FALLBACK_KIND_LABELS[row.entry.kind]} · ${where}`;
}

export function createPanel(sentinel: string, callbacks: PanelCallbacks): Panel {
  const style = document.createElement('style');
  style.setAttribute(INSPECTOR_UI_ATTRIBUTE, sentinel);
  style.textContent = STYLES;
  document.head.append(style);

  const root = node('section', 'i18n-inspector-panel');
  root.setAttribute(INSPECTOR_UI_ATTRIBUTE, sentinel);
  root.setAttribute('aria-label', 'Missing translations');
  const header = node('div', 'i18n-inspector-panel__header');
  const title = node('span', 'i18n-inspector-panel__title');
  const copyButton = node('button', '', 'Copy list');
  copyButton.type = 'button';
  const toggle = node('button', '', 'Hide');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  header.append(title, copyButton, toggle);

  const options = node('label', 'i18n-inspector-panel__options');
  const keep = node('input', '');
  keep.type = 'checkbox';
  options.append(keep, document.createTextNode('Keep across routes'));
  const body = node('div', 'i18n-inspector-panel__body');
  root.append(header, options, body);
  document.body.append(root);

  let collapsed = false;
  let current: readonly PanelGroup[] = [];

  const applyCollapsed = (): void => {
    body.hidden = collapsed;
    options.hidden = collapsed;
    toggle.textContent = collapsed ? 'Show' : 'Hide';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    applyCollapsed();
  });
  copyButton.addEventListener('click', () => callbacks.onCopy(formatPanelList(current)));
  keep.addEventListener('change', () => callbacks.onKeepAcrossRoutesChange(keep.checked));

  return {
    render(groups, languageName): void {
      current = groups;
      title.textContent = `Missing in ${languageName}: ${countRows(groups)} on this screen`;
      if (groups.length === 0) {
        body.replaceChildren(node('div', 'i18n-inspector-panel__empty', 'Nothing falls back to English here.'));
        return;
      }
      const fragment = document.createDocumentFragment();
      for (const group of groups) {
        fragment.append(node('div', 'i18n-inspector-panel__group', group.namespace));
        for (const row of group.rows) {
          const button = node('button', 'i18n-inspector-panel__row');
          button.type = 'button';
          button.disabled = row.target === null;
          button.append(
            node('div', 'i18n-inspector-panel__key', row.entry.keyPath),
            node('div', 'i18n-inspector-panel__text', row.entry.text),
            node('div', 'i18n-inspector-panel__meta', describeUsage(row)),
          );
          button.addEventListener('click', () => callbacks.onSelect(row));
          fragment.append(button);
        }
      }
      body.replaceChildren(fragment);
    },
    setVisible(visible): void {
      root.hidden = !visible;
    },
  };
}
