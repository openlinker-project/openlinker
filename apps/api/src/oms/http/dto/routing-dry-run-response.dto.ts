/**
 * Routing Dry-Run Response DTO (#2954)
 *
 * The router's `RoutingEvaluation` as it crosses the wire. `reason` on an
 * unfulfillable line and every rule `displayLabel` are the router's own words,
 * passed through verbatim: the frontend keeps no vocabulary of its own for them.
 *
 * @module apps/api/src/oms/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { DryRunResult } from '../../application/interfaces/routing-dry-run.service.interface';

class RuleRefDto {
  @ApiProperty() ruleId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Operator-facing label supplied by the router; render as-is.' })
  displayLabel!: string;
}

class ExplanationStepDto {
  @ApiProperty({ type: RuleRefDto }) rule!: RuleRefDto;
  @ApiProperty({ type: [String] }) eliminated!: string[];
  @ApiProperty({ nullable: true, type: Number }) score!: number | null;
  @ApiProperty({ nullable: true, type: String }) detail!: string | null;
}

class AssignmentDto {
  @ApiProperty() orderLineId!: string;
  @ApiProperty({ nullable: true, type: String }) locationId!: string | null;
  @ApiProperty({ nullable: true, type: String }) connectionId!: string | null;
  @ApiProperty({ nullable: true, type: String }) deliveryMethod!: string | null;
  @ApiProperty() quantity!: number;
}

class UnfulfillableLineDto {
  @ApiProperty() orderLineId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ enum: ['refund', 'return'] }) resolution!: 'refund' | 'return';
  @ApiProperty({ description: "The router's own reason string; opaque, render verbatim." })
  reason!: string;
}

class EvaluationDto {
  @ApiProperty({ type: [AssignmentDto] }) candidates!: AssignmentDto[];
  @ApiProperty({ type: [UnfulfillableLineDto] }) unfulfillable!: UnfulfillableLineDto[];
  @ApiProperty({ type: [ExplanationStepDto] }) explanation!: ExplanationStepDto[];
}

class LineChangeDto {
  @ApiProperty() orderLineId!: string;
  @ApiProperty({
    type: [String],
    description: '`locationId:quantity` pairs under the saved rules.',
  })
  saved!: string[];
  @ApiProperty({ type: [String], description: '`locationId:quantity` pairs under the draft.' })
  draft!: string[];
}

class InputLineDto {
  @ApiProperty() orderLineId!: string;
  @ApiProperty() productVariantId!: string;
  @ApiProperty() quantity!: number;
}

class ShipToDto {
  @ApiProperty({ enum: ['plain', 'hashed'] }) mode!: 'plain' | 'hashed';
  @ApiProperty() countryIso2!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) postalCode?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) city?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) locationHash?: string | null;
}

class DryRunInputDto {
  @ApiProperty({ type: [InputLineDto] }) lines!: InputLineDto[];
  @ApiProperty({ type: ShipToDto }) shipTo!: ShipToDto;
  @ApiProperty({ nullable: true, type: String }) requestedDeliveryMethod!: string | null;
}

export class RoutingDryRunResponseDto {
  @ApiProperty({
    type: DryRunInputDto,
    description:
      'Exactly what the router was told (ADR-062): no buyer name, email, phone or street.',
  })
  input!: DryRunInputDto;

  @ApiProperty({ type: EvaluationDto }) saved!: EvaluationDto;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Why live routing would not route this order, when it would not (own-shop, already mirrored, shipped by another system). The evaluation above ignores this, so read it first.',
  })
  routingSkipReason!: string | null;

  @ApiPropertyOptional({
    type: EvaluationDto,
    description: 'Present only when a draft was supplied.',
  })
  draft?: EvaluationDto;

  @ApiPropertyOptional({
    type: [LineChangeDto],
    description: 'Present only when a draft was supplied: the lines it places differently.',
  })
  changedLines?: LineChangeDto[];

  static fromDomain(result: DryRunResult): RoutingDryRunResponseDto {
    // The domain result is already the wire shape; the cast only bridges readonly arrays.
    return result as unknown as RoutingDryRunResponseDto;
  }
}
