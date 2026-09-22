/**
 * Sales-Document Dry-Run Result Response DTO (#3191)
 *
 * Projects the core `SalesDocumentDecision` - the same shape every real order
 * resolves to - into the wire response for `POST /sales-documents/rules/dry-run`.
 *
 * `decidedBy` (#3364 review) is the one field this endpoint adds on top of
 * the decision itself, present only on `kind: "route"`, and it is
 * THREE-VALUED rather than a boolean:
 *
 * - `'draft-candidate'` - the CANDIDATE being drafted is what matched
 *   (`ruleId === SALES_DOCUMENT_DRY_RUN_CANDIDATE_RULE_ID`).
 * - `'saved-rule'` - a real, already-persisted `sales_document_rules` row
 *   matched instead (`decision.ruleId` names it).
 * - `'country-default'` - the route came from a tier-2 country default (or
 *   the legacy single-primary fallback), which carries NO `ruleId` at all
 *   (`SalesDocumentDecision`'s own doc comment: "a country default or the
 *   legacy resolver names a (documentKind, connectionId) pair with no rule
 *   behind it, and `ruleId` must not imply one exists"). A boolean collapsed
 *   this into `matchedByCandidateRule: false`, which the composer rendered as
 *   "via an already-saved rule" - a false claim: no rule, saved or otherwise,
 *   decided this route.
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  SALES_DOCUMENT_DRY_RUN_CANDIDATE_RULE_ID,
  type SalesDocumentDecision,
} from '@openlinker/core/sales-documents';

export type SalesDocumentDryRunDecidedBy = 'draft-candidate' | 'saved-rule' | 'country-default';

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
    required: false,
    enum: ['draft-candidate', 'saved-rule', 'country-default'],
    description:
      'Present on `kind: "route"` only. What decided the route: the rule being drafted ("draft-candidate"), an already-saved rule elsewhere in this configuration ("saved-rule"), or a country default / the legacy fallback with no rule behind it at all ("country-default").',
  })
  decidedBy?: SalesDocumentDryRunDecidedBy;

  static fromDecision(decision: SalesDocumentDecision): SalesDocumentDryRunResultDto {
    const dto = new SalesDocumentDryRunResultDto();
    dto.kind = decision.kind;

    if (decision.kind === 'route') {
      dto.documentKind = decision.documentKind;
      dto.connectionId = decision.connectionId;
      dto.decidedBy =
        decision.ruleId === undefined
          ? 'country-default'
          : decision.ruleId === SALES_DOCUMENT_DRY_RUN_CANDIDATE_RULE_ID
            ? 'draft-candidate'
            : 'saved-rule';
    } else if (decision.kind === 'aggregate') {
      dto.connectionId = decision.connectionId;
    } else {
      dto.reason = decision.reason;
    }

    return dto;
  }
}
