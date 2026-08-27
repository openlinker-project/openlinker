/**
 * Credit-note proposal schema (#2382)
 *
 * Parsed, never cast — a contract break must surface as a named failure rather
 * than as `undefined` rendered where a candidate list belongs.
 *
 * `outcome` and `status` are read as plain STRINGS, deliberately: a value this
 * build predates must still reach the operator, who can quote it. Narrowing them
 * to a union would blank exactly the case nobody anticipated.
 *
 * @module apps/web/src/features/returns/api
 */
import { z } from 'zod/v4';
import type { ReturnCorrectionProposalResult } from './returns.types';

export class ReturnProposalUnreadableError extends Error {
  constructor() {
    super('The credit-note proposal could not be read.');
    this.name = 'ReturnProposalUnreadableError';
  }
}

const candidateSchema = z.object({
  originalLineNumber: z.number(),
  name: z.string(),
  quantity: z.number(),
  unitPriceGross: z.number(),
  taxRate: z.string(),
});

const lineSchema = z.object({
  returnLineId: z.string(),
  lineIndex: z.number(),
  name: z.string().nullish(),
  sku: z.string().nullish(),
  quantityDisposed: z.number(),
  status: z.string(),
  candidates: z.array(candidateSchema).nullish(),
  selectedOriginalLineNumber: z.number().nullish(),
  newQuantity: z.number().nullish(),
  noMatchReason: z.string().nullish(),
  noMatchExplanation: z.string().nullish(),
  candidatesPriceOrRateDiffer: z.boolean().nullish(),
});

const proposalSchema = z.object({
  outcome: z.string(),
  proposal: z
    .object({
      returnId: z.string(),
      internalOrderId: z.string(),
      invoiceRecordId: z.string(),
      invoiceConnectionId: z.string(),
      invoiceDocumentNumber: z.string().nullish(),
      currency: z.string(),
      lines: z.array(lineSchema),
    })
    .nullish(),
});

export function parseCorrectionProposal(raw: unknown): ReturnCorrectionProposalResult {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReturnProposalUnreadableError();
  }

  const body = parsed.data.proposal;

  return {
    outcome: parsed.data.outcome,
    proposal:
      body === undefined || body === null
        ? null
        : {
            returnId: body.returnId,
            internalOrderId: body.internalOrderId,
            invoiceRecordId: body.invoiceRecordId,
            invoiceConnectionId: body.invoiceConnectionId,
            invoiceDocumentNumber: body.invoiceDocumentNumber ?? null,
            currency: body.currency,
            lines: body.lines.map((line) => ({
              returnLineId: line.returnLineId,
              lineIndex: line.lineIndex,
              name: line.name ?? null,
              sku: line.sku ?? null,
              quantityDisposed: line.quantityDisposed,
              status: line.status,
              candidates: line.candidates ?? [],
              selectedOriginalLineNumber: line.selectedOriginalLineNumber ?? null,
              newQuantity: line.newQuantity ?? null,
              noMatchReason: line.noMatchReason ?? null,
              noMatchExplanation: line.noMatchExplanation ?? null,
              // Absent degrades to `false` — "we did not report a difference",
              // never a claim that one exists. It is evidence shown to an
              // operator, so inventing it would be worse than omitting it.
              candidatesPriceOrRateDiffer: line.candidatesPriceOrRateDiffer ?? false,
            })),
          },
  };
}
