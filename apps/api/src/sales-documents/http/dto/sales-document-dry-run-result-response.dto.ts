/**
 * Sales-Document Dry-Run Result Response DTO (#3191)
 *
 * Projects the core `SalesDocumentDecision` - the same shape every real order
 * resolves to - into the wire response for `POST /sales-documents/rules/dry-run`.
 * `decidedBy` is the one field this endpoint adds on top of the decision
 * itself, and it is THREE-valued rather than a boolean: `ruleId` on the
 * decision is set only by a tier-1 rule match and is absent for every other
 * route, including a tier-2 COUNTRY DEFAULT (`sales-document-decision.types.ts`
 * states this explicitly - "`ruleId` must not imply one exists"). Collapsing
 * that into `matchedByCandidateRule: boolean` reported a country default as
 * "an already-saved rule decided this" - the one thing the domain type says
 * must not be implied, and exactly backwards for an operator deciding whether
 * their draft rule is even needed: told "an already-saved rule decided this"
 * they go looking for a rule that does not exist, told "the country default
 * decided this" they know precisely what they are competing with.
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  SALES_DOCUMENT_DRY_RUN_CANDIDATE_RULE_ID,
  type SalesDocumentDecision,
} from '@openlinker/core/sales-documents';

const SALES_DOCUMENT_DRY_RUN_DECIDED_BY_VALUES = ['candidate', 'saved-rule', 'country-default'] as const;
export type SalesDocumentDryRunDecidedBy = (typeof SALES_DOCUMENT_DRY_RUN_DECIDED_BY_VALUES)[number];

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
    enum: SALES_DOCUMENT_DRY_RUN_DECIDED_BY_VALUES,
    description:
      'Present on `kind: "route"` only. `candidate` = the rule being drafted matched; ' +
      '`saved-rule` = a DIFFERENT, already-saved rule matched; `country-default` = no rule ' +
      'matched and the tier-2 country default decided - never implied to be a saved rule.',
  })
  decidedBy?: SalesDocumentDryRunDecidedBy;

  static fromDecision(decision: SalesDocumentDecision): SalesDocumentDryRunResultDto {
    const dto = new SalesDocumentDryRunResultDto();
    dto.kind = decision.kind;

    if (decision.kind === 'route') {
      dto.documentKind = decision.documentKind;
      dto.connectionId = decision.connectionId;
      dto.decidedBy =
        decision.ruleId === SALES_DOCUMENT_DRY_RUN_CANDIDATE_RULE_ID
          ? 'candidate'
          : decision.ruleId
            ? 'saved-rule'
            : 'country-default';
    } else if (decision.kind === 'aggregate') {
      dto.connectionId = decision.connectionId;
    } else {
      dto.reason = decision.reason;
    }

    return dto;
  }
}
