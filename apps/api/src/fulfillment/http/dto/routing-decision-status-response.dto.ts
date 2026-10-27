/**
 * Routing decision status response DTO (#2731)
 *
 * The read-only view of an order's latest routing decision: what it waits on,
 * how old it is, the time limit after which the reaper closes it, and what
 * happened when it ended. There is deliberately no action field — no operator
 * control forces, checks or abandons a decision (D4).
 *
 * @module apps/api/src/fulfillment/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RoutingDecisionAbandonReasonValues,
  RoutingDecisionStateValues,
  type RoutingDecisionAbandonReason,
  type RoutingDecisionState,
  type RoutingDecisionStatusView,
} from '@openlinker/core/fulfillment';

export class RoutingDecisionStatusResponseDto {
  @ApiProperty() decisionId!: string;

  @ApiProperty({ enum: RoutingDecisionStateValues })
  state!: RoutingDecisionState;

  @ApiProperty({ description: 'The connection of the router this decision was made by.' })
  routerConnectionId!: string;

  @ApiProperty() createdAt!: Date;

  @ApiProperty({ description: 'Milliseconds since the decision was created.' })
  ageMs!: number;

  @ApiProperty({
    description:
      'How long a decision may stay `live` before the reaper closes it, in ms. The same ' +
      'value the reaper uses (`OL_ROUTING_DECISION_TTL_MS`), so a client never restates it.',
  })
  ttlMs!: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Set only for a `live` decision already past its time limit: the instant it became ' +
      'stranded. The next reaper run closes it and routes the order again.',
  })
  strandedSince!: Date | null;

  @ApiPropertyOptional({ nullable: true, enum: RoutingDecisionAbandonReasonValues })
  abandonReason!: RoutingDecisionAbandonReason | null;

  @ApiPropertyOptional({ nullable: true })
  terminalisedAt!: Date | null;

  static fromView(view: RoutingDecisionStatusView): RoutingDecisionStatusResponseDto {
    const dto = new RoutingDecisionStatusResponseDto();
    dto.decisionId = view.decisionId;
    dto.state = view.state;
    dto.routerConnectionId = view.routerConnectionId;
    dto.createdAt = view.createdAt;
    dto.ageMs = view.ageMs;
    dto.ttlMs = view.ttlMs;
    dto.strandedSince = view.strandedSince;
    dto.abandonReason = view.abandonReason;
    dto.terminalisedAt = view.terminalisedAt;
    return dto;
  }
}
