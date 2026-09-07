/**
 * Sourcing Rule Response DTO (#2953)
 *
 * Named `SourcingRuleResponseDto`, never `RoutingRuleResponseDto`:
 * `apps/api/src/mappings/http/dto/routing-rule-response.dto.ts` already owns
 * that class name for the unrelated ADR-012 dispatch surface, and
 * `@nestjs/swagger` keys schema definitions by CLASS NAME — a duplicate silently
 * overwrites the other's definition in the published OpenAPI document, so the
 * contract would describe one surface with the other's fields. No compiler,
 * lint rule or test in this repo detects that.
 *
 * @module apps/api/src/oms/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { RoutingRuleRecord } from '@openlinker/oms';

export class SourcingRuleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty({ description: 'Ascending evaluation order. Ties break on `id`.' })
  position!: number;

  @ApiProperty({ description: 'Stored verbatim — see `recognised`.' })
  kind!: string;

  @ApiProperty({ description: 'Stored verbatim — see `recognised`.' })
  name!: string;

  @ApiProperty({ description: 'Stored verbatim — see `recognised`.' })
  afterAction!: string;

  @ApiProperty({ type: [String] })
  priorityLocationIds!: string[];

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  effectiveFrom!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  effectiveTo!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({
    description:
      'Whether this version of OpenLinker can evaluate the rule. `false` means the row is ' +
      'persisted but INVISIBLE to the router — it is listed here precisely so it can be found ' +
      'and deleted; it cannot be edited, because a successful edit would imply it routes.',
  })
  recognised!: boolean;

  static fromDomain(rule: RoutingRuleRecord): SourcingRuleResponseDto {
    return {
      id: rule.id,
      connectionId: rule.connectionId,
      position: rule.position,
      kind: rule.kind,
      name: rule.name,
      afterAction: rule.afterAction,
      priorityLocationIds: [...rule.priorityLocationIds],
      effectiveFrom: rule.effectiveFrom?.toISOString() ?? null,
      effectiveTo: rule.effectiveTo?.toISOString() ?? null,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
      recognised: rule.recognised,
    };
  }
}
