/**
 * A real Shoper bundle order line (#3932): the `order-products` row for a zestaw
 * in a sandbox order, read live on 4 Nov 2026 (`GET /order-products?filters[order_id]=5`).
 * The shop returns the parent with its four component rows NESTED in `children`;
 * the list holds one top-level row, not five. Buyer data is not part of a line.
 */
import type { ShoperOrderLineRow } from '../../../domain/types/shoper-api.types';

export const SHOPER_BUNDLE_PARENT_LINE: ShoperOrderLineRow = {
  "id": "15",
  "order_id": "5",
  "product_id": "128",
  "stock_id": "216",
  "price": "479.88",
  "quantity": "1",
  "name": "Serwuj te chwile",
  "code": "489B-4528A",
  "tax": "23%",
  "tax_value": "23",
  "type": "1",
  "children": [
    {
      "id": "16",
      "order_id": "5",
      "product_id": "125",
      "stock_id": "213",
      "price": "0.00",
      "quantity": "1",
      "name": "Kieliszek do wina Loom",
      "code": "1E72-8147C_20250917135519",
      "tax": "23%",
      "tax_value": "23"
    },
    {
      "id": "17",
      "order_id": "5",
      "product_id": "115",
      "stock_id": "203",
      "price": "0.00",
      "quantity": "1",
      "name": "Ceramiczny kubek Sandstone Freckles",
      "code": "1E72-8147C_20250917133243",
      "tax": "23%",
      "tax_value": "23"
    },
    {
      "id": "18",
      "order_id": "5",
      "product_id": "109",
      "stock_id": "197",
      "price": "0.00",
      "quantity": "1",
      "name": "Ceramiczna miska Sandstone Freckles",
      "code": "1E72-8147C_20250917131512",
      "tax": "23%",
      "tax_value": "23"
    },
    {
      "id": "19",
      "order_id": "5",
      "product_id": "99",
      "stock_id": "187",
      "price": "0.00",
      "quantity": "1",
      "name": "Teksturowany talerz Sandstone",
      "code": "1E72-8147C",
      "tax": "23%",
      "tax_value": "23"
    }
  ],
  "ean": ""
};
