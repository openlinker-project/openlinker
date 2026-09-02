/**
 * Return Correction Proposal DTOs (#2376, `W2-39`)
 *
 * The credit-note proposal (#2374), rendered.
 *
 * **A proposal is data.** Nothing behind these shapes issues a correction, and
 * the response says so — `GET` previews without persisting, `POST` records the
 * ADR-044 row an operator will later confirm through the existing
 * `CorrectionIssuer` flow. Auto-issue is not offered, because `InvoiceLine`
 * carries no stable reference and the whole point of the `ambiguous` status is
 * that a machine must not choose.
 *
 * @module apps/api/src/returns/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  ReturnCorrectionLineStatusValues,
  ReturnCorrectionNoMatchReasonValues,
  ReturnCorrectionProposalOutcomeValues,
  type ReturnCorrectionLineStatus,
  type ReturnCorrectionNoMatchReason,
  type ReturnCorrectionProposalOutcome,
} from '@openlinker/core/returns';

export class ReturnCorrectionCandidateDto {
  @ApiProperty({
    description:
      'The 1-based position of this line in the issued document — exactly what ' +
      '`CorrectionLine.originalLineNumber` expects, so the confirm step needs no translation.',
  })
  originalLineNumber!: number;

  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPriceGross!: number;

  @ApiProperty({ description: 'Neutral rate code as issued (`23`, `0`, `zw`, …).' })
  taxRate!: string;

  @ApiProperty({ required: false, nullable: true })
  unit?: string;
}

export class ReturnCorrectionProposalLineDto {
  @ApiProperty() returnLineId!: string;
  @ApiProperty() lineIndex!: number;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty({ nullable: true }) sku!: string | null;

  @ApiProperty({ description: 'Book-confirmed disposal only (restocked + scrapped).' })
  quantityDisposed!: number;

  @ApiProperty({
    enum: ReturnCorrectionLineStatusValues,
    description:
      '`ambiguous` lists every candidate and selects NONE — the operator picks. It is never ' +
      'collapsed into `matched`, not even when every candidate would credit the same amount.',
  })
  status!: ReturnCorrectionLineStatus;

  @ApiProperty({
    type: [ReturnCorrectionCandidateDto],
    description: 'EVERY candidate considered, always — including on a `no-match` line.',
  })
  candidates!: ReturnCorrectionCandidateDto[];

  @ApiProperty({ nullable: true, description: 'Set only on `matched`.' })
  selectedOriginalLineNumber!: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'The post-correction quantity for the selected candidate. Quantity only — a return does not ' +
      'change a unit price, so core computes no money here.',
  })
  newQuantity!: number | null;

  @ApiProperty({ enum: ReturnCorrectionNoMatchReasonValues, nullable: true })
  noMatchReason!: ReturnCorrectionNoMatchReason | null;

  @ApiProperty({
    nullable: true,
    description: 'Operator-facing sentence for the exclusion. Null unless `no-match`.',
  })
  noMatchExplanation!: string | null;

  @ApiProperty({
    description:
      'Whether the candidates disagree on price or tax rate. Evidence for the operator — the ' +
      'correction amount is the same either way unless these lines were priced differently — ' +
      'never grounds for OpenLinker to pick one.',
  })
  candidatesPriceOrRateDiffer!: boolean;
}

export class ReturnCorrectionProposalBodyDto {
  @ApiProperty() returnId!: string;
  @ApiProperty() internalOrderId!: string;
  @ApiProperty() invoiceRecordId!: string;
  @ApiProperty() invoiceConnectionId!: string;
  @ApiProperty({ nullable: true }) invoiceDocumentNumber!: string | null;
  @ApiProperty({ description: 'ISO 4217, echoed from the issued document.' }) currency!: string;

  @ApiProperty({ type: [ReturnCorrectionProposalLineDto] })
  lines!: ReturnCorrectionProposalLineDto[];
}

export class ReturnCorrectionProposalResponseDto {
  @ApiProperty({
    enum: ReturnCorrectionProposalOutcomeValues,
    description:
      'Every non-proposing exit is a named value, never an empty body. `nothing-correctable` still ' +
      'carries the full proposal so each excluded line states its reason.',
  })
  outcome!: ReturnCorrectionProposalOutcome;

  @ApiProperty({ type: ReturnCorrectionProposalBodyDto, nullable: true })
  proposal!: ReturnCorrectionProposalBodyDto | null;

  @ApiProperty({
    nullable: true,
    description:
      'The ADR-044 row. Always null on the GET (a preview persists nothing) and on any outcome ' +
      'with nothing to confirm.',
  })
  changeId!: string | null;

  @ApiProperty({ description: 'False when an identical open proposal was reused rather than opened.' })
  opened!: boolean;
}
