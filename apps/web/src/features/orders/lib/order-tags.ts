/**
 * Order tags - limits and labels (#3532/#3533, mockup M3)
 *
 * The tag name limit, the workspace vocabulary cap and the colour labels the
 * tag chip, picker, bulk menu and the Settings tag manager share. The words
 * live in the `orders.orderTags` namespace.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { OrderTagColorValue } from '../api/orders.types';
import type { OrderTagsCopy } from './order-tags.types';

/** Mockup M3 `tags`: "Up to 32 characters. Must be unique." */
export const ORDER_TAG_NAME_MAX_LENGTH = 32;

/** D34 - the workspace vocabulary cap, mirrored for the "N of 50" line only. */
export const ORDER_TAG_LIMIT = 50;

/** The colour radiogroup and the manager's Colour column name each swatch; an unknown colour shows as it is. */
export function orderTagColorLabel(color: string, copy: OrderTagsCopy): string {
  return Object.prototype.hasOwnProperty.call(copy.colours, color)
    ? copy.colours[color as OrderTagColorValue]
    : color;
}
