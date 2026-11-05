/**
 * The two `order-products` rows of a real Shoper order placed with the
 * "Produkt gratisowy w koszyku" app (Maxsote) option chosen, read live on
 * 5 Nov 2026 (`GET /order-products?filters[order_id]=9`, trial shop). The gift
 * is the checkbox option `Produkt gratisowy` on the product: the row prices at
 * 0.01 and carries the option as `"option": "Produkt gratisowy: tak"`; the
 * ordinary line beside it has an empty `option`. Buyer data is not part of a line.
 */
import type { ShoperOrderLineRow } from '../../../domain/types/shoper-api.types';

export const SHOPER_GIFT_APP_LINE: ShoperOrderLineRow = {
  id: '24',
  order_id: '9',
  product_id: '129',
  stock_id: '217',
  price: '0.01',
  quantity: '1',
  name: 'Kubek ceramiczny Sandstone',
  code: 'OL-SH-KUBEK',
  tax: '23%',
  tax_value: '23',
  type: '0',
  option: 'Produkt gratisowy: tak',
};

export const SHOPER_PAID_LINE_BESIDE_GIFT: ShoperOrderLineRow = {
  id: '25',
  order_id: '9',
  product_id: '130',
  stock_id: '218',
  price: '69.00',
  quantity: '1',
  name: 'Talerz ceramiczny Sandstone',
  code: 'OL-SH-TALERZ',
  tax: '23%',
  tax_value: '23',
  type: '0',
  option: '',
};
