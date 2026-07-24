/**
 * Demo Events Catalog
 *
 * Single source of truth for demo-mode PostHog business events. Each entry's
 * `description` is the text marketing sees (settings panel, #1787); `group`
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
    description:
      'Viewer clicked a locked (read-only) write action — the primary intent-to-convert signal for a read-only demo session',
    group: 'conversion-intent',
    props: { actionName: '', surface: '' } as { actionName: string; surface: string },
  },

  // ── E-commerce reel (#1788) ──────────────────────────────────────────
  demo_products_viewed: {
    description: 'Viewer loaded the products list',
    group: 'ecommerce-reel',
    props: { resultCountBucket: '' } as { resultCountBucket: string },
  },
  demo_product_row_expanded: {
    description: 'Viewer expanded a product row for more detail (mobile card view)',
    group: 'ecommerce-reel',
    props: {} as Record<string, never>,
  },
  demo_offer_create_launched: {
    description: 'Viewer launched the offer-creation flow for one or more products',
    group: 'ecommerce-reel',
    props: { source: 'row' } as { source: 'row' | 'bulk_bar' },
  },
  demo_offer_marketplace_picked: {
    description: 'Viewer picked a marketplace connection to create an offer on',
    group: 'ecommerce-reel',
    props: { platform: '' } as { platform: string },
  },
  demo_offer_wizard_step_advanced: {
    description: 'Viewer advanced a step in the offer-creation wizard',
    group: 'ecommerce-reel',
    props: { platform: '', step: '' } as { platform: string; step: string },
  },
  demo_offer_wizard_review_reached: {
    description: 'Viewer reached the review step of the offer-creation wizard',
    group: 'ecommerce-reel',
    props: { platform: '' } as { platform: string },
  },
  demo_offer_create_attempted: {
    description:
      'Viewer clicked "Create offer(s)" — the locked write action — the primary offer-creation intent-to-convert signal',
    group: 'conversion-intent',
    props: { platform: '', mode: '' } as { platform: string; mode: string },
  },
  demo_orders_viewed: {
    description: 'Viewer loaded the orders list',
    group: 'ecommerce-reel',
    props: {} as Record<string, never>,
  },
  demo_orders_filtered: {
    description: 'Viewer applied a filter on the orders list',
    group: 'ecommerce-reel',
    props: { filter: '', value: '' } as { filter: string; value: string },
  },
  demo_order_opened: {
    description: 'Viewer opened an order detail page',
    group: 'ecommerce-reel',
    props: {} as Record<string, never>,
  },
  demo_label_form_opened: {
    description: 'Viewer opened the generate-shipping-label form',
    group: 'ecommerce-reel',
    props: { entry: 'empty_state' } as { entry: 'empty_state' | 'active_shipment_row' },
  },
  demo_label_generate_attempted: {
    description: 'Viewer clicked "Generate label" — the primary shipment-intent signal',
    group: 'conversion-intent',
    props: { carrier: '' } as { carrier: string },
  },
  demo_invoice_doctype_changed: {
    description: 'Viewer changed the invoice document type before issuing',
    group: 'ecommerce-reel',
    props: { documentType: '' } as { documentType: string },
  },
  demo_invoice_issue_attempted: {
    description:
      'Viewer clicked "Issue invoice" — the locked write action — the primary invoicing intent-to-convert signal',
    group: 'conversion-intent',
    props: {} as Record<string, never>,
  },

  // ── Connections / product import (#1789) ─────────────────────────────
  demo_connection_platform_selected: {
    description: 'Viewer picked a platform card on the new-connection page',
    group: 'connections-reel',
    props: { platformType: '' } as { platformType: string },
  },
  demo_adapters_catalog_viewed: {
    description: 'Viewer loaded the adapters catalog page',
    group: 'connections-reel',
    props: { adapterCountBucket: '' } as { adapterCountBucket: string },
  },
  demo_connections_filtered: {
    description: 'Viewer applied a filter on the connections list',
    group: 'connections-reel',
    props: { filter: '', value: '' } as { filter: string; value: string },
  },
  demo_connection_wizard_step_advanced: {
    description: 'Viewer advanced a step in a platform connection setup wizard',
    group: 'connections-reel',
    props: { platform: '', step: '' } as { platform: string; step: string },
  },
  demo_connection_create_attempted: {
    description:
      'Viewer clicked "Create connection" — the locked write action — the primary connection-creation intent-to-convert signal',
    group: 'conversion-intent',
    props: { platform: '' } as { platform: string },
  },
  demo_connection_test_attempted: {
    description:
      'Viewer clicked "Test connection" — the locked write action — the primary connection-test intent-to-convert signal',
    group: 'conversion-intent',
    props: { platform: '' } as { platform: string },
  },
  demo_connection_sync_dialog_opened: {
    description: 'Viewer opened the Trigger sync dialog for a connection',
    group: 'connections-reel',
    props: {} as Record<string, never>,
  },

  // ── Category mapping (#1789) ──────────────────────────────────────────
  demo_category_mapping_opened: {
    description: 'Viewer opened the category mapping page for a connection',
    group: 'category-mapping-reel',
    props: { mappedCountBucket: '' } as { mappedCountBucket: string },
  },
  demo_category_source_selected: {
    description: 'Viewer changed the marketplace/source connection on the category mapping page',
    group: 'category-mapping-reel',
    props: {} as Record<string, never>,
  },
  demo_category_map_attempted: {
    description:
      'Viewer selected a category to map (not gated — the server may reject an invalid pairing, still a valid intent signal)',
    group: 'category-mapping-reel',
    props: {} as Record<string, never>,
  },
  demo_mapping_save_attempted: {
    description:
      'Viewer clicked "Save mappings" on a mapping panel (not gated — the server may reject the save)',
    group: 'category-mapping-reel',
    props: { mappingKind: '' } as { mappingKind: string },
  },

  // ── KSeF invoice numbering (#1789) ────────────────────────────────────
  demo_ksef_numbering_tab_switched: {
    description: 'Viewer switched tabs on the KSeF numbering page',
    group: 'ksef-numbering-reel',
    props: { tab: '' } as { tab: string },
  },
  demo_ksef_series_editor_opened: {
    description: 'Viewer opened the KSeF numbering series editor',
    group: 'ksef-numbering-reel',
    props: { mode: 'create' } as { mode: 'create' | 'edit' },
  },
  demo_ksef_numbering_variable_inserted: {
    description: 'Viewer inserted a numbering variable into the series template',
    group: 'ksef-numbering-reel',
    props: { variable: '' } as { variable: string },
  },
  demo_ksef_series_save_attempted: {
    description:
      'Viewer clicked "Save series" — the locked write action — the primary KSeF-numbering intent-to-convert signal',
    group: 'conversion-intent',
    props: { mode: 'create' } as { mode: 'create' | 'edit' },
  },
} as const;

export type DemoEventName = keyof typeof DemoEventCatalog;

export type DemoEventGroup = (typeof DemoEventCatalog)[DemoEventName]['group'];

export type DemoEventProps<E extends DemoEventName> = (typeof DemoEventCatalog)[E]['props'];
