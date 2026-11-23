/**
 * Mirakl Catalogue
 *
 * The read side of listing on a Mirakl operator (#4278):
 *
 * - **Categories** (`CategoryBrowser`): H11. A node's children are read with
 *   `max_level=2`, which also returns their children, so a child with none is
 *   a leaf without a second request per child. Ancestors come back too and
 *   are dropped.
 * - **Category parameters** (`CategoryParametersReader`): PM11 card attributes
 *   for a category, with each LIST attribute's values from VL11, read once per
 *   list per call.
 * - **Card match** (`EanCategoryMatcher`): P31 by EAN, up to 100 EANs per
 *   request. One card is a match with its category; several are a
 *   `multi-match`; a failed request answers `no-match` for its EANs and never
 *   fails the batch.
 *
 * Results feed the destination taxonomy projection, so the pickers, category
 * mappings and attribute rules work for the operator like for Allegro.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type {
  BatchCategoryByEanInput,
  CategoryParameter,
  EanMatchResult,
  OfferCategory,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import { mapMiraklAttribute } from '../../domain/policies/mirakl-category-parameter.policy';
import type {
  MiraklCatalogCard,
  MiraklHierarchy,
  MiraklProductAttribute,
  MiraklValueList,
} from '../../domain/types/mirakl-catalog.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';

const HIERARCHIES_PATH = '/api/hierarchies';
const ATTRIBUTES_PATH = '/api/products/attributes';
const VALUE_LISTS_PATH = '/api/values_lists';
const PRODUCTS_PATH = '/api/products';
/** EANs per P31 request. */
const P31_BATCH_SIZE = 100;
const LIST_TYPES = new Set(['LIST', 'LIST_MULTIPLE_VALUES']);

export class MiraklCatalog {
  private readonly logger = new Logger(MiraklCatalog.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient
  ) {}

  async fetchCategories(parentId?: string): Promise<OfferCategory[]> {
    const { data } = await this.httpClient.get<{ hierarchies?: readonly MiraklHierarchy[] }>(
      HIERARCHIES_PATH,
      { queryParams: { ...(parentId && { hierarchy: parentId }), max_level: 2 } }
    );
    const nodes = (data?.hierarchies ?? []).filter((node) => node.code);
    const parent = parentId ?? '';
    const withChildren = new Set(nodes.map((node) => node.parent_code ?? ''));
    return nodes
      .filter((node) => (node.parent_code ?? '') === parent)
      .map((node) => ({
        id: node.code as string,
        name: node.label?.trim() || (node.code as string),
        parentId: parentId ?? null,
        leaf: !withChildren.has(node.code as string),
      }));
  }

  async fetchCategoryParameters(input: { categoryId: string }): Promise<CategoryParameter[]> {
    const { data } = await this.httpClient.get<{ attributes?: readonly MiraklProductAttribute[] }>(
      ATTRIBUTES_PATH,
      { queryParams: { hierarchy: input.categoryId } }
    );
    const attributes = data?.attributes ?? [];
    const lists = await this.readValueLists(attributes);
    // PM11 lists an attribute once per hierarchy level that declares it (seen
    // on staging: the title three times). One parameter per code, required if
    // any level requires it.
    const byCode = new Map<string, CategoryParameter>();
    for (const attribute of attributes) {
      const parameter = mapMiraklAttribute(
        attribute,
        attribute.values_list ? lists.get(attribute.values_list) : undefined
      );
      if (!parameter) continue;
      const seen = byCode.get(parameter.id);
      byCode.set(
        parameter.id,
        seen ? { ...seen, required: seen.required || parameter.required } : parameter
      );
    }
    return [...byCode.values()];
  }

  async resolveCategoriesForBatchByEan(
    input: BatchCategoryByEanInput
  ): Promise<Map<string, EanMatchResult>> {
    const result = new Map<string, EanMatchResult>();
    const byEan = new Map<string, string[]>();
    for (const item of input.items) {
      const ean = item.ean?.trim();
      if (!ean) {
        result.set(item.variantId, { kind: 'no-ean' });
        continue;
      }
      byEan.set(ean, [...(byEan.get(ean) ?? []), item.variantId]);
    }
    const eans = [...byEan.keys()];
    for (let start = 0; start < eans.length; start += P31_BATCH_SIZE) {
      const chunk = eans.slice(start, start + P31_BATCH_SIZE);
      const cards = await this.findCards(chunk);
      for (const ean of chunk) {
        const match = toMatch(cards.get(ean) ?? []);
        for (const variantId of byEan.get(ean) ?? []) {
          result.set(variantId, match);
        }
      }
    }
    return result;
  }

  /** Cards for these EANs, keyed by EAN; a failed read answers none. */
  async findCards(eans: readonly string[]): Promise<Map<string, MiraklCatalogCard[]>> {
    const cards = new Map<string, MiraklCatalogCard[]>();
    if (eans.length === 0) {
      return cards;
    }
    try {
      const { data } = await this.httpClient.get<{ products?: readonly MiraklCatalogCard[] }>(
        PRODUCTS_PATH,
        { queryParams: { product_references: eans.map((ean) => `EAN|${ean}`).join(',') } }
      );
      for (const card of data?.products ?? []) {
        if (!card.product_id) continue;
        cards.set(card.product_id, [...(cards.get(card.product_id) ?? []), card]);
      }
    } catch (error) {
      this.logger.warn(
        `Card lookup for ${eans.length} EAN(s) on connection ${this.connectionId} failed: ` +
          `${error instanceof Error ? error.name : 'error'}`
      );
    }
    return cards;
  }

  private async readValueLists(
    attributes: readonly MiraklProductAttribute[]
  ): Promise<Map<string, MiraklValueList>> {
    const codes = new Set(
      attributes
        .filter(
          (attribute) =>
            attribute.values_list && LIST_TYPES.has((attribute.type ?? '').toUpperCase())
        )
        .map((attribute) => attribute.values_list as string)
    );
    const lists = new Map<string, MiraklValueList>();
    for (const code of codes) {
      try {
        const { data } = await this.httpClient.get<{ values_lists?: readonly MiraklValueList[] }>(
          VALUE_LISTS_PATH,
          { queryParams: { code } }
        );
        const list = (data?.values_lists ?? []).find((candidate) => candidate.code === code);
        if (list) lists.set(code, list);
      } catch (error) {
        // The attribute is then offered as free text rather than lost.
        this.logger.warn(
          `Value list ${code} on connection ${this.connectionId} could not be read: ` +
            `${error instanceof Error ? error.name : 'error'}`
        );
      }
    }
    return lists;
  }
}

function toMatch(cards: readonly MiraklCatalogCard[]): EanMatchResult {
  const usable = cards.filter((card) => card.category_code && card.product_sku);
  if (usable.length === 0) {
    return { kind: 'no-match' };
  }
  if (usable.length === 1) {
    return {
      kind: 'matched',
      allegroCategoryId: usable[0].category_code as string,
      productCardId: usable[0].product_sku as string,
    };
  }
  return {
    kind: 'multi-match',
    candidates: usable.map((card) => ({
      allegroCategoryId: card.category_code as string,
      productCardId: card.product_sku as string,
      ...(card.product_title && { name: card.product_title }),
    })),
  };
}
