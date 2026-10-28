/**
 * Refund-ceiling verdict as reported on both refund entry points (#3289).
 *
 * An UNKNOWN ceiling lets the refund proceed unchecked, so the verdict is part
 * of the response: the caller must be able to tell "checked and within" from
 * "could not be checked, and here is why". Flat rather than a union so the
 * OpenAPI schema stays plain; figures are present only for `within` /
 * `exceeded`, `reason` only for `unknown`.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RefundCeilingUnknownReasonValues,
  type RefundCeilingUnknownReason,
  type RefundCeilingVerdict,
} from '@openlinker/core/orders';

const STATUS_VALUES = ['within', 'exceeded', 'unknown'] as const;

export class RefundCeilingVerdictDto {
  @ApiProperty({
    enum: STATUS_VALUES,
    description:
      '`within` / `exceeded` = the order total was compared. `unknown` = it could not be, the refund ' +
      'proceeded UNCHECKED, and `reason` says why.',
  })
  status!: (typeof STATUS_VALUES)[number];

  @ApiPropertyOptional({ enum: RefundCeilingUnknownReasonValues, description: 'Present only when `status` is `unknown`.' })
  reason?: RefundCeilingUnknownReason;

  @ApiPropertyOptional({ description: 'Decimal string, the order currency. Not present when `unknown`.' })
  ceiling?: string;

  @ApiPropertyOptional({ description: 'Decimal string. Not present when `unknown`.' })
  alreadyRefunded?: string;

  @ApiPropertyOptional({ description: 'Decimal string. Not present when `unknown`.' })
  requested?: string;

  @ApiPropertyOptional({ description: 'Not present when `unknown`.' })
  currency?: string;
}

export function toRefundCeilingVerdictDto(verdict: RefundCeilingVerdict): RefundCeilingVerdictDto {
  if (verdict.status === 'unknown') {
    return { status: 'unknown', reason: verdict.reason };
  }
  return {
    status: verdict.status,
    ceiling: verdict.ceiling,
    alreadyRefunded: verdict.alreadyRefunded,
    requested: verdict.requested,
    currency: verdict.currency,
  };
}
