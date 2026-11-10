/**
 * Bundle definition and the pure component expansion (#3607, ADR-083)
 *
 * A bundle is an ordinary master variant that OpenLinker additionally knows the
 * composition of. The buyer, the documents and the channel see the bundle line;
 * stock, reservations, routing and packing see its components. The expansion is
 * pure so every site derives the same answer from the same frozen definitions.
 *
 * @module libs/core/src/products/domain/types
 */

/**
 * The gift forms on a document: the ONE vocabulary orders, promotions and
 * bundles share (restated here because `products` cannot import `orders`, which
 * imports it). `gift-document-form-parity.spec.ts` keeps the lists equal.
 */
export const BundleGiftDocumentFormValues = [
  'technical-cent',
  'custom-price',
  'priced-in',
  'show-zero',
  'omit',
] as const;

/**
 * What a bundle's gift slot may be set to. `custom-price` is a valid form but
 * needs an amount, and a slot carries none (the definition freezes only the
 * form), so it is not offered or accepted here; setting it would only fall back
 * to the technical cent on the document.
 */
export const BundleGiftSlotFormValues = [
  'technical-cent',
  'priced-in',
  'show-zero',
  'omit',
] as const;
export type BundleGiftDocumentForm = (typeof BundleGiftSlotFormValues)[number];

export function isBundleGiftDocumentForm(value: unknown): value is BundleGiftDocumentForm {
  return typeof value === 'string' && (BundleGiftSlotFormValues as readonly string[]).includes(value);
}

/** One component of a bundle: units of a master variant per ONE bundle unit. */
export interface BundleComponent {
  variantId: string;
  /** Carried so a stock site never has to resolve it again (ADR-083 decision 4). */
  productId: string;
  quantity: number;
  /** This component is the free gift of the set (#3934 owns its presentation). */
  giftSlot?: boolean;
  /**
   * How a document shows this gift slot. Meaningful only with `giftSlot`;
   * absent means "as in settings" (#3940).
   */
  documentForm?: BundleGiftDocumentForm;
}

/** The composition of a bundle variant, one immutable row per version. */
export interface BundleDefinition {
  variantId: string;
  components: BundleComponent[];
  version: number;
  /**
   * Set only on a LINE-scoped definition frozen into an order (#3624): a
   * confirmed multipack, or a bundle sold with a pack quantity. It applies to
   * that one line and never to another line of the same variant. Never present
   * on a stored `bundle_definitions` row.
   */
  lineId?: string;
}

/** A confirmed multipack: variant X sold at pack quantity N means N units of X. */
export interface MultipackConfirmation {
  variantId: string;
  packQuantity: number;
}

/** One historical version, with the instant it was written (#3624). */
export interface BundleDefinitionVersion extends BundleDefinition {
  createdAt: Date;
  /** The version was retired (the bundle was deleted); it is no longer in force. */
  retired?: boolean;
}

/** Separator between the bundle line id and the component variant id. */
export const COMPONENT_LINE_ID_SEPARATOR = '~c:';

/** `{lineId}~c:{variantId}` - the physical line id of one component of a bundle line. */
export function buildComponentLineId(lineId: string, componentVariantId: string): string {
  return `${lineId}${COMPONENT_LINE_ID_SEPARATOR}${componentVariantId}`;
}

/** The minimal line shape the expansion reads; `OrderItem` satisfies it structurally. */
export interface ExpandableLine {
  id: string;
  productId: string;
  variantId?: string;
  quantity: number;
}

/**
 * A physical line: either the commercial line unchanged, or one aggregated
 * component of a bundle line. `parentLineId` is set only on components and is
 * how a caller maps a component back to the commercial line.
 */
export type PhysicalLine<T extends ExpandableLine> = T & {
  parentLineId?: string;
  giftSlot?: boolean;
  /** The gift slot's own document form, carried from the frozen definition (#3940). */
  giftDocumentForm?: BundleGiftDocumentForm;
};

/**
 * Expand bundle lines to their components.
 *
 * Quantities are aggregated per component variant BEFORE a line is emitted, so
 * a definition listing one component twice cannot produce two rows with the
 * same id (a duplicate `(work, orderLineId)` or `(order, line, position)` key).
 * `packQuantity` is deliberately ignored: it is only a signal that a line is a
 * multipack, and the quantities come from the definition, never multiplied on
 * top of it.
 */
export function expandBundleLines<T extends ExpandableLine>(
  items: readonly T[],
  definitions: readonly BundleDefinition[]
): PhysicalLine<T>[] {
  if (definitions.length === 0) {
    return [...items];
  }
  const byVariant = new Map(
    definitions.filter((d) => d.lineId === undefined).map((d) => [d.variantId, d])
  );
  const byLine = new Map(
    definitions.filter((d) => d.lineId !== undefined).map((d) => [d.lineId as string, d])
  );
  const physical: PhysicalLine<T>[] = [];
  for (const item of items) {
    const definition =
      byLine.get(item.id) ??
      (item.variantId === undefined ? undefined : byVariant.get(item.variantId));
    if (definition === undefined) {
      physical.push(item);
      continue;
    }
    const aggregated = new Map<string, BundleComponent>();
    for (const component of definition.components) {
      const existing = aggregated.get(component.variantId);
      aggregated.set(
        component.variantId,
        existing === undefined
          ? { ...component }
          : {
              ...existing,
              quantity: existing.quantity + component.quantity,
              giftSlot: existing.giftSlot === true && component.giftSlot === true ? true : undefined,
              // Two slots that disagree on the form fall back to "as in settings".
              documentForm:
                existing.documentForm === component.documentForm ? existing.documentForm : undefined,
            }
      );
    }
    for (const component of aggregated.values()) {
      const line: PhysicalLine<T> = {
        ...item,
        id: buildComponentLineId(item.id, component.variantId),
        productId: component.productId,
        variantId: component.variantId,
        quantity: item.quantity * component.quantity,
        parentLineId: item.id,
      };
      if (component.giftSlot === true) {
        line.giftSlot = true;
        if (isBundleGiftDocumentForm(component.documentForm)) {
          line.giftDocumentForm = component.documentForm;
        }
      }
      physical.push(line);
    }
  }
  return physical;
}

/** One component of a bundle line, with its aggregated units per ONE bundle unit. */
export interface ComponentLineRef {
  componentLineId: string;
  perUnit: number;
}

/**
 * The components of one commercial line, empty when it is not a bundle line.
 * What the order-edit follow-ups scale by: lowering a bundle line to Q means
 * every component line is lowered to `Q * perUnit`.
 */
export function componentRefsFor(
  lineId: string,
  items: readonly ExpandableLine[],
  definitions: readonly BundleDefinition[]
): ComponentLineRef[] {
  const line = items.find((item) => item.id === lineId);
  if (line === undefined) {
    return [];
  }
  // Expanded at ONE unit so the per-unit composition does not depend on the
  // line's current (possibly edited to 0) quantity.
  const expanded = expandBundleLines([{ ...line, quantity: 1 }], definitions);
  if (expanded.length === 1 && expanded[0].id === lineId) {
    return [];
  }
  return expanded.map((l) => ({ componentLineId: l.id, perUnit: l.quantity }));
}

/** The physical line ids a commercial line expands to, or `[lineId]` when it is not a bundle. */
export function componentLineIdsFor(
  lineId: string,
  items: readonly ExpandableLine[],
  definitions: readonly BundleDefinition[]
): string[] {
  const line = items.find((item) => item.id === lineId);
  if (line === undefined) {
    return [lineId];
  }
  const expanded = expandBundleLines([line], definitions);
  return expanded.length === 1 && expanded[0].id === lineId ? [lineId] : expanded.map((l) => l.id);
}

/**
 * The frozen expansion persisted on `order_records.lineExpansion`: only the
 * definitions that applied to this order's lines at ingestion. Keyed by bundle
 * variant, so a later quantity edit scales the components without re-reading
 * the live definition.
 */
export interface LineExpansion {
  v: 1;
  definitions: BundleDefinition[];
}

/**
 * The line-scoped definitions an order's lines need at freeze time (#3624).
 * `confirmed` lists the multipacks the operator has confirmed. A line with a
 * pack quantity N > 1 gets its own definition: the variant's bundle components
 * times N when the variant is a bundle, else N units of the variant itself
 * when confirmed. A line neither confirmed nor a bundle gets none.
 */
export function buildPackLineDefinitions(
  items: readonly (ExpandableLine & { packQuantity?: number })[],
  definitions: readonly BundleDefinition[],
  confirmed: readonly MultipackConfirmation[]
): BundleDefinition[] {
  const result: BundleDefinition[] = [];
  for (const item of items) {
    const n = item.packQuantity;
    if (item.variantId === undefined || n === undefined || n <= 1) {
      continue;
    }
    const bundle = definitions.find((d) => d.lineId === undefined && d.variantId === item.variantId);
    if (bundle !== undefined) {
      result.push({
        variantId: bundle.variantId,
        version: bundle.version,
        lineId: item.id,
        components: bundle.components.map((c) => ({ ...c, quantity: c.quantity * n })),
      });
    } else if (confirmed.some((c) => c.variantId === item.variantId && c.packQuantity === n)) {
      result.push({
        variantId: item.variantId,
        version: 0,
        lineId: item.id,
        components: [{ variantId: item.variantId, productId: item.productId, quantity: n }],
      });
    }
  }
  return result;
}

export const EMPTY_LINE_EXPANSION: LineExpansion = { v: 1, definitions: [] };

function isBundleComponent(value: unknown): value is BundleComponent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return (
    typeof c.variantId === 'string' &&
    typeof c.productId === 'string' &&
    typeof c.quantity === 'number' &&
    Number.isFinite(c.quantity) &&
    c.quantity > 0
  );
}

/**
 * Coerce a persisted `lineExpansion`. Never throws: anything unrecognised reads
 * as `null`, i.e. "no expansion", so a physical list falls back to the
 * commercial one rather than failing an order read.
 */
export function readLineExpansion(value: unknown): LineExpansion | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1 || !Array.isArray(raw.definitions)) {
    return null;
  }
  const definitions: BundleDefinition[] = [];
  for (const entry of raw.definitions) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const d = entry as Record<string, unknown>;
    if (
      typeof d.variantId === 'string' &&
      typeof d.version === 'number' &&
      Array.isArray(d.components) &&
      d.components.length > 0 &&
      d.components.every(isBundleComponent)
    ) {
      definitions.push({
        variantId: d.variantId,
        version: d.version,
        components: d.components.map((c) => ({ ...c })),
        ...(typeof d.lineId === 'string' ? { lineId: d.lineId } : {}),
      });
    }
  }
  return { v: 1, definitions };
}
