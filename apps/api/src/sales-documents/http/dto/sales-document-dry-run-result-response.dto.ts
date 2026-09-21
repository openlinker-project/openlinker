/**
 * Sales-Document Dry-Run Result Response DTO (#3191)
 *
 * Projects the core `SalesDocumentDecision` — the same shape every real order
 * resolves to — into the wire response for `POST /sales-documents/rules/dry-run`.
 * `matchedByCandidateRule` is the one field this endpoint adds on top of the
 * decision itself: it tells the composer whether the CANDIDATE being drafted
 * is what matched (`ruleId === SALES_DOCUMENT_DRY_RUN_CANDIDATE_RULE_ID`), as
 * opposed to an already-saved rule elsewhere in the country's configuration.
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  SALES_DOCUMENT_DRY_RUN_CANDIDATE_RULE_ID,
  type SalesDocumentDecision,
} from '@openlinker/core/sales-documents';

export class SalesDocumentDryRunResultDto {
  @ApiProperty({ enum: ['route', 'aggregate', 'unresolved'] })
  kind!: 'route' | 'aggregate' | 'unresolved';

  @ApiProperty({ required: false, nullable: true, description: 'Present on `kind: "route"` only. `null` marks a self-routing destination.' })
  documentKind?: string | null;

  @ApiProperty({ required: false, description: 'Present on `kind: "route"` / `"aggregate"` only.' })
  connectionId?: string;

  @ApiProperty({ required: false, description: 'Present on `kind: "unresolved"` only.' })
  reason?: string;

  @ApiProperty({
    description:
      'True when the rule being drafted is what matched, as opposed to an already-saved rule elsewhere in this configuration.',
  })
  matchedByCandidateRule!: boolean;

  static fromDecision(decision: SalesDocumentDecision): SalesDocumentDryRunResultDto {
    const dto = new SalesDocumentDryRunResultDto();
    dto.kind = decision.kind;
    dto.matchedByCandidateRule = false;

    if (decision.kind === 'route') {
      dto.documentKind = decision.documentKind;
      dto.connectionId = decision.connectionId;
      dto.matchedByCandidateRule = decision.ruleId === SALES_DOCUMENT_DRY_RUN_CANDIDATE_RULE_ID;
    } else if (decision.kind === 'aggregate') {
      dto.connectionId = decision.connectionId;
    } else {
      dto.reason = decision.reason;
    }

    return dto;
  }
}
