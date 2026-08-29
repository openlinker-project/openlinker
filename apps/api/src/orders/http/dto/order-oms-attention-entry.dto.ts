/**
 * Order OMS Attention Entry DTO
 *
 * One inert state (#2352, Wave-2 product spec § 4.2) as an order row carries it,
 * projected from the `omsAttention` jsonb column.
 *
 * ## Why the row needs it at all
 *
 * The `omsAttention` COUNT already reaches the frontend through the orders
 * summary (`?attention=`, #2353), but a count cannot say WHAT stopped. § 4
 * requires the state to appear on the row the operator is already looking at,
 * with the same title as the `Needs attention` section — so the row needs the
 * reason, not just the fact that there is one.
 *
 * ## `reason` is a plain string, not the union
 *
 * The column is jsonb written by several producers, and a row written by a newer
 * release then rolled back carries a value this build's union does not contain.
 * The frontend narrows it and renders an unrecognised value neutrally and
 * uncounted (§ 4.4 S2-5); typing it as the closed union here would make Swagger
 * promise an exhaustiveness the column cannot honour.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthorityAttentionProducerValues } from '@openlinker/core/fulfillment-authority';
import { AuthorityAttentionProducer } from '@openlinker/core/fulfillment-authority';

export class OrderOmsAttentionEntryDto {
  @ApiProperty({
    enum: AuthorityAttentionProducerValues,
    description:
      'Which subsystem wrote this entry. Part of the write signature (#2352): clearing means ' +
      "clear MY entry, never clear the row, so an order can legitimately carry one entry per producer.",
  })
  producer!: AuthorityAttentionProducer;

  @ApiProperty({
    description:
      'The § 4.2 inert-state code. A plain string, not the closed union: the column is jsonb and a ' +
      'value written by a newer release must round-trip rather than fail. A reason this build does ' +
      'not recognise renders neutrally and is never counted.',
  })
  reason!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'PII-free elaboration (ids and counts only), rendered to the operator verbatim.',
  })
  detail!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The sub-object this entry is really about when the row is not — an order line for UF-L. The ' +
      'badge stays per row; this is what lets the body copy name the line.',
  })
  subjectRef!: string | null;

  @ApiProperty({
    description:
      'When THIS producer’s entry first appeared (ISO 8601). Preserved across a change of reason ' +
      'within one episode, so "how long has this been stuck" does not reset when the reason is refined.',
  })
  since!: string;
}
