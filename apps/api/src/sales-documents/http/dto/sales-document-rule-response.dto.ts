/**
 * Sales-Document Rule Response DTO (#2170)
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { SalesDocumentRule } from '@openlinker/core/sales-documents';
import { SalesDocumentConditionDto } from './sales-document-condition.dto';

export class SalesDocumentRuleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  country!: string;

  @ApiProperty({ type: [SalesDocumentConditionDto] })
  conditions!: SalesDocumentConditionDto[];

  @ApiProperty()
  documentKind!: string;

  @ApiProperty()
  connectionId!: string;

  @ApiProperty()
  effectiveFrom!: string;

  @ApiProperty({ nullable: true })
  effectiveTo!: string | null;

  @ApiProperty({ nullable: true })
  provenance!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  static fromDomain(rule: SalesDocumentRule): SalesDocumentRuleResponseDto {
    const dto = new SalesDocumentRuleResponseDto();
    dto.id = rule.id;
    dto.country = rule.country;
    dto.conditions = rule.conditions.map((c) => SalesDocumentConditionDto.fromDomain(c));
    dto.documentKind = rule.documentKind;
    dto.connectionId = rule.connectionId;
    dto.effectiveFrom = rule.effectiveFrom.toISOString().slice(0, 10);
    dto.effectiveTo = rule.effectiveTo ? rule.effectiveTo.toISOString().slice(0, 10) : null;
    dto.provenance = rule.provenance;
    dto.createdAt = rule.createdAt.toISOString();
    dto.updatedAt = rule.updatedAt.toISOString();
    return dto;
  }
}
