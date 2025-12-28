/**
 * PrestaShop Product Mapper
 *
 * Maps PrestaShop product and combination data to OpenLinker unified schema.
 * Handles localization, field mapping, and data normalization.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 * @implements {IPrestashopProductMapper}
 */
import { IPrestashopProductMapper, PrestashopProduct, PrestashopCombination } from './prestashop.mapper.interface';
import { Product, ProductVariant } from '@openlinker/core/products';

/**
 * PrestaShop Product Mapper
 *
 * Transforms PrestaShop product data to OpenLinker Product schema.
 */
export class PrestashopProductMapper implements IPrestashopProductMapper {
  mapProduct(prestashopProduct: PrestashopProduct, langId: number = 1): Omit<Product, 'id'> {
    return {
      name: this.getLocalizedField(prestashopProduct.name, langId) || '',
      sku: this.getStringField(prestashopProduct.reference) || '',
      description: this.getLocalizedField(prestashopProduct.description, langId),
      price: this.parseNumber(prestashopProduct.price) || 0,
      currency: 'EUR', // Default, can be configured
      weight: this.parseNumber(prestashopProduct.weight),
      images: this.extractImages(prestashopProduct),
      categories: this.extractCategories(prestashopProduct),
      createdAt: this.parseDate(prestashopProduct.date_add),
      updatedAt: this.parseDate(prestashopProduct.date_upd),
    };
  }

  mapVariant(combination: PrestashopCombination, productId: string): Omit<ProductVariant, 'id'> {
    const attributes: Record<string, string> = {};

    // Extract attributes from product_option_values
    if (combination.associations?.product_option_values?.product_option_value) {
      const optionValues = Array.isArray(combination.associations.product_option_values.product_option_value)
        ? combination.associations.product_option_values.product_option_value
        : [combination.associations.product_option_values.product_option_value];

      // Note: In a full implementation, we'd need to fetch option value names
      // For MVP, we'll use the IDs as attribute keys
      optionValues.forEach((ov, index) => {
        attributes[`option_${index}`] = String(ov.id);
      });
    }

    return {
      productId,
      sku: this.getStringField(combination.reference) || '',
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      price: this.parseNumber(combination.price),
      weight: this.parseNumber(combination.weight),
    };
  }

  /**
   * Get localized field value
   *
   * PrestaShop returns localized fields in format:
   * - XML: { language: [{ '#text': 'value', '@_id': '1' }] }
   * - JSON: { language: [{ value: 'text', id: '1' }] } or direct string
   */
  private getLocalizedField(
    field: unknown,
    langId: number,
  ): string | undefined {
    if (!field) {
      return undefined;
    }

    // Direct string value
    if (typeof field === 'string') {
      return field;
    }

    // Object with language array
    if (field && typeof field === 'object') {
      const fieldObj = field as Record<string, unknown>;
      const language = fieldObj.language;

      if (Array.isArray(language)) {
        // Find matching language
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const langEntry = language.find((entry: unknown) => {
          if (entry && typeof entry === 'object') {
            const entryObj = entry as Record<string, unknown>;
            const id = entryObj['@_id'] || entryObj.id;
            return String(id) === String(langId);
          }
          return false;
        }) as Record<string, unknown> | undefined;

        if (langEntry && typeof langEntry === 'object') {
          const langEntryObj = langEntry;
          return (langEntryObj['#text'] || langEntryObj.value || langEntryObj.text) as string | undefined;
        }

        // Fallback to first entry
        if (language.length > 0 && language[0] && typeof language[0] === 'object') {
          const firstEntry = language[0] as Record<string, unknown>;
          return (firstEntry['#text'] || firstEntry.value || firstEntry.text) as string | undefined;
        }
      } else if (language && typeof language === 'object') {
        // Single language object
        const langObj = language as Record<string, unknown>;
        return (langObj['#text'] || langObj.value || langObj.text) as string | undefined;
      }
    }

    return undefined;
  }

  /**
   * Extract images from PrestaShop product
   */
  private extractImages(product: PrestashopProduct): string[] | undefined {
    // PrestaShop images are typically in associations.images
    // For MVP, we'll handle basic cases
    if (product.associations && typeof product.associations === 'object') {
      const associations = product.associations as Record<string, unknown>;
      if (associations.images) {
        // Handle image associations if present
        // Full implementation would fetch image URLs
        return undefined; // Placeholder
      }
    }
    return undefined;
  }

  /**
   * Extract categories from PrestaShop product
   */
  private extractCategories(product: PrestashopProduct): string[] | undefined {
    // PrestaShop categories are in associations.categories
    if (product.associations && typeof product.associations === 'object') {
      const associations = product.associations as Record<string, unknown>;
      if (associations.categories) {
        const categories = associations.categories as Record<string, unknown>;
        const categoryList = categories.category;

        if (Array.isArray(categoryList)) {
          return categoryList.map((cat) => {
            if (cat && typeof cat === 'object') {
              const catObj = cat as Record<string, unknown>;
              return String(catObj.id || catObj['@_id'] || '');
            }
            return String(cat);
          });
        } else if (categoryList && typeof categoryList === 'object') {
          const catObj = categoryList as Record<string, unknown>;
          return [String(catObj.id || catObj['@_id'] || '')];
        }
      }
    }
    return undefined;
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

