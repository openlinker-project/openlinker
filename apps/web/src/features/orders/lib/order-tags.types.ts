/**
 * Order tags types (#3532/#3533)
 *
 * The tag copy the tag chip, picker, bulk menu and Settings tag manager read.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { Messages, ResolvedCopy } from '../../../shared/i18n';

/** The `orders.orderTags` copy, in the active language. */
export type OrderTagsCopy = ResolvedCopy<Messages['orders']>['orderTags'];
