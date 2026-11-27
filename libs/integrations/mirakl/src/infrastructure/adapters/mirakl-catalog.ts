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
 *   list per call, a few lists at a time. A list longer than
 *   {@link MAX_DICTIONARY_VALUES} is not sent: on Empik staging one book
 *   category names lists of 24 000, 33 000 and 321 000 entries (publishers,
 *   authors), several megabytes each, which made the wizard wait minutes and
 *   no picker can show. Such an attribute is offered as free text, and its
 *   name is matched against the whole list when OpenLinker creates a card
 *   (P41, #4278), and a name the list does not hold refuses the card before
 *   it is sent; a searchable picker is a follow-up. The attributes OpenLinker fills itself
 *   when it creates a card (category, title, images, VAT, ...) are left out of
 *   what the wizard is shown (`readCardAttributes` keeps them all).
 * - **Card match** (`EanCategoryMatcher` for the wizard, `CategoryBarcodeMatcher`
 *   for the offer build): P31 by EAN, up to 100 EANs per request. One card is
 *   a match with its category; several are a `multi-match`; a failed request
 *   answers `no-match` for its EANs and never fails the batch.
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
import { isMiraklCardAttributeFilledByOpenLinker } from '../../domain/policies/mirakl-card.policy';
import type { MiraklCardAttributeCodes } from '../../domain/types/mirakl-operator-profile.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';

const HIERARCHIES_PATH = '/api/hierarchies';
const ATTRIBUTES_PATH = '/api/products/attributes';
const VALUE_LISTS_PATH = '/api/values_lists';
const PRODUCTS_PATH = '/api/products';
/** EANs per P31 request. */
const P31_BATCH_SIZE = 100;
const LIST_TYPES = new Set(['LIST', 'LIST_MULTIPLE_VALUES']);
/** Above this, a value list is not sent as a dictionary (see the header). */
export const MAX_DICTIONARY_VALUES = 1000;
/** VL11 requests in flight at once for one category. */
const VALUE_LIST_CONCURRENCY = 4;

export class MiraklCatalog {
  private readonly logger = new Logger(MiraklCatalog.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    /** The attributes OpenLinker fills on a card it creates; hidden from the wizard. */
    private readonly cardAttributes?: MiraklCardAttributeCodes
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

  /** The parameters the operator fills; the ones OpenLinker fills are left out. */
  async fetchCategoryParameters(input: { categoryId: string }): Promise<CategoryParameter[]> {
    const attributes = await this.readCardAttributes(input.categoryId);
    const codes = this.cardAttributes;
    return codes
      ? attributes.filter(
          (attribute) => !isMiraklCardAttributeFilledByOpenLinker(attribute.id, codes)
        )
      : attributes;
  }

  /**
   * Every card attribute of a category (PM11 + VL11), one per code. The value
   * lists of `fullListsFor` are read whatever their length: a card sends a
   * LIST attribute as the list's code, and the wizard offered a long list as
   * free text, so the typed name must be matched against the whole list.
   */
  async readCardAttributes(
    categoryId: string,
    fullListsFor: ReadonlySet<string> = new Set()
  ): Promise<CategoryParameter[]> {
    const input = { categoryId };
    const { data } = await this.httpClient.get<{ attributes?: readonly MiraklProductAttribute[] }>(
      ATTRIBUTES_PATH,
      { queryParams: { hierarchy: input.categoryId } }
    );
    const attributes = data?.attributes ?? [];
    const lists = await this.readValueLists(attributes, fullListsFor);
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

  /** One EAN's card category, or `null` for no card, several cards or a failed read. */
  async matchCategoryByBarcode(barcode: string): Promise<string | null> {
    const ean = barcode.trim();
    if (!ean) {
      return null;
    }
    const match = toMatch((await this.findCards([ean])).get(ean) ?? []);
    return match.kind === 'matched' ? match.allegroCategoryId : null;
  }

  /**
   * Cards for these EANs, keyed by EAN; a failed read answers none. For the
   * wizard's matching, where "no match" is a safe answer; an offer create
   * uses {@link readCards}, because there a failed read is not "no card".
   */
  async findCards(eans: readonly string[]): Promise<Map<string, MiraklCatalogCard[]>> {
    try {
      return await this.readCards(eans);
    } catch (error) {
      this.logger.warn(
        `Card lookup for ${eans.length} EAN(s) on connection ${this.connectionId} failed: ` +
          `${error instanceof Error ? error.name : 'error'}`
      );
      return new Map();
    }
  }

  /** Cards for these EANs, keyed by EAN; a failed read throws. */
  async readCards(eans: readonly string[]): Promise<Map<string, MiraklCatalogCard[]>> {
    const cards = new Map<string, MiraklCatalogCard[]>();
    if (eans.length === 0) {
      return cards;
    }
    const { data } = await this.httpClient.get<{ products?: readonly MiraklCatalogCard[] }>(
      PRODUCTS_PATH,
      { queryParams: { product_references: eans.map((ean) => `EAN|${ean}`).join(',') } }
    );
    for (const card of data?.products ?? []) {
      if (!card.product_id) continue;
      cards.set(card.product_id, [...(cards.get(card.product_id) ?? []), card]);
    }
    return cards;
  }

  private async readValueLists(
    attributes: readonly MiraklProductAttribute[],
    fullListsFor: ReadonlySet<string> = new Set()
  ): Promise<Map<string, MiraklValueList>> {
    const uncapped = new Set(
      attributes
        .filter((attribute) => attribute.code && fullListsFor.has(attribute.code))
        .map((attribute) => attribute.values_list)
        .filter((code): code is string => Boolean(code))
    );
    const codes = new Set(
      attributes
        .filter(
          (attribute) =>
            attribute.values_list && LIST_TYPES.has((attribute.type ?? '').toUpperCase())
        )
        .map((attribute) => attribute.values_list as string)
    );
    const lists = new Map<string, MiraklValueList>();
    const pending = [...codes];
    const worker = async (): Promise<void> => {
      for (let code = pending.shift(); code !== undefined; code = pending.shift()) {
        const list = await this.readValueList(code, !uncapped.has(code));
        if (list) lists.set(code, list);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(VALUE_LIST_CONCURRENCY, pending.length) }, worker)
    );
    return lists;
  }

  /** One VL11 list, or `undefined` when it cannot be read or is too long to send. */
  private async readValueList(code: string, capped = true): Promise<MiraklValueList | undefined> {
    try {
      const { data } = await this.httpClient.get<{ values_lists?: readonly MiraklValueList[] }>(
        VALUE_LISTS_PATH,
        { queryParams: { code } }
      );
      const list = (data?.values_lists ?? []).find((candidate) => candidate.code === code);
      if (capped && list && (list.values?.length ?? 0) > MAX_DICTIONARY_VALUES) {
        this.logger.debug(
          `Value list ${code} on connection ${this.connectionId} has ` +
            `${list.values?.length} entries; offered as free text`
        );
        return undefined;
      }
      return list;
    } catch (error) {
      // The attribute is then offered as free text rather than lost. A list
      // past the client's response cap lands here too.
      this.logger.warn(
        `Value list ${code} on connection ${this.connectionId} could not be read: ` +
          `${error instanceof Error ? error.name : 'error'}`
      );
      return undefined;
    }
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
