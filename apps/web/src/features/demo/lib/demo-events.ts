/**
 * Demo Events Catalog
 *
 * Single source of truth for demo-mode PostHog business events. The text
 * marketing sees for an event (settings panel, #1787) is copy, so it lives in
 * the `demo.events` namespace keyed by the event name and is read with
 * `useDemoEventDescriptions` - a test keeps the two in step. `group`
 * drives the settings panel's per-group toggles and is discovered from this
 * catalog, never hand-maintained. Props must stay low-cardinality — bounded
 * strings/numbers/booleans only, never PII, free text, or entity ids.
 *
 * `props` values are placeholders (empty string / 0 / false per field), not
 * real data — they exist so the settings panel's read-only catalog view
 * (#1787) can introspect prop *names* via `Object.keys` at runtime, while
 * `DemoEventProps<E>` still gives callers the real value types via the `as`
 * cast.
 *
 * @module features/demo/lib
 */

export const DemoEventCatalog = {
  demo_viewer_locked_action_clicked: {
    group: 'conversion-intent',
    props: { actionName: '', surface: '' } as { actionName: string; surface: string },
  },

  // ── E-commerce reel (#1788) ──────────────────────────────────────────
  demo_products_viewed: {
    group: 'ecommerce-reel',
    props: { resultCountBucket: '' } as { resultCountBucket: string },
  },
  demo_product_row_expanded: {
    group: 'ecommerce-reel',
    props: {} as Record<string, never>,
  },
  demo_offer_create_launched: {
    group: 'ecommerce-reel',
    props: { source: 'row' } as { source: 'row' | 'bulk_bar' },
  },
  demo_offer_marketplace_picked: {
    group: 'ecommerce-reel',
    props: { platform: '' } as { platform: string },
  },
  demo_offer_wizard_step_advanced: {
    group: 'ecommerce-reel',
    props: { platform: '', step: '' } as { platform: string; step: string },
  },
  demo_offer_wizard_review_reached: {
    group: 'ecommerce-reel',
    props: { platform: '' } as { platform: string },
  },
  demo_offer_create_attempted: {
    group: 'conversion-intent',
    props: { platform: '', mode: '' } as { platform: string; mode: string },
  },
  demo_orders_viewed: {
    group: 'ecommerce-reel',
    props: {} as Record<string, never>,
  },
  demo_orders_filtered: {
    group: 'ecommerce-reel',
    props: { filter: '', value: '' } as { filter: string; value: string },
  },
  demo_order_opened: {
    group: 'ecommerce-reel',
    props: {} as Record<string, never>,
  },
  demo_label_form_opened: {
    group: 'ecommerce-reel',
    props: { entry: 'empty_state' } as { entry: 'empty_state' | 'active_shipment_row' },
  },
  demo_label_generate_attempted: {
    group: 'conversion-intent',
    props: { carrier: '' } as { carrier: string },
  },
  demo_invoice_doctype_changed: {
    group: 'ecommerce-reel',
    props: { documentType: '' } as { documentType: string },
  },
  demo_invoice_issue_attempted: {
    group: 'conversion-intent',
    props: {} as Record<string, never>,
  },
  demo_fiscal_register_attempted: {
    group: 'conversion-intent',
    props: {} as Record<string, never>,
  },

  // ── Connections / product import (#1789) ─────────────────────────────
  demo_connection_platform_selected: {
    group: 'connections-reel',
    props: { platformType: '' } as { platformType: string },
  },
  demo_adapters_catalog_viewed: {
    group: 'connections-reel',
    props: { adapterCountBucket: '' } as { adapterCountBucket: string },
  },
  demo_connections_filtered: {
    group: 'connections-reel',
    props: { filter: '', value: '' } as { filter: string; value: string },
  },
  demo_connection_wizard_step_advanced: {
    group: 'connections-reel',
    props: { platform: '', step: '' } as { platform: string; step: string },
  },
  demo_connection_create_attempted: {
    group: 'conversion-intent',
    props: { platform: '' } as { platform: string },
  },
  demo_connection_test_attempted: {
    group: 'conversion-intent',
    props: { platform: '' } as { platform: string },
  },
  demo_connection_sync_dialog_opened: {
    group: 'connections-reel',
    props: {} as Record<string, never>,
  },

  // ── Category mapping (#1789) ──────────────────────────────────────────
  demo_category_mapping_opened: {
    group: 'category-mapping-reel',
    props: { mappedCountBucket: '' } as { mappedCountBucket: string },
  },
  demo_category_source_selected: {
    group: 'category-mapping-reel',
    props: {} as Record<string, never>,
  },
  demo_category_map_attempted: {
    group: 'category-mapping-reel',
    props: {} as Record<string, never>,
  },
  demo_mapping_save_attempted: {
    group: 'category-mapping-reel',
    props: { mappingKind: '' } as { mappingKind: string },
  },

  // ── KSeF invoice numbering (#1789) ────────────────────────────────────
  demo_ksef_numbering_tab_switched: {
    group: 'ksef-numbering-reel',
    props: { tab: '' } as { tab: string },
  },
  demo_ksef_series_editor_opened: {
    group: 'ksef-numbering-reel',
    props: { mode: 'create' } as { mode: 'create' | 'edit' },
  },
  demo_ksef_numbering_variable_inserted: {
    group: 'ksef-numbering-reel',
    props: { variable: '' } as { variable: string },
  },
  demo_ksef_series_save_attempted: {
    group: 'conversion-intent',
    props: { mode: 'create' } as { mode: 'create' | 'edit' },
  },

  // ── AI descriptions (#1790) ──────────────────────────────────────────
  demo_ai_suggest_attempted: {
    group: 'conversion-intent',
    props: { channel: '' } as { channel: string },
  },
  demo_content_publish_attempted: {
    group: 'ai-descriptions',
    props: { channel: '' } as { channel: string },
  },

  // ── Open source (#1790) ──────────────────────────────────────────────
  demo_opensource_link_clicked: {
    group: 'opensource',
    props: { location: '' } as { location: string },
  },

  // ── Cross-cutting baseline (#1790) ───────────────────────────────────
  demo_login_succeeded: {
    group: 'baseline',
    props: { role: '' } as { role: string },
  },
  demo_command_palette_opened: {
    group: 'baseline',
    props: { trigger: 'keyboard' } as { trigger: 'keyboard' | 'click' },
  },
  demo_command_palette_result_selected: {
    group: 'baseline',
    props: { source: '' } as { source: string },
  },
} as const;

export type DemoEventName = keyof typeof DemoEventCatalog;

export type DemoEventGroup = (typeof DemoEventCatalog)[DemoEventName]['group'];

export type DemoEventProps<E extends DemoEventName> = (typeof DemoEventCatalog)[E]['props'];
