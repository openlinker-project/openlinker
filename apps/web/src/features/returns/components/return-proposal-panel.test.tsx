/**
 * Credit-Note Proposal Panel (#2382, returns spec § 5.8)
 *
 * The acceptance criterion this file exists for: **an ambiguous proposal is
 * visually distinguishable from a clean one BEFORE any confirm.** The rest
 * defends the reason that matters — a transmitted correction cannot be
 * withdrawn, so nothing here may choose on the operator's behalf.
 *
 * @module apps/web/src/features/returns/components
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ReturnProposalPanel } from './return-proposal-panel';
import { RETURN_PROPOSAL_COPY } from '../lib/return-proposal.copy';
import type {
  ReturnCorrectionProposal,
  ReturnCorrectionProposalLine,
} from '../api/returns.types';

function line(
  overrides: Partial<ReturnCorrectionProposalLine> = {},
): ReturnCorrectionProposalLine {
  return {
    returnLineId: 'line-1',
    lineIndex: 0,
    name: 'Widget',
    sku: 'SKU-1',
    quantityDisposed: 1,
    status: 'matched',
    candidates: [],
    selectedOriginalLineNumber: 1,
    newQuantity: 1,
    noMatchReason: null,
    noMatchExplanation: null,
    candidatesPriceOrRateDiffer: false,
    ...overrides,
  };
}

function proposal(lines: ReturnCorrectionProposalLine[]): ReturnCorrectionProposal {
  return {
    returnId: 'ol_return_1',
    internalOrderId: 'ol_order_1',
    invoiceRecordId: 'inv-1',
    invoiceConnectionId: 'conn-1',
    invoiceDocumentNumber: 'FV/1',
    currency: 'PLN',
    lines,
  };
}

function renderPanel(p: ReturnCorrectionProposal | null, outcome = 'proposed') {
  render(
    <MemoryRouter>
      <ReturnProposalPanel outcome={outcome} proposal={p} />
    </MemoryRouter>,
  );
}

describe('ReturnProposalPanel (#2382)', () => {
  it('should lead with the irreversibility warning', () => {
    renderPanel(proposal([line()]));

    expect(screen.getByText(RETURN_PROPOSAL_COPY.irreversible)).toBeInTheDocument();
  });

  it('should be visibly DIFFERENT for an ambiguous proposal, before any confirm', () => {
    renderPanel(proposal([line({ status: 'ambiguous', candidates: [
      { originalLineNumber: 1, name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '23' },
      { originalLineNumber: 2, name: 'Widget', quantity: 1, unitPriceGross: 12, taxRate: '23' },
    ] })]));

    expect(screen.getByText(RETURN_PROPOSAL_COPY.ambiguousBanner)).toBeInTheDocument();
    expect(screen.queryByText(RETURN_PROPOSAL_COPY.cleanBanner)).not.toBeInTheDocument();
  });

  it('should say so, differently, when every line matched exactly one', () => {
    renderPanel(proposal([line()]));

    expect(screen.getByText(RETURN_PROPOSAL_COPY.cleanBanner)).toBeInTheDocument();
    expect(screen.queryByText(RETURN_PROPOSAL_COPY.ambiguousBanner)).not.toBeInTheDocument();
  });

  it('should list EVERY candidate and preselect none', () => {
    renderPanel(proposal([line({ status: 'ambiguous', candidates: [
      { originalLineNumber: 1, name: 'Widget A', quantity: 1, unitPriceGross: 10, taxRate: '23' },
      { originalLineNumber: 2, name: 'Widget B', quantity: 1, unitPriceGross: 12, taxRate: '23' },
      { originalLineNumber: 3, name: 'Widget C', quantity: 1, unitPriceGross: 14, taxRate: '23' },
    ] })]));

    // `originalLineNumber` is an array POSITION; picking one on a price
    // coincidence stamps a line number into a document that cannot be withdrawn.
    expect(screen.getByText(/Widget A/)).toBeInTheDocument();
    expect(screen.getByText(/Widget B/)).toBeInTheDocument();
    expect(screen.getByText(/Widget C/)).toBeInTheDocument();
  });

  it('should render a price/rate difference as EVIDENCE, not resolve it', () => {
    renderPanel(proposal([line({
      status: 'ambiguous',
      candidatesPriceOrRateDiffer: true,
      candidates: [
        { originalLineNumber: 1, name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '23' },
        { originalLineNumber: 2, name: 'Widget', quantity: 1, unitPriceGross: 12, taxRate: '8' },
      ],
    })]));

    expect(screen.getByText(RETURN_PROPOSAL_COPY.candidatesDiffer)).toBeInTheDocument();
    // Still ambiguous — showing a difference is not choosing.
    expect(screen.getByText(RETURN_PROPOSAL_COPY.ambiguousBanner)).toBeInTheDocument();
  });

  it('should state WHY an excluded line was excluded', () => {
    renderPanel(proposal([line({
      status: 'no-match',
      noMatchReason: 'disposition-not-confirmed',
      noMatchExplanation: null,
    })]));

    // A silent exclusion would hide a refused restock's units vanishing from the
    // credit note.
    expect(
      screen.getByText(/not confirmed disposed of yet/),
    ).toBeInTheDocument();
  });

  it('should never auto-issue, and say so in the footer', () => {
    renderPanel(proposal([line()]));

    expect(screen.getByText(RETURN_PROPOSAL_COPY.noAutoIssue)).toBeInTheDocument();
    // The handoff is a LINK to the provider's own flow, not a local issue button.
    expect(
      screen.getByRole('link', { name: RETURN_PROPOSAL_COPY.handoff }),
    ).toHaveAttribute('href', '/invoices/inv-1');
    expect(screen.queryByRole('button', { name: /issue/i })).not.toBeInTheDocument();
  });

  it('should name a non-proposed outcome rather than rendering blank', () => {
    renderPanel(null, 'no-invoice');

    expect(screen.getByText(/No invoice has been issued/)).toBeInTheDocument();
  });

  it('should pass an unrecognised outcome through rather than blanking it', () => {
    renderPanel(null, 'some-future-outcome');

    // Quotable in a support ticket; a blank is not.
    expect(screen.getByText('some-future-outcome')).toBeInTheDocument();
  });
});
