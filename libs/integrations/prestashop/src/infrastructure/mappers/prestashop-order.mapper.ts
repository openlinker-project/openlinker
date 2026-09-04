/**
 * PrestaShop Order Mapper
 *
 * Maps PrestaShop order and order_detail data to OpenLinker Order schema.
 * Handles customer information, addresses, line items, and totals.
 * Also maps OpenLinker OrderCreate to the PrestaShop CART the order-processor
 * adapter creates before handing off to the OL module's `importorder`
 * endpoint, where PrestaShop's own `validateOrder` builds the order (ADR-016 /
 * #905). The raw-webservice order body this mapper used to build was removed
 * with #2102 - see ADR-016 for why that surface no longer exists.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 * @implements {IPrestashopOrderMapper}
 */
import type {
  IPrestashopOrderMapper,
  MappedPrestashopOrder,
  PrestashopOrder,
  PrestashopOrderRow,
} from './prestashop.mapper.interface';
import type { OrderItem, OrderTotals } from '@openlinker/core/orders';
import type { OrderCreate } from '@openlinker/core/orders';
import { PrestashopProvisioningException } from '@openlinker/integrations-prestashop';
import { PrestashopCurrencyUnknownException } from '../../domain/exceptions/prestashop-currency-unknown.exception';
import { PrestashopParseException } from '../../domain/exceptions/prestashop-parse.exception';
import { Logger } from '@openlinker/shared/logging';
import { toPrestashopProductAttributeId } from './prestashop-variant-id';

/**
 * Default values for PrestaShop cart creation. Kept at module scope as the
 * single source of truth. Future enhancement: move to connection config so
 * per-store overrides don't require a code change.
 */
// No DEFAULT_CURRENCY_ID (#2139). Currency is the one field here that must not
// have a default: id 1 is not EUR and not the shop default (currency ids are
// auto-increment and localization-pack dependent), and line amounts are the
// buyer-paid source numerals (#895 / ADR-014), so substituting an id books the
// order with the right numbers under the wrong denomination. The caller
// resolves the id or refuses (`PrestashopCurrencyResolver`); an absent id is
// refused here too rather than filled in.
const DEFAULT_LANGUAGE_ID = 1; // First language
const DEFAULT_CARRIER_ID = 1; // First carrier

/**
 * PrestaShop Order Mapper
 *
 * Transforms PrestaShop order data to OpenLinker Order schema.
 */
export class PrestashopOrderMapper implements IPrestashopOrderMapper {
  private readonly logger = new Logger(PrestashopOrderMapper.name);
  mapOrder(
    prestashopOrder: PrestashopOrder,
    orderRows: PrestashopOrderRow[]
  ): MappedPrestashopOrder {
    // Strictly 1:1 and order-preserving: `PrestashopOrderSourceAdapter` re-correlates
    // `mapped.items[i]` back to `orderRows[i]` positionally to build each product ref.
    // Filtering or reordering rows here would silently mis-pair every later line.
    const items: OrderItem[] = orderRows.map((row, index) => {
      // PrestaShop uses "0" or 0 to indicate no variant, treat as undefined
      const variantId =
        row.product_attribute_id &&
        String(row.product_attribute_id) !== '0' &&
        row.product_attribute_id !== 0
          ? String(row.product_attribute_id)
          : undefined;

      return {
        id: this.resolveOrderRowId(row, index, prestashopOrder.id),
        productId: '', // Will be set by adapter using identifier mapping
        variantId,
        quantity: this.parseNumber(row.product_quantity) || 0,
        price: this.parseNumber(row.product_price) || 0,
        sku: this.getStringField(row.product_reference),
      };
    });

    // Map totals. No `currency` (#2277): the order's denomination lives behind a
    // `GET /currencies/{id}` read keyed on `id_currency`, and this mapper does no
    // I/O. `PrestashopOrderCurrencyResolver` supplies it in the adapter. Until
    // then this line read `currency: 'EUR', // Default, can be configured` -
    // nothing ever configured it, so every PrestaShop order in the system was
    // denominated EUR whatever the buyer paid in.
    const totals: Omit<OrderTotals, 'currency'> = {
      subtotal: this.parseNumber(prestashopOrder.total_paid_tax_excl) || 0,
      tax:
        (this.parseNumber(prestashopOrder.total_paid_tax_incl) || 0) -
        (this.parseNumber(prestashopOrder.total_paid_tax_excl) || 0),
      shipping: this.parseNumber(prestashopOrder.total_shipping) || 0,
      total: this.parseNumber(prestashopOrder.total_paid_tax_incl) || 0,
      // PrestaShop's line prices (`order_details.product_price`, mapped onto
      // `OrderItem.price` above) are net — `specific_price` and every catalogue
      // read this adapter does elsewhere already treat them that way (#2440).
      //
      // #2835: this net-priced-lines fact is why `invoicing`/`fiscalization`
      // permanently refuse a PrestaShop order (`describeNetPricedOrderRefusal`,
      // `@openlinker/core/sales-documents`) — `total` being genuinely gross
      // (below) does not change that the LINES this guard cares about are net,
      // and core may never compute tax to convert them.
      taxTreatment: 'exclusive',
    };

    return {
      orderNumber: this.getStringField(prestashopOrder.reference),
      customerId: prestashopOrder.id_customer ? String(prestashopOrder.id_customer) : undefined,
      items,
      totals,
      shippingAddress: undefined, // Will be fetched separately if needed
      billingAddress: undefined, // Will be fetched separately if needed
      createdAt: this.parseDate(prestashopOrder.date_add) || new Date(),
      updatedAt: this.parseDate(prestashopOrder.date_upd) || new Date(),
    };
  }

  /**
   * Resolve an `order_details` row's stable line id (#2068).
   *
   * The value is `ps_order_detail.id_order_detail` — an AUTO_INCREMENT primary key. It is the ONLY
   * stable per-line identity available: a content-derived key such as
   * `${product_id}:${product_attribute_id}` is not unique within one order (customisation, free-gift
   * lines, warehouse splits and partial re-invoicing all produce sibling rows sharing that pair), and
   * a positional key is not stable across polls. Since `OrderItem.id` is persisted into the order
   * snapshot, rendered to operators and used as a React row key, any synthesised value would be a
   * silent defect rather than a visible one — so a row without an id is refused, not invented.
   *
   * `@_id` is read because the response parser expects ids to arrive as an XML attribute in some
   * shapes (`prestashop-response.parser.ts`), where `row.id` would be `undefined`.
   */
  private resolveOrderRowId(
    row: PrestashopOrderRow,
    index: number,
    orderId: string | number | undefined,
  ): string {
    // Both shapes are tried by the same presence test rather than `??`, so a blank `id` still
    // falls through to `@_id`. `0` is present and must survive — which is the `||` bug this fixes.
    const rawId = [row.id, row['@_id']].find(
      (candidate) => candidate !== null && candidate !== undefined && String(candidate).trim() !== '',
    );

    if (rawId === undefined) {
      // Message-only: `responseBody` is documented as unbounded and this message reaches sync-job
      // storage and operator-visible error text, so the row itself is never serialised into it.
      // Position is 1-based — an operator counts order lines from 1, as `originalLineNumber` does.
      throw new PrestashopParseException(
        `PrestaShop order_details row at position ${index + 1} for order ${String(orderId ?? 'unknown')} has no id`,
      );
    }

    return String(rawId);
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

  /**
   * Map OrderCreate to PrestaShop cart format
   *
   * Creates a cart structure that can be used to create a cart in PrestaShop,
   * which is then required to create an order.
   *
   * #503: `externalCarrierId` MUST be set on the cart, not just the order
   * body. PS resolves the order's `id_carrier` from the cart at `POST /orders`
   * time and ignores the order body's `id_carrier` field.
   */
  mapCartCreate(
    orderCreate: OrderCreate,
    externalCustomerId: string | number,
    externalProductIds: Map<string, string | number>,
    externalVariantIds: Map<string, string | number>,
    externalShippingAddressId?: string | number,
    externalBillingAddressId?: string | number,
    externalCurrencyId?: string | number,
    externalLangId?: string | number,
    externalCarrierId?: number
  ): Record<string, unknown> {
    // Map cart rows (products)
    const cartRows = orderCreate.items.map((item, index) => {
      const externalProductId = externalProductIds.get(item.productId);
      if (!externalProductId) {
        // Log warning before throwing to help debug mapping issues
        this.logger.warn(
          `No external product ID found for internal product ID: ${item.productId}. ` +
            `This may indicate a missing product mapping or sync issue.`
        );
        throw new PrestashopProvisioningException(
          `No external product ID found for internal product ID: ${item.productId}`,
          undefined,
          undefined
        );
      }

      // Map variant ID if present. Synthetic-variant markers (`product:<n>`)
      // and unmapped variants collapse to 0 ("no combination") — shared with
      // the price-pinning path so the two never drift (#923).
      const externalVariantId = toPrestashopProductAttributeId(
        item.variantId ? externalVariantIds.get(item.variantId) : undefined
      );

      return {
        id: index + 1,
        id_product: externalProductId,
        id_product_attribute: externalVariantId,
        quantity: item.quantity,
      };
    });

    // The cart's `id_currency` is the live write the #2139 refusal protects:
    // `importorder` builds the PrestaShop context from `$cart->id_currency`,
    // and the cart-scoped `specific_prices` rows are keyed to the same id.
    // Unreachable today (the adapter's Step 0 guard guarantees a non-empty code
    // and the resolver returns a positive integer or throws), so this is
    // defence-in-depth - but it raises the same non-retryable class as every
    // other currency refusal on this path, since no retry can supply the id.
    if (externalCurrencyId === undefined || externalCurrencyId === '') {
      throw new PrestashopCurrencyUnknownException(
        'No PrestaShop currency id was resolved for this order, so its cart cannot ' +
          'be denominated. No cart was created.'
      );
    }

    // Build PrestaShop cart structure. id_carrier is set here because PS
    // resolves the order's carrier from the cart (#503).
    const prestashopCart: Record<string, unknown> = {
      id_customer: externalCustomerId,
      id_currency: externalCurrencyId,
      id_lang: externalLangId || DEFAULT_LANGUAGE_ID,
      id_carrier: externalCarrierId ?? DEFAULT_CARRIER_ID,
      associations: {
        cart_rows: {
          cart_row: cartRows,
        },
      },
    };

    // Add address IDs if provided
    if (externalShippingAddressId) {
      prestashopCart.id_address_delivery = externalShippingAddressId;
    }
    if (externalBillingAddressId) {
      prestashopCart.id_address_invoice = externalBillingAddressId;
    }
    // If only one address provided, use it for both delivery and invoice
    if (externalShippingAddressId && !externalBillingAddressId) {
      prestashopCart.id_address_invoice = externalShippingAddressId;
    }
    if (externalBillingAddressId && !externalShippingAddressId) {
      prestashopCart.id_address_delivery = externalBillingAddressId;
    }

    return prestashopCart;
  }
}
