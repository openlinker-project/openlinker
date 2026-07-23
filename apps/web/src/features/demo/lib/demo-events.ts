/**
 * Demo Events Catalog
 *
 * Single source of truth for demo-mode PostHog business events. Each entry's
 * `description` is the text marketing sees (settings panel, #1787); `group`
 * drives the settings panel's per-group toggles and is discovered from this
 * catalog, never hand-maintained. Props must stay low-cardinality — bounded
 * strings/numbers/booleans only, never PII, free text, or entity ids.
 *
 * @module features/demo/lib
 */

export const DemoEventCatalog = {
  demo_viewer_locked_action_clicked: {
    description:
      'Viewer clicked a locked (read-only) write action — the primary intent-to-convert signal for a read-only demo session',
    group: 'conversion-intent',
    props: {} as { actionName: string; surface: string },
  },
} as const;

export type DemoEventName = keyof typeof DemoEventCatalog;

export type DemoEventGroup = (typeof DemoEventCatalog)[DemoEventName]['group'];

export type DemoEventProps<E extends DemoEventName> = (typeof DemoEventCatalog)[E]['props'];
