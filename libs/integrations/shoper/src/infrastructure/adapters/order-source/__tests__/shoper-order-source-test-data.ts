/**
 * Fixtures shaped like payloads read from a live Shoper trial shop (6 Oct 2026,
 * read-only GETs of orders 2 and 7, their `order-products`, `/statuses`,
 * `/currencies`, `/shippings/8` and `/application-config`). Every number is a
 * string and every timestamp naive and shop-local, as on the wire.
 */
import type {
  ShoperOrderLineRow,
  ShoperOrderRow,
} from '../../../../domain/types/shoper-api.types';

export const WARSAW = 'Europe/Warsaw';

export function buildOrderRow(overrides: Partial<ShoperOrderRow> = {}): ShoperOrderRow {
  return {
    order_id: '2',
    user_id: '2',
    date: '2026-09-27 13:12:16',
    status_date: '2026-09-28 06:12:16',
    status_id: '7',
    sum: '133.84',
    paid: '133.84',
    payment_id: '1',
    shipping_id: '8',
    shipping_cost: '0.00',
    shipping_tax_value: '23',
    currency_id: '1',
    email: 'email@example.com',
    notes_priv: '',
    is_paid: true,
    is_cash_on_delivery: false,
    order_url: 'https://sklep729770.shoparena.pl/pl/panel/order/2',
    delivery_address: {
      firstname: 'Anna',
      lastname: 'Kowalska',
      company: '',
      street1: 'Warszawska 543/123',
      street2: '',
      city: 'Kraków',
      postcode: '31-345',
      state: '',
      country_code: 'PL',
      phone: '300542832',
      tax_identification_number: '',
    },
    billing_address: {
      firstname: 'Anna',
      lastname: 'Kowalska',
      company: 'Kowalska Sp. z o.o.',
      street1: 'Warszawska 543/123',
      street2: '',
      city: 'Kraków',
      postcode: '31-345',
      state: '',
      country_code: 'PL',
      phone: '300542832',
      tax_identification_number: '5252556107',
    },
    ...overrides,
  };
}

export function buildLineRow(overrides: Partial<ShoperOrderLineRow> = {}): ShoperOrderLineRow {
  return {
    id: '9',
    order_id: '2',
    product_id: '113',
    stock_id: '201',
    price: '59.48',
    quantity: '1',
    name: 'Żebrowana miska Miętowy Rozkwit',
    code: '1E72-8147C_20250917132509',
    ean: '',
    tax: '23%',
    tax_value: '23',
    ...overrides,
  };
}

export const LINES: readonly ShoperOrderLineRow[] = [
  buildLineRow(),
  buildLineRow({
    id: '10',
    product_id: '107',
    stock_id: '195',
    price: '74.36',
    name: 'Ceramiczny talerz Morning Mist',
    code: '1E72-8147C_20250917130650',
  }),
];
