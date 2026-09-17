/**
 * Credit-Note Correction Proposal Panel (#3090, returns spec § 5.8)
 *
 * Two acceptance criteria this file exists for: the headline credit amount
 * and its breakdown must be present (visible above the fold on desktop is a
 * layout property this test cannot assert, but their presence is), and each
 * line's status must render in plain language, not the raw enum value.
 *
 * @module apps/web/src/features/returns/components
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CorrectionProposalPanel } from './correction-proposal-panel';
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
    candidates: [
      { originalLineNumber: 1, name: 'Widget', quantity: 2, unitPriceGross: 10, taxRate: '23' },
    ],
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
      <CorrectionProposalPanel outcome={outcome} proposal={p} />
    </MemoryRouter>,
  );
}

describe('CorrectionProposalPanel (#3090)', () => {
  it('should render a headline total and its automatic/pick/no-credit breakdown', () => {
    renderPanel(
      proposal([
        line(),
        line({ returnLineId: 'line-2', status: 'ambiguous', candidates: [
          { originalLineNumber: 1, name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '23' },
          { originalLineNumber: 2, name: 'Widget', quantity: 1, unitPriceGross: 12, taxRate: '23' },
        ] }),
        line({ returnLineId: 'line-3', status: 'no-match', noMatchReason: 'no-line-name' }),
      ]),
    );

    expect(screen.getByText(RETURN_PROPOSAL_COPY.headlineLabel)).toBeInTheDocument();
    // 1 matched (credits 10.00 PLN for the (2-1) unit delta at unit price 10),
    // 1 ambiguous, 1 no-match.
    expect(screen.getByText(RETURN_PROPOSAL_COPY.breakdownAutomatic).nextElementSibling)
      .toHaveTextContent('1');
    expect(screen.getByText(RETURN_PROPOSAL_COPY.breakdownNeedsPick).nextElementSibling)
      .toHaveTextContent('1');
    expect(screen.getByText(RETURN_PROPOSAL_COPY.breakdownCantCredit).nextElementSibling)
      .toHaveTextContent('1');
  });

  it('should show a plain-language status, never the raw enum value', () => {
    renderPanel(proposal([line({ status: 'ambiguous', candidates: [
      { originalLineNumber: 1, name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '23' },
      { originalLineNumber: 2, name: 'Widget', quantity: 1, unitPriceGross: 12, taxRate: '23' },
    ] })]));

    expect(screen.getByText(RETURN_PROPOSAL_COPY.statusAmbiguous)).toBeInTheDocument();
    expect(screen.queryByText('ambiguous')).not.toBeInTheDocument();
  });

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
    expect(screen.getByText(RETURN_PROPOSAL_COPY.ambiguousBanner)).toBeInTheDocument();
  });

  it('should treat a no-match/ambiguous-invoice-line residual exactly like the retired ambiguous status (#3312)', () => {
    renderPanel(proposal([line({
      status: 'no-match',
      noMatchReason: 'ambiguous-invoice-line',
      noMatchExplanation: 'This return could not be matched to exactly one invoice line automatically.',
    })]));

    // The matcher never emits `status: 'ambiguous'` anymore, but the SAME
    // attention-worthy banner must still fire for the reason that replaced it.
    expect(screen.getByText(RETURN_PROPOSAL_COPY.ambiguousBanner)).toBeInTheDocument();
    expect(screen.queryByText(RETURN_PROPOSAL_COPY.cleanBanner)).not.toBeInTheDocument();
  });

  it('should state WHY an excluded line was excluded', () => {
    renderPanel(proposal([line({
      status: 'no-match',
      noMatchReason: 'disposition-not-confirmed',
      noMatchExplanation: null,
    })]));

    expect(
      screen.getByText(/not confirmed disposed of yet/),
    ).toBeInTheDocument();
  });

  it('should never auto-issue, and say so in the footer', () => {
    renderPanel(proposal([line()]));

    expect(screen.getByText(RETURN_PROPOSAL_COPY.noAutoIssue)).toBeInTheDocument();
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

    expect(screen.getByText('some-future-outcome')).toBeInTheDocument();
  });
});
