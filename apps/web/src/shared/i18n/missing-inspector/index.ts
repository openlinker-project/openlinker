/**
 * Missing-translation inspector (#4017)
 *
 * Development-only. With `VITE_I18N_HIGHLIGHT_MISSING=true` and a language
 * other than English active, every text that fell back to English is marked
 * on the real screen and listed in a panel, including text that never reaches
 * the DOM (it is recorded when read). `main.tsx` reaches this module only
 * through a dynamic `import()` behind `import.meta.env.DEV`, so a production
 * bundle contains none of it; `scripts/check-i18n-inspector-not-in-build.mjs`
 * proves that by looking for `MISSING_INSPECTOR_SENTINEL` in a build.
 *
 * @module shared/i18n/missing-inspector
 */
import { getLocale } from '../active-locale';
import { installMessagesInstrumentation } from '../messages';
import { SOURCE_LOCALE, type SupportedLocale } from '../i18n.types';
import { stripMarkers, hasMarker } from './markers';
import { createOverlay, MISSING_ATTRIBUTE, OUTLINE_ATTRIBUTE } from './overlay';
import { createPanel } from './panel';
import { buildPanelGroups, formatPanelList, type PanelRow } from './panel-model';
import { createReadTracker } from './read-tracker';
import { createFallbackRegistry } from './registry';
import { INSPECTOR_UI_ATTRIBUTE, scanForFallbacks, type ScanFinding } from './scan';

/** Present in every chunk that carries the inspector; the build check looks for it. */
export const MISSING_INSPECTOR_SENTINEL = '__OL_I18N_MISSING_INSPECTOR__';

const LANGUAGE_NAMES: Readonly<Record<SupportedLocale, string>> = { pl: 'Polish', en: 'English' };
const SCAN_DELAY_MS = 120;

function isInspectorNode(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(`[${INSPECTOR_UI_ATTRIBUTE}]`) != null;
}

function isOwnMutation(record: MutationRecord): boolean {
  if (isInspectorNode(record.target)) return true;
  return (
    record.type === 'attributes' &&
    (record.attributeName === MISSING_ATTRIBUTE || record.attributeName === OUTLINE_ATTRIBUTE)
  );
}

function marksActive(): boolean {
  return getLocale() !== SOURCE_LOCALE && document.documentElement.dataset.pseudoLocale !== 'true';
}

function installClipboardStripping(): void {
  document.addEventListener('copy', (event) => {
    const selected = window.getSelection()?.toString() ?? '';
    if (!hasMarker(selected) || event.clipboardData === null) return;
    event.clipboardData.setData('text/plain', stripMarkers(selected));
    event.preventDefault();
  });
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') return;
  const writeText = clipboard.writeText.bind(clipboard);
  clipboard.writeText = (text: string): Promise<void> => writeText(stripMarkers(text));
}

/**
 * Patches history so a route change is seen before the new screen renders,
 * not after: the reads the new screen makes must not be cleared with the
 * old screen's.
 */
function onPathnameChange(listener: () => void): void {
  let pathname = window.location.pathname;
  const check = (): void => {
    if (window.location.pathname === pathname) return;
    pathname = window.location.pathname;
    listener();
  };
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History['pushState']>): void => {
      original(...args);
      check();
    };
  }
  window.addEventListener('popstate', check);
}

/**
 * Install before the first `loadMessages`, so every merge is tagged. Safe to
 * call once; it starts watching the page as soon as the body exists.
 */
export function installMissingInspector(): void {
  const registry = createFallbackRegistry();
  const tracker = createReadTracker();
  installMessagesInstrumentation({ tagger: registry, wrap: tracker.wrap });
  installClipboardStripping();

  const start = (): void => {
    const overlay = createOverlay(registry.get, MISSING_INSPECTOR_SENTINEL);
    let keepAcrossRoutes = false;
    let findings: readonly ScanFinding[] = [];
    let lastSignature = '';

    const panel = createPanel(MISSING_INSPECTOR_SENTINEL, {
      onSelect: (row: PanelRow) => {
        const target = row.target;
        if (target === null) return;
        target.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        window.setTimeout(() => {
          if (target.kind === 'text') {
            const range = document.createRange();
            try {
              range.setStart(target.span.startContainer, target.span.startOffset);
              range.setEnd(target.span.endContainer, target.span.endOffset);
              overlay.flash(range);
              return;
            } catch {
              // The text changed since the scan; flash its element instead.
            }
          }
          overlay.flash(target.element);
        }, 350);
      },
      onCopy: (text) => {
        void navigator.clipboard?.writeText(text);
      },
      onKeepAcrossRoutesChange: (keep) => {
        keepAcrossRoutes = keep;
      },
    });

    let timer: number | undefined;
    const flush = (): void => {
      timer = undefined;
      if (!marksActive()) {
        overlay.clear();
        panel.setVisible(false);
        findings = [];
        return;
      }
      findings = scanForFallbacks(document.body);
      overlay.paint(findings);
      const groups = buildPanelGroups(findings, tracker.reads, registry.get);
      const signature = `${getLocale()}|${formatPanelList(groups)}|${groups
        .flatMap((group) => group.rows.map((row) => row.usages.join(',')))
        .join(';')}`;
      panel.setVisible(true);
      if (signature !== lastSignature) {
        lastSignature = signature;
        panel.render(groups, LANGUAGE_NAMES[getLocale()]);
      }
    };
    const schedule = (): void => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => requestAnimationFrame(flush), SCAN_DELAY_MS);
    };

    new MutationObserver((records) => {
      if (records.every(isOwnMutation)) return;
      schedule();
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'aria-description', 'alt', 'value'],
    });
    // A controlled input's value changes without an attribute mutation.
    document.addEventListener('input', schedule, true);
    tracker.onRead(schedule);
    onPathnameChange(() => {
      if (!keepAcrossRoutes) tracker.clear();
      schedule();
    });

    let repositioning = false;
    const reposition = (): void => {
      if (repositioning || findings.length === 0) return;
      repositioning = true;
      requestAnimationFrame(() => {
        repositioning = false;
        overlay.reposition();
      });
    };
    window.addEventListener('scroll', reposition, { capture: true, passive: true });
    window.addEventListener('resize', reposition, { passive: true });
    schedule();
  };

  if (document.body === null) document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
