/**
 * PrestaShop Order Mapper Tests
 *
 * Unit tests for PrestashopOrderMapper. Tests order mapping,
 * order item mapping, totals calculation, and status mapping.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers/__tests__
 */
import { PrestashopOrderMapper } from '../prestashop-order.mapper';
import { PrestashopCurrencyUnknownException } from '../../../domain/exceptions/prestashop-currency-unknown.exception';
import { PrestashopParseException } from '../../../domain/exceptions/prestashop-parse.exception';
import type { PrestashopOrder, PrestashopOrderRow } from '../prestashop.mapper.interface';
import type { OrderCreate } from '@openlinker/core/orders';

describe('PrestashopOrderMapper', () => {
  let mapper: PrestashopOrderMapper;

  beforeEach(() => {
    mapper = new PrestashopOrderMapper();
  });

  describe('mapOrder', () => {
    it('should map basic order fields', () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-001',
        current_state: '2',
        total_paid: '99.99',
        total_paid_tax_excl: '83.32',
        total_paid_tax_incl: '99.99',
        total_shipping: '5.00',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 10:00:00',
        id_customer: '10',
      };

      const orderRows: PrestashopOrderRow[] = [];

      const result = mapper.mapOrder(prestashopOrder, orderRows);

      expect(result.orderNumber).toBe('ORDER-001');
      expect(result.status).toBe('processing');
      expect(result.customerId).toBe('10');
      expect(result.items).toEqual([]);
      expect(result.totals.total).toBe(99.99);
    });

    it('should map order items correctly', () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-001',
        current_state: '2',
        total_paid: '99.99',
        total_paid_tax_excl: '83.32',
        total_paid_tax_incl: '99.99',
        total_shipping: '5.00',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 10:00:00',
      };

      const orderRows: PrestashopOrderRow[] = [
        {
          id: '1',
          id_order: '42',
          product_id: '10',
          product_attribute_id: '0',
          product_quantity: '2',
          product_price: '19.99',
          product_reference: 'PROD-001',
        },
        {
          id: '2',
          id_order: '42',
          product_id: '11',
          product_attribute_id: '5',
          product_quantity: '1',
          product_price: '29.99',
          product_reference: 'PROD-002',
        },
      ];

      const result = mapper.mapOrder(prestashopOrder, orderRows);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('1');
      expect(result.items[0].quantity).toBe(2);
      expect(result.items[0].price).toBe(19.99);
      expect(result.items[0].sku).toBe('PROD-001');
      expect(result.items[0].variantId).toBeUndefined();

      expect(result.items[1].id).toBe('2');
      expect(result.items[1].quantity).toBe(1);
      expect(result.items[1].price).toBe(29.99);
      expect(result.items[1].sku).toBe('PROD-002');
      expect(result.items[1].variantId).toBe('5');
    });

    it('should calculate totals correctly', () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-001',
        current_state: '2',
        total_paid: '99.99',
        total_paid_tax_excl: '83.32',
        total_paid_tax_incl: '99.99',
        total_shipping: '5.00',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 10:00:00',
      };

      const orderRows: PrestashopOrderRow[] = [];

      const result = mapper.mapOrder(prestashopOrder, orderRows);

      expect(result.totals.subtotal).toBe(83.32);
      expect(result.totals.tax).toBe(16.67); // 99.99 - 83.32
      expect(result.totals.shipping).toBe(5.0);
      expect(result.totals.total).toBe(99.99);
      // No `currency` (#2277). The mapper does no I/O, so it cannot resolve the
      // order's denomination; emitting a literal here is exactly how every
      // PrestaShop order came to be recorded as EUR. `PrestashopOrderSourceAdapter`
      // fills the field from `PrestashopOrderCurrencyResolver`.
      expect(result.totals).not.toHaveProperty('currency');
      // Line prices (`order_details.product_price`) are net (#2440).
      expect(result.totals.taxTreatment).toBe('exclusive');
    });

    it('should map order status correctly', () => {
      const statusTests = [
        { state: '1', expected: 'pending' },
        { state: '2', expected: 'processing' },
        { state: '3', expected: 'processing' },
        { state: '4', expected: 'shipped' },
        { state: '5', expected: 'delivered' },
        { state: '6', expected: 'cancelled' },
        { state: '7', expected: 'refunded' },
        { state: '99', expected: 'pending' }, // Unknown status defaults to pending
      ];

      statusTests.forEach(({ state, expected }) => {
        const prestashopOrder: PrestashopOrder = {
          id: '42',
          reference: 'ORDER-001',
          current_state: state,
          total_paid: '99.99',
          date_add: '2024-01-01 10:00:00',
          date_upd: '2024-01-01 10:00:00',
        };

        const result = mapper.mapOrder(prestashopOrder, []);

        expect(result.status).toBe(expected);
      });
    });

    it('should handle missing status', () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-001',
        total_paid: '99.99',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 10:00:00',
      };

      const result = mapper.mapOrder(prestashopOrder, []);

      expect(result.status).toBe('pending');
    });

    it('should parse dates correctly', () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-001',
        current_state: '2',
        total_paid: '99.99',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-02 15:30:00',
      };

      const result = mapper.mapOrder(prestashopOrder, []);

      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.createdAt.getFullYear()).toBe(2024);
      expect(result.updatedAt.getFullYear()).toBe(2024);
    });

    it('should handle missing dates', () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-001',
        current_state: '2',
        total_paid: '99.99',
      };

      const result = mapper.mapOrder(prestashopOrder, []);

      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should handle missing customer ID', () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-001',
        current_state: '2',
        total_paid: '99.99',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 10:00:00',
      };

      const result = mapper.mapOrder(prestashopOrder, []);

      expect(result.customerId).toBeUndefined();
    });

    it('should handle numeric status', () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-001',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- test mock: explicit any narrows the dynamic spy / fixture shape
        current_state: 2 as any, // Numeric instead of string
        total_paid: '99.99',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 10:00:00',
      };

      const result = mapper.mapOrder(prestashopOrder, []);

      expect(result.status).toBe('processing');
    });

    it('should handle order items without variant', () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-001',
        current_state: '2',
        total_paid: '99.99',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 10:00:00',
      };

      const orderRows: PrestashopOrderRow[] = [
        {
          id: '1',
          id_order: '42',
          product_id: '10',
          product_attribute_id: '0', // No variant
          product_quantity: '2',
          product_price: '19.99',
          product_reference: 'PROD-001',
        },
      ];

      const result = mapper.mapOrder(prestashopOrder, orderRows);

      expect(result.items[0].variantId).toBeUndefined();
    });

    // #2068 — the line id was `String(row.id || index)`, which fell back to the row's array
    // POSITION. That id is persisted into the order snapshot, rendered to operators and used as a
    // React row key, so a positional or colliding value is a live defect, not a cosmetic one.
    describe('line id (#2068)', () => {
      const orderFor = (): PrestashopOrder => ({
        id: '42',
        reference: 'ORDER-042',
        current_state: '2',
        total_paid: '10.00',
        total_paid_tax_excl: '10.00',
        total_paid_tax_incl: '10.00',
        total_shipping: '0.00',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 10:00:00',
      });

      const rowWith = (id: unknown): PrestashopOrderRow =>
        ({
          id,
          id_order: '42',
          product_id: '10',
          product_attribute_id: '0',
          product_quantity: '1',
          product_price: '10.00',
          product_reference: 'PROD-001',
        }) as PrestashopOrderRow;

      it('should use the row id when it is 0 rather than falling through to the index', () => {
        // The 0-id row is deliberately NOT first: at position 0 the old `row.id || index`
        // expression also yields "0", so a leading row is what makes this a real guard.
        const rows = [rowWith('9'), rowWith(0)];

        const result = mapper.mapOrder(orderFor(), rows);

        // `||` treated a legitimate id of 0 as absent and substituted the index (1); `??` does not.
        expect(result.items[1].id).toBe('0');
      });

      it('should not produce colliding ids when one row id is 0', () => {
        // Under the old expression these both mapped to "1": row 0 kept its id, and row 1's
        // falsy 0 fell through to its index of 1.
        const rows = [rowWith('1'), rowWith(0)];

        const result = mapper.mapOrder(orderFor(), rows);

        expect(result.items.map((item) => item.id)).toEqual(['1', '0']);
      });

      it('should map the same payload to the same ids on a later poll', () => {
        const rows = [rowWith('7'), rowWith('9')];

        const first = mapper.mapOrder(orderFor(), rows);
        // A later poll returns the same lines in a different order — ids must follow the row,
        // not the position.
        const reordered = [rowWith('9'), rowWith('7')];
        const second = mapper.mapOrder(orderFor(), reordered);

        expect(first.items.map((i) => i.id).sort()).toEqual(second.items.map((i) => i.id).sort());
        expect(second.items.map((i) => i.id)).toEqual(['9', '7']);
      });

      it('should read the XML attribute id shape when the id is not a child element', () => {
        const rows = [rowWith(undefined)];
        rows[0]['@_id'] = 13;

        const result = mapper.mapOrder(orderFor(), rows);

        expect(result.items[0].id).toBe('13');
      });

      it('should fall through to the XML attribute id when the child element is blank', () => {
        // `??` would not have caught this: `''` is neither null nor undefined, so the row would
        // have thrown without ever consulting the attribute shape the fallback exists for.
        const rows = [rowWith('')];
        rows[0]['@_id'] = 21;

        const result = mapper.mapOrder(orderFor(), rows);

        expect(result.items[0].id).toBe('21');
      });

      it('should throw when a row carries no id at all', () => {
        const rows = [rowWith(undefined)];

        expect(() => mapper.mapOrder(orderFor(), rows)).toThrow(PrestashopParseException);
      });

      it('should name the order and row position without serialising the row', () => {
        const rows = [rowWith('1'), rowWith('')];

        try {
          mapper.mapOrder(orderFor(), rows);
          throw new Error('expected mapOrder to throw');
        } catch (error) {
          const parseError = error as PrestashopParseException;
          expect(parseError).toBeInstanceOf(PrestashopParseException);
          // 1-based: the offending row is the second one, so an operator counting from 1 finds it.
          expect(parseError.message).toContain('position 2');
          expect(parseError.message).toContain('42');
          // The row shape is `[key: string]: unknown` and this message reaches sync-job storage.
          expect(parseError.message).not.toContain('PROD-001');
          expect(parseError.responseBody).toBeUndefined();
        }
      });
    });
  });

  describe('mapCartCreate', () => {
    const mockOrderCreate: OrderCreate = {
      orderNumber: 'ORDER-001',
      status: 'processing',
      customerId: 'ol_customer_123',
      items: [
        {
          id: 'item-1',
          productId: 'ol_product_1',
          variantId: 'ol_variant_1',
          quantity: 2,
          price: 19.99,
          sku: 'PROD-001',
        },
      ],
      totals: {
        subtotal: 39.98,
        tax: 7.99,
        shipping: 5.0,
        total: 52.97,
        currency: 'EUR',
      },
      shippingAddress: {
        firstName: 'John',
        lastName: 'Doe',
        address1: '123 Main St',
        city: 'Warsaw',
        postalCode: '00-001',
        country: 'PL',
      },
    };

    it('should map cart with all required fields', () => {
      const externalProductIds = new Map<string, string | number>([['ol_product_1', '10']]);
      const externalVariantIds = new Map<string, string | number>([['ol_variant_1', '5']]);

      const result = mapper.mapCartCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200',
        '201',
        '1',
        '1'
      );

      expect(result.id_customer).toBe('100');
      expect(result.id_currency).toBe('1');
      expect(result.id_lang).toBe('1');
      expect(result.id_address_delivery).toBe('200');
      expect(result.id_address_invoice).toBe('201');
      expect((result.associations as Record<string, unknown>).cart_rows).toBeDefined();
    });

    it('should throw error when product ID mapping is missing', () => {
      const externalProductIds = new Map<string, string | number>(); // Empty
      const externalVariantIds = new Map<string, string | number>();

      expect(() => {
        mapper.mapCartCreate(
          mockOrderCreate,
          '100',
          externalProductIds,
          externalVariantIds,
          '200',
          '201'
        );
      }).toThrow('No external product ID found for internal product ID: ol_product_1');
    });

    it('should include currency and language IDs', () => {
      const externalProductIds = new Map<string, string | number>([['ol_product_1', '10']]);
      const externalVariantIds = new Map<string, string | number>();

      const result = mapper.mapCartCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200',
        '201',
        '2', // Currency ID 2
        '3' // Language ID 3
      );

      expect(result.id_currency).toBe('2');
      expect(result.id_lang).toBe('3');
    });

    it('should use shipping address for invoice when only shipping provided', () => {
      const externalProductIds = new Map<string, string | number>([['ol_product_1', '10']]);
      const externalVariantIds = new Map<string, string | number>();

      const result = mapper.mapCartCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200', // Only shipping
        undefined, // No billing
        '1',
        '1'
      );

      expect(result.id_address_delivery).toBe('200');
      expect(result.id_address_invoice).toBe('200');
    });

    // #2139: the cart's id_currency is the live write the refusal protects -
    // `importorder` builds the PrestaShop context from `$cart->id_currency`,
    // and the cart-scoped `specific_prices` rows are keyed to the same id.
    it('should refuse a cart with no currency ID instead of defaulting it to 1', () => {
      const externalProductIds = new Map<string, string | number>([['ol_product_1', '10']]);
      const externalVariantIds = new Map<string, string | number>();

      const refuse = (): unknown =>
        mapper.mapCartCreate(
          mockOrderCreate,
          '100',
          externalProductIds,
          externalVariantIds,
          '200',
          '201',
          undefined, // No currency
          '1'
        );

      expect(refuse).toThrow('No PrestaShop currency id was resolved');
      // The class carries the retry decision: no retry can supply the id, so
      // this must be the non-retryable currency class, not the generic
      // provisioning one the retry classifier leaves retryable.
      expect(refuse).toThrow(PrestashopCurrencyUnknownException);
    });

    it('should map cart rows correctly', () => {
      const externalProductIds = new Map<string, string | number>([['ol_product_1', '10']]);
      const externalVariantIds = new Map<string, string | number>([['ol_variant_1', '5']]);

      const result = mapper.mapCartCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200',
        '201',
        '1',
        '1'
      );

      const cartRows = (result.associations as Record<string, unknown>).cart_rows as Record<
        string,
        unknown
      >;
      const cartRow = (cartRows.cart_row as Array<Record<string, unknown>>)[0];
      expect(cartRow.id_product).toBe('10');
      expect(cartRow.id_product_attribute).toBe(5);
      expect(cartRow.quantity).toBe(2);
    });

    // #503: PS resolves the order's id_carrier from the cart at POST /orders
    // time and ignores the order body's field. Setting id_carrier on the
    // order body alone (as we did before) leaves every synced order at
    // id_carrier=0. These specs lock down the cart-side behaviour.
    describe('carrier propagation onto the cart (#503)', () => {
      const externalProductIds = new Map<string, string | number>([['ol_product_1', '10']]);
      const externalVariantIds = new Map<string, string | number>();

      it('sets id_carrier on the cart when externalCarrierId is provided', () => {
        const result = mapper.mapCartCreate(
          mockOrderCreate,
          '100',
          externalProductIds,
          externalVariantIds,
          '200',
          '201',
          '1',
          '1',
          2 // resolved Allegro Paczkomat → PS "My carrier"
        );

        expect(result.id_carrier).toBe(2);
      });

      it('falls back to id_carrier=1 (PS default) when externalCarrierId is omitted', () => {
        const result = mapper.mapCartCreate(
          mockOrderCreate,
          '100',
          externalProductIds,
          externalVariantIds,
          '200',
          '201',
          '1',
          '1'
          // externalCarrierId intentionally omitted — mirrors a connection
          // with no carrier mapping AND no defaultCarrierId in config.
        );

        expect(result.id_carrier).toBe(1);
      });
    });
  });
});
