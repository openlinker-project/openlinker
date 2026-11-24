/**
 * Existing codes are registered (#3863)
 *
 * Some codes the API sends are declared outside `ApiErrorCodeValues`, in core
 * vocabularies the frontend also copies: the fulfilment conflict codes, the
 * document-email refusals, the stock-correction reasons and the refund codes.
 * A member added to one of them would reach the client with no registered
 * meaning, so every value must be in the registry, verbatim.
 */
import { ApiErrorCodeValues } from '@openlinker/shared/errors';
import { FulfillmentWorkConflictCodeValues } from '@openlinker/core/fulfillment';
import {
  OrderDocumentEmailRefusalValues,
  REFUND_CEILING_EXCEEDED_CODE,
  RefundLockUnavailableException,
  RefundRecordContendedException,
} from '@openlinker/core/orders';
import {
  InventoryCorrectionPreconditionReasonValues,
  InventoryCorrectionRefusalReasonValues,
  InventoryCorrectionTargetRefusalReasonValues,
} from '@openlinker/core/inventory';

const REGISTERED = new Set<string>(ApiErrorCodeValues);

describe('existing codes are registered (#3863)', () => {
  it.each([
    ['fulfilment conflict codes', FulfillmentWorkConflictCodeValues],
    ['document-email refusals', OrderDocumentEmailRefusalValues],
    ['stock-correction target refusals', InventoryCorrectionTargetRefusalReasonValues],
    ['stock-correction preconditions', InventoryCorrectionPreconditionReasonValues],
    ['stock-correction master refusals', InventoryCorrectionRefusalReasonValues],
    [
      'refund codes',
      [
        REFUND_CEILING_EXCEEDED_CODE,
        new RefundRecordContendedException('o').code,
        new RefundLockUnavailableException('o').code,
      ],
    ],
  ] as const)('should register every one of the %s', (_family, values) => {
    expect(values.filter((value) => !REGISTERED.has(value))).toEqual([]);
  });
});
