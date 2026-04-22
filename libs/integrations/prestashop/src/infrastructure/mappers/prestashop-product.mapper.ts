/**
 * PrestaShop Product Mapper
 *
 * Maps PrestaShop product and combination data to OpenLinker unified schema.
 * Handles localization, field mapping, and data normalization.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 * @implements {IPrestashopProductMapper}
 */
import { Product, ProductVariant, normalizeBarcode, normalizeToEan13 } from '@openlinker/core/products';
import { IPrestashopProductMapper, PrestashopProduct, PrestashopCombination } from './prestashop.mapper.interface';
import { PrestashopProductMapperOptions } from './prestashop-product.mapper.types';

/**
 * PrestaShop Product Mapper
 *
 * Transforms PrestaShop product data to OpenLinker Product schema.
 */
export class PrestashopProductMapper implements IPrestashopProductMapper {
  constructor(private readonly options: PrestashopProductMapperOptions) {}

  mapProduct(prestashopProduct: PrestashopProduct, langId: number = 1): Omit<Product, 'id'> {
    // Extract localized fields with fallback to empty string for name (required field)
    const name = this.getLocalizedField(prestashopProduct.name, langId) || '';
    const description = this.getLocalizedField(prestashopProduct.description, langId) ?? null;
    const images = this.extractImages(prestashopProduct) ?? null;

    return {
      name,
      sku: this.getStringField(prestashopProduct.reference) || '',
      description,
      price: this.parseNumber(prestashopProduct.price) || 0,
      currency: 'EUR', // Default, can be configured
      weight: this.parseNumber(prestashopProduct.weight),
      images,
      categories: this.extractCategories(prestashopProduct),
      createdAt: this.parseDate(prestashopProduct.date_add),
      updatedAt: this.parseDate(prestashopProduct.date_upd),
    };
  }

  mapVariant(combination: PrestashopCombination, productId: string): Omit<ProductVariant, 'id'> {
    const attributes: Record<string, string> = {};
    const ean = normalizeToEan13(combination.ean13 ?? null);
    const gtin = normalizeBarcode(combination.upc ?? null);

    // Extract attributes from product_option_values.
    // Handles both XML-parsed shape ({ product_option_value: [...] | {...} })
    // and JSON shape ([...] directly) — see unwrapAssociationEntries.
    const optionValues = this.unwrapAssociationEntries(
      combination.associations?.product_option_values,
      'product_option_value',
    );
    optionValues.forEach((ov, index) => {
      const id = this.readAssociationId(ov);
      if (id !== null) {
        attributes[`option_${index}`] = id;
      }
    });

    return {
      productId,
      sku: this.getStringField(combination.reference) || null,
      attributes: Object.keys(attributes).length > 0 ? attributes : null,
      ean,
      gtin,
      price: this.parseNumber(combination.price),
      weight: this.parseNumber(combination.weight),
    };
  }

  /**
   * Get localized field value
   *
   * Robustly extracts localized field values from PrestaShop responses.
   * Handles multiple XML/JSON shapes, CDATA variants, and language selection.
   *
   * PrestaShop returns localized fields in various formats:
   * - XML: { language: [{ '#text': 'value', '@_id': '1' }] } or { language: { '#text': 'value', '@_id': '1' } }
   * - JSON: { language: [{ value: 'text', id: '1' }] } or direct string
   * - CDATA variants: '#text', '__cdata', direct string
   *
   * @param field - Raw field value (string, object with language nodes, etc.)
   * @param preferredLangId - Preferred language ID (defaults to 1)
   * @returns Extracted text value (trimmed, or undefined if empty/whitespace)
   */
  private getLocalizedField(
    field: unknown,
    preferredLangId: number = 1,
  ): string | undefined {
    if (!field) {
      return undefined;
    }

    // Direct string value (already localized or non-localized field)
    if (typeof field === 'string') {
      const trimmed = field.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }

    // Handle JSON format: array of { id, value } objects
    // PrestaShop JSON API returns: [{ id: 1, value: '...' }, { id: 2, value: '...' }]
    if (Array.isArray(field)) {
      const languageNodes = field.filter(
        (node): node is Record<string, unknown> =>
          node !== null && typeof node === 'object',
      );

      if (languageNodes.length === 0) {
        return undefined;
      }

      // Try to find preferred language first
      const preferredLang = languageNodes.find((node) => {
        const nodeId = node.id;
        return nodeId !== null && nodeId !== undefined && String(nodeId) === String(preferredLangId);
      });

      if (preferredLang) {
        const text = preferredLang.value;
        if (text !== null && text !== undefined) {
          const textStr = String(text).trim();
          if (textStr.length > 0) {
            return textStr;
          }
        }
      }

      // Fallback: find first non-empty language node
      for (const node of languageNodes) {
        const text = node.value;
        if (text !== null && text !== undefined) {
          const textStr = String(text).trim();
          if (textStr.length > 0) {
            return textStr;
          }
        }
      }

      return undefined;
    }

    // Handle XML format: object with language nodes
    // PrestaShop XML API returns: { language: [{ '#text': ..., '@_id': ... }] }
    if (field && typeof field === 'object') {
      const fieldObj = field as Record<string, unknown>;
      const language = fieldObj.language;

      // Normalize language to array (handles both single object and array)
      const languageNodes = this.normalizeLanguageNodes(language);
      if (languageNodes.length === 0) {
        return undefined;
      }

      // Try to find preferred language first
      const preferredLang = languageNodes.find((node) => {
        const nodeId = this.extractLanguageId(node);
        return nodeId !== null && String(nodeId) === String(preferredLangId);
      });

      if (preferredLang) {
        const text = this.extractTextFromLanguageNode(preferredLang);
        if (text) {
          return text;
        }
      }

      // Fallback: find first non-empty language node
      for (const node of languageNodes) {
        const text = this.extractTextFromLanguageNode(node);
        if (text) {
          return text;
        }
      }
    }

    return undefined;
  }

  /**
   * Normalize language nodes to array
   *
   * Handles both single language object and array of language objects.
   *
   * @param language - Language node(s) from parsed XML/JSON
   * @returns Array of language node objects
   */
  private normalizeLanguageNodes(language: unknown): Array<Record<string, unknown>> {
    if (!language) {
      return [];
    }

    if (Array.isArray(language)) {
      return language.filter(
        (node): node is Record<string, unknown> =>
          node !== null && typeof node === 'object',
      );
    }

    if (typeof language === 'object' && language !== null) {
      return [language as Record<string, unknown>];
    }

    return [];
  }

  /**
   * Extract language ID from a language node
   *
   * Handles various attribute/key names: '@_id', 'id', '@id'
   *
   * @param node - Language node object
   * @returns Language ID (as string or number) or null if not found
   */
  private extractLanguageId(node: Record<string, unknown>): string | number | null {
    // Try common attribute names (XML parser variants)
    const id = node['@_id'] ?? node['@id'] ?? node.id;
    if (id !== null && id !== undefined) {
      // Ensure id is a primitive (string or number), not an object
      if (typeof id === 'string' || typeof id === 'number') {
        return id;
      }
      // If it's an object, try to extract a value (shouldn't happen, but be defensive)
      if (typeof id === 'object' && id !== null) {
        return null;
      }
    }
    return null;
  }

  /**
   * Extract text content from a language node
   *
   * Handles multiple CDATA/text extraction variants:
   * - '#text' (fast-xml-parser default)
   * - '__cdata' (some XML parser variants)
   * - 'value' (JSON format)
   * - 'text' (alternative key)
   * - Direct string value
   *
   * @param node - Language node object
   * @returns Extracted text (trimmed) or undefined if empty/whitespace
   */
  private extractTextFromLanguageNode(node: Record<string, unknown>): string | undefined {
    // Try multiple text extraction keys (in order of likelihood)
    const textKeys = ['#text', '__cdata', 'value', 'text'];
    for (const key of textKeys) {
      const content = node[key];
      if (content !== null && content !== undefined) {
        if (typeof content === 'string') {
          const trimmed = content.trim();
          if (trimmed.length > 0) {
            return trimmed;
          }
        }
        // If content is not a string, try converting (shouldn't happen, but be defensive)
        if (content !== '') {
          const asString = String(content).trim();
          if (asString.length > 0) {
            return asString;
          }
        }
      }
    }

    // If node itself is a string (edge case) - this shouldn't happen with Record<string, unknown>
    // but handle it defensively
    if (typeof node === 'string') {
      const trimmed = (node as string).trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }

    return undefined;
  }

  /**
   * Extract public image URLs from a PrestaShop product response.
   *
   * PrestaShop serializes `associations.images` in one of two shapes depending
   * on the response format:
   *   - XML (parsed by fast-xml-parser): `{ image: [...] | {...} }`
   *   - JSON (`output_format=JSON`):     `[...]` directly (the `<image>` wrapper
   *     is collapsed into a flat array)
   * `unwrapAssociationEntries` normalises both into a single list. Each entry
   * carries its numeric id under either `id` or `@_id`. Preserves PrestaShop's
   * order — the first element is treated as the cover.
   *
   * Returns `undefined` when no images can be extracted (no associations, empty
   * collection, or every entry malformed). `undefined` — not `null` — matches
   * the rest of this mapper, which relies on downstream consumers to convert
   * `undefined → null` at persistence boundaries.
   */
  private extractImages(product: PrestashopProduct): string[] | undefined {
    if (!product.associations || typeof product.associations !== 'object') {
      return undefined;
    }

    const associations = product.associations as Record<string, unknown>;
    const entries = this.unwrapAssociationEntries(associations.images, 'image');

    const urls: string[] = [];
    for (const entry of entries) {
      const id = this.readAssociationId(entry);
      if (id === null) {
        continue;
      }
      urls.push(this.buildImageUrl(id));
    }

    return urls.length > 0 ? urls : undefined;
  }

  /**
   * Normalise a PrestaShop association node into a flat list of entries.
   *
   * PrestaShop serializes associations in two different shapes depending on the
   * response format requested:
   *   - XML (parsed by fast-xml-parser) preserves the `<singularKey>` wrapper:
   *     `{ [singularKey]: [...] | {...} }`
   *   - JSON (`output_format=JSON`) collapses the wrapper into a flat array at
   *     the plural node: `[...]`
   *
   * This helper accepts either shape and always returns an array (possibly
   * empty). Callers can then iterate uniformly.
   */
  private unwrapAssociationEntries(node: unknown, singularKey: string): unknown[] {
    if (node === null || node === undefined) {
      return [];
    }

    // JSON shape: the plural node is already a flat array of entries.
    if (Array.isArray(node)) {
      return node;
    }

    // XML shape: the plural node is an object with the singular key inside.
    if (typeof node === 'object') {
      const inner = (node as Record<string, unknown>)[singularKey];
      if (inner === null || inner === undefined) {
        return [];
      }
      return Array.isArray(inner) ? inner : [inner];
    }

    return [];
  }

  /**
   * Extract a string id from a single association entry.
   *
   * PrestaShop returns ids under `id` (JSON) or `@_id` / `@id` (XML parsed by
   * `fast-xml-parser`, depending on attribute-prefix config). Defensive against
   * primitive entries (the node itself a string/number), object entries with
   * any of the id keys, and anything else (returns null so the caller can
   * skip). String/number ids are accepted; other types are rejected.
   *
   * Shared across `extractImages`, `extractCategories`, and `mapVariant` so the
   * set of accepted id keys stays in one place.
   */
  private readAssociationId(entry: unknown): string | null {
    if (entry === null || entry === undefined) {
      return null;
    }

    if (typeof entry === 'string' || typeof entry === 'number') {
      const asString = String(entry).trim();
      return asString.length > 0 ? asString : null;
    }

    if (typeof entry === 'object') {
      const node = entry as Record<string, unknown>;
      const rawId = node.id ?? node['@_id'] ?? node['@id'];
      if (typeof rawId === 'string' || typeof rawId === 'number') {
        const asString = String(rawId).trim();
        return asString.length > 0 ? asString : null;
      }
    }

    return null;
  }

  /**
   * Build a public front-office image URL for a given PrestaShop image id.
   *
   * Uses the numeric path format (`/img/p/{split}/{id}-{type}.jpg`) which
   * PrestaShop serves regardless of "Friendly URL" configuration. `split` is
   * the image id with digits separated by `/` (e.g. `123` → `1/2/3`). Digit
   * splitting handles arbitrarily long ids.
   *
   * TODO: image type ('home_default') is fixed for v1. Expose via options
   * when detail-page or retina sizes land.
   */
  private buildImageUrl(imageId: string): string {
    const base = this.options.storefrontBaseUrl.replace(/\/+$/, '');
    const split = this.splitImageId(imageId);
    return `${base}/img/p/${split}/${imageId}-home_default.jpg`;
  }

  /**
   * Split a numeric id into a `/`-separated character path.
   *
   * Every character of the input becomes one path segment, separated by `/`.
   * Examples: `'1'` → `'1'`, `'42'` → `'4/2'`, `'123'` → `'1/2/3'`.
   *
   * Caller is responsible for supplying numeric ids — PrestaShop image ids
   * are numeric in practice, and `readAssociationId` rejects anything that
   * isn't `string | number` before reaching this helper. Non-digit input
   * would still be split character-by-character rather than stripped.
   */
  private splitImageId(id: string): string {
    return id.split('').join('/');
  }

  /**
   * Extract categories from PrestaShop product.
   *
   * Handles both response shapes via `unwrapAssociationEntries`:
   *   - XML: `associations.categories = { category: [...] | {...} }`
   *   - JSON: `associations.categories = [...]`
   */
  private extractCategories(product: PrestashopProduct): string[] | undefined {
    if (!product.associations || typeof product.associations !== 'object') {
      return undefined;
    }
    const associations = product.associations as Record<string, unknown>;
    const entries = this.unwrapAssociationEntries(associations.categories, 'category');
    if (entries.length === 0) {
      return undefined;
    }
    const ids: string[] = [];
    for (const entry of entries) {
      const id = this.readAssociationId(entry);
      if (id !== null) {
        ids.push(id);
      }
    }
    return ids.length > 0 ? ids : undefined;
  }

  /**
   * Parse number field (handles string or number)
   */
  private parseNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }

  /**
   * Parse string field
   */
  private getStringField(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    return String(value);
  }

  /**
   * Parse date field
   */
  private parseDate(value: unknown): Date | undefined {
    if (!value) {
      return undefined;
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? undefined : parsed;
    }
    return undefined;
  }
}

