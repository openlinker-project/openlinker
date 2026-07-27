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
} as const;

export type DemoEventName = keyof typeof DemoEventCatalog;

export type DemoEventGroup = (typeof DemoEventCatalog)[DemoEventName]['group'];

export type DemoEventProps<E extends DemoEventName> = (typeof DemoEventCatalog)[E]['props'];
