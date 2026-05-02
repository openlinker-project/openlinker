/**
 * PrestaShop Order Mapper Tests
 *
 * Unit tests for PrestashopOrderMapper. Tests order mapping,
 * order item mapping, totals calculation, and status mapping.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers/__tests__
 */
import { PrestashopOrderMapper } from '../prestashop-order.mapper';
import { PrestashopOrder, PrestashopOrderRow } from '../prestashop.mapper.interface';
import { OrderCreate } from '@openlinker/core/orders';

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
      expect(result.totals.currency).toBe('EUR');
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
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
  });

  describe('mapOrderCreate', () => {
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
        {
          id: 'item-2',
          productId: 'ol_product_2',
          quantity: 1,
          price: 29.99,
          sku: 'PROD-002',
        },
      ],
      totals: {
        subtotal: 69.97,
        tax: 13.99,
        shipping: 5.0,
        total: 88.96,
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
      billingAddress: {
        firstName: 'John',
        lastName: 'Doe',
        address1: '123 Main St',
        city: 'Warsaw',
        postalCode: '00-001',
        country: 'PL',
      },
    };

    it('should map order with all required fields', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
        ['ol_product_2', '11'],
      ]);
      const externalVariantIds = new Map<string, string | number>([
        ['ol_variant_1', '5'],
      ]);

      const result = mapper.mapOrderCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200',
        '201',
        '1',
        '1',
      );

      expect(result.id_customer).toBe('100');
      expect(result.id_currency).toBe('1');
      expect(result.id_lang).toBe('1');
      expect(result.id_carrier).toBe(1);
      expect(result.module).toBe('ps_checkpayment');
      expect(result.payment).toBe('Check payment');
      expect(result.current_state).toBe(2); // processing
      expect(result.reference).toBe('ORDER-001');
      expect(result.total_paid).toBe('88.96');
      expect(result.total_paid_real).toBe('88.96');
      expect(result.total_products).toBe('69.97');
      expect(result.total_products_wt).toBe('83.96'); // 69.97 + 13.99
      expect(result.total_shipping).toBe('5.00');
      expect(result.conversion_rate).toBe('1.000000');
      expect(result.id_address_delivery).toBe('200');
      expect(result.id_address_invoice).toBe('201');
      expect((result.associations as Record<string, unknown>).order_rows).toBeDefined();
    });

    it('should throw error when product ID mapping is missing', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
        // Missing ol_product_2
      ]);
      const externalVariantIds = new Map<string, string | number>();

      expect(() => {
        mapper.mapOrderCreate(
          mockOrderCreate,
          '100',
          externalProductIds,
          externalVariantIds,
          '200',
          '201',
        );
      }).toThrow('No external product ID found for internal product ID: ol_product_2');
    });

    it('should use shipping address for both delivery and invoice when only shipping provided', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
        ['ol_product_2', '11'],
      ]);
      const externalVariantIds = new Map<string, string | number>();

      const result = mapper.mapOrderCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200', // Only shipping
        undefined, // No billing
      );

      expect(result.id_address_delivery).toBe('200');
      expect(result.id_address_invoice).toBe('200');
    });

    it('should use billing address for both delivery and invoice when only billing provided', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
        ['ol_product_2', '11'],
      ]);
      const externalVariantIds = new Map<string, string | number>();

      const result = mapper.mapOrderCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        undefined, // No shipping
        '201', // Only billing
      );

      expect(result.id_address_delivery).toBe('201');
      expect(result.id_address_invoice).toBe('201');
    });

    it('should throw error when both addresses are missing', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
        ['ol_product_2', '11'],
      ]);
      const externalVariantIds = new Map<string, string | number>();

      expect(() => {
        mapper.mapOrderCreate(
          mockOrderCreate,
          '100',
          externalProductIds,
          externalVariantIds,
          undefined,
          undefined,
        );
      }).toThrow('Both shipping and billing addresses are missing');
    });

    it('should default currency and language IDs to 1 when not provided', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
        ['ol_product_2', '11'],
      ]);
      const externalVariantIds = new Map<string, string | number>();

      const result = mapper.mapOrderCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200',
        '201',
        undefined, // No currency
        undefined, // No language
      );

      expect(result.id_currency).toBe(1);
      expect(result.id_lang).toBe(1);
    });

    it('should include all required PrestaShop fields', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
        ['ol_product_2', '11'],
      ]);
      const externalVariantIds = new Map<string, string | number>();

      const result = mapper.mapOrderCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200',
        '201',
        '1',
        '1',
      );

      // Check all required fields are present
      expect(result.id_customer).toBeDefined();
      expect(result.id_currency).toBeDefined();
      expect(result.id_lang).toBeDefined();
      expect(result.id_carrier).toBeDefined();
      expect(result.module).toBeDefined();
      expect(result.payment).toBeDefined();
      expect(result.current_state).toBeDefined();
      expect(result.total_paid).toBeDefined();
      expect(result.total_paid_real).toBeDefined();
      expect(result.total_paid_tax_incl).toBeDefined();
      expect(result.total_paid_tax_excl).toBeDefined();
      expect(result.total_products).toBeDefined();
      expect(result.total_products_wt).toBeDefined();
      expect(result.total_shipping).toBeDefined();
      expect(result.total_shipping_tax_incl).toBeDefined();
      expect(result.total_shipping_tax_excl).toBeDefined();
      expect(result.conversion_rate).toBeDefined();
      expect(result.associations).toBeDefined();
    });

    it('should map variant ID correctly when present', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
      ]);
      const externalVariantIds = new Map<string, string | number>([
        ['ol_variant_1', '5'],
      ]);

      const orderWithVariant: OrderCreate = {
        ...mockOrderCreate,
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
      };

      const result = mapper.mapOrderCreate(
        orderWithVariant,
        '100',
        externalProductIds,
        externalVariantIds,
        '200',
        '201',
      );

      const orderRows = (result.associations as Record<string, unknown>).order_rows as Record<
        string,
        unknown
      >;
      const orderRow = (orderRows.order_row as Array<Record<string, unknown>>)[0];
      expect(orderRow.product_attribute_id).toBe(5);
    });

    it('should use 0 for variant ID when variant mapping is missing', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
      ]);
      const externalVariantIds = new Map<string, string | number>(); // Empty - variant not found

      const orderWithVariant: OrderCreate = {
        ...mockOrderCreate,
        items: [
          {
            id: 'item-1',
            productId: 'ol_product_1',
            variantId: 'ol_variant_1', // Variant ID provided but mapping missing
            quantity: 2,
            price: 19.99,
            sku: 'PROD-001',
          },
        ],
      };

      const result = mapper.mapOrderCreate(
        orderWithVariant,
        '100',
        externalProductIds,
        externalVariantIds,
        '200',
        '201',
      );

      const orderRows = (result.associations as Record<string, unknown>).order_rows as Record<
        string,
        unknown
      >;
      const orderRow = (orderRows.order_row as Array<Record<string, unknown>>)[0];
      expect(orderRow.product_attribute_id).toBe(0);
    });

    describe('carrier resolution (#455)', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
        ['ol_product_2', '11'],
      ]);
      const externalVariantIds = new Map<string, string | number>([
        ['ol_variant_1', '5'],
      ]);

      it('should use externalCarrierId when explicitly provided', () => {
        const result = mapper.mapOrderCreate(
          mockOrderCreate,
          '100',
          externalProductIds,
          externalVariantIds,
          '200',
          '201',
          '1',
          '1',
          4, // externalCarrierId — mapped from CarrierMapping
        );

        expect(result.id_carrier).toBe(4);
      });

      it('should fall back to PrestaShop default carrier 1 when externalCarrierId is omitted', () => {
        const result = mapper.mapOrderCreate(
          mockOrderCreate,
          '100',
          externalProductIds,
          externalVariantIds,
          '200',
          '201',
          '1',
          '1',
          // externalCarrierId omitted — adapter resolved nothing.
        );

        expect(result.id_carrier).toBe(1);
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
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
      ]);
      const externalVariantIds = new Map<string, string | number>([
        ['ol_variant_1', '5'],
      ]);

      const result = mapper.mapCartCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200',
        '201',
        '1',
        '1',
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
          '201',
        );
      }).toThrow('No external product ID found for internal product ID: ol_product_1');
    });

    it('should include currency and language IDs', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
      ]);
      const externalVariantIds = new Map<string, string | number>();

      const result = mapper.mapCartCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200',
        '201',
        '2', // Currency ID 2
        '3', // Language ID 3
      );

      expect(result.id_currency).toBe('2');
      expect(result.id_lang).toBe('3');
    });

    it('should use shipping address for invoice when only shipping provided', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
      ]);
      const externalVariantIds = new Map<string, string | number>();

      const result = mapper.mapCartCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200', // Only shipping
        undefined, // No billing
      );

      expect(result.id_address_delivery).toBe('200');
      expect(result.id_address_invoice).toBe('200');
    });

    it('should map cart rows correctly', () => {
      const externalProductIds = new Map<string, string | number>([
        ['ol_product_1', '10'],
      ]);
      const externalVariantIds = new Map<string, string | number>([
        ['ol_variant_1', '5'],
      ]);

      const result = mapper.mapCartCreate(
        mockOrderCreate,
        '100',
        externalProductIds,
        externalVariantIds,
        '200',
        '201',
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
          2, // resolved Allegro Paczkomat → PS "My carrier"
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
          '1',
          // externalCarrierId intentionally omitted — mirrors a connection
          // with no carrier mapping AND no defaultCarrierId in config.
        );

        expect(result.id_carrier).toBe(1);
      });
    });
  });
});

