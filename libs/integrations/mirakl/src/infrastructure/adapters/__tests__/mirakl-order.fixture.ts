/**
 * Mirakl Order Fixture
 *
 * Builds a Mirakl OR11 order for tests, following the Mirakl Seller API spec
 * and the Empik staging configuration (additional fields `nip`,
 * `customer-email`, `delivery-point-name`, `order-type`; shipping type
 * `PACKSTATION`). All buyer data is synthetic. Used by the unit specs and by
 * the Empik vertical slice.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/__tests__
 */
import type { MiraklOrder, MiraklOrderLine } from '../../../domain/types/mirakl-order.types';

export function buildMiraklOrderLine(overrides: Partial<MiraklOrderLine> = {}): MiraklOrderLine {
  return {
    order_line_id: '1001-A-1',
    order_line_state: 'SHIPPING',
    offer_id: 2001,
    offer_sku: 'SKU-RED-M',
    product_sku: 'P-2001',
    product_title: 'Koszulka czerwona M',
    quantity: 2,
    price_unit: 49.99,
    price: 99.98,
    shipping_price: 12.99,
    taxes: [{ code: 'VAT', rate: 23, amount: 18.7 }],
    shipping_taxes: [{ code: 'VAT', rate: 23, amount: 2.43 }],
    product_medias: [{ media_url: 'https://example.test/p-2001.jpg', type: 'small' }],
    ...overrides,
  };
}

export function buildMiraklOrder(overrides: Partial<MiraklOrder> = {}): MiraklOrder {
  return {
    order_id: '1001-A',
    commercial_id: '1001',
    order_state: 'SHIPPING',
    created_date: '2026-11-23T09:00:00Z',
    last_updated_date: '2026-11-23T09:30:00Z',
    customer_debited_date: '2026-11-23T09:05:00Z',
    currency_iso_code: 'PLN',
    order_tax_mode: 'TAX_INCLUDED',
    price: 99.98,
    shipping_price: 12.99,
    total_price: 112.97,
    shipping_type_code: 'PACKSTATION',
    shipping_type_label: 'Paczkomaty InPost',
    shipping_pudo_id: 'POZ08A',
    shipping_deadline: '2026-11-25T15:00:00Z',
    customer: {
      customer_id: 'cust-1',
      firstname: 'Anna',
      lastname: 'Testowa',
      billing_address: {
        firstname: 'Anna',
        lastname: 'Testowa',
        street_1: 'ul. Testowa 1',
        city: 'Warszawa',
        zip_code: '00-001',
        country_iso_code: 'POL',
        phone: '500000000',
      },
      shipping_address: {
        firstname: 'Anna',
        lastname: 'Testowa',
        street_1: 'ul. Testowa 1',
        city: 'Warszawa',
        zip_code: '00-001',
        country_iso_code: 'POL',
        phone: '500000000',
      },
    },
    customer_notification_email: 'relay-1@marketplace.example.test',
    order_additional_fields: [
      { code: 'customer-email', type: 'STRING', value: 'anna@example.test' },
      { code: 'nip', type: 'STRING', value: '5260250995' },
      { code: 'delivery-point-name', type: 'STRING', value: 'Paczkomat POZ08A' },
      { code: 'order-type', type: 'LIST', value: 'Standard' },
    ],
    order_lines: [buildMiraklOrderLine()],
    ...overrides,
  };
}
