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
});

