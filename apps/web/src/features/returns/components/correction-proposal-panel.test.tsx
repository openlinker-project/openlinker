/**
 * Credit-Note Correction Proposal Panel (#3090 headline, #3092 record action)
 *
 * Two acceptance criteria this file exists for from #3090: the headline
 * credit amount and its breakdown must be present (visible above the fold on
 * desktop is a layout property this test cannot assert, but their presence
 * is), and each line's status must render in plain language, not the raw
 * enum value. #3092 adds: the record action calls the mutation, disables
 * while any line is ambiguous or already recorded, and the recorded state
 * (driven by `changeId`, not local component state) survives a re-render.
 *
 * @module apps/web/src/features/returns/components
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { CorrectionProposalPanel } from './correction-proposal-panel';
import { RETURN_PROPOSAL_COPY } from '../lib/return-proposal.copy';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import type {
  ReturnCorrectionProposal,
  ReturnCorrectionProposalLine,
  ReturnCorrectionProposalResult,
} from '../api/returns.types';

const RETURN_ID = 'ol_return_1';

const WRITE_ACCESS = { canWrite: true, demoReadOnly: false, visible: true };

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
    returnId: RETURN_ID,
    internalOrderId: 'ol_order_1',
    invoiceRecordId: 'inv-1',
    invoiceConnectionId: 'conn-1',
    invoiceDocumentNumber: 'FV/1',
    currency: 'PLN',
    lines,
  };
}

function renderPanel(
  p: ReturnCorrectionProposal | null,
  overrides: {
    outcome?: string;
    changeId?: string | null;
    writeAccess?: typeof WRITE_ACCESS;
    recordCorrectionProposal?: Mock<(returnId: string) => Promise<ReturnCorrectionProposalResult>>;
    orphan?: boolean;
  } = {},
) {
  const recordCorrectionProposal =
    overrides.recordCorrectionProposal ??
    vi.fn().mockResolvedValue({
      outcome: 'proposed',
      proposal: p,
      changeId: 'ol_order_change_1',
      opened: true,
    });
  const apiClient = createMockApiClient({ returns: { recordCorrectionProposal } });

  return {
    recordCorrectionProposal,
    ...renderWithProviders(
      <CorrectionProposalPanel
        returnId={RETURN_ID}
        outcome={overrides.outcome ?? 'proposed'}
        proposal={p}
        changeId={overrides.changeId ?? null}
        writeAccess={overrides.writeAccess ?? WRITE_ACCESS}
        orphan={overrides.orphan}
      />,
      { apiClient },
    ),
  };
}

describe('CorrectionProposalPanel — headline + breakdown (#3090)', () => {
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
    expect(screen.getByText(RETURN_PROPOSAL_COPY.breakdownAutomatic).nextElementSibling)
      .toHaveTextContent('1');
    expect(screen.getByText(RETURN_PROPOSAL_COPY.breakdownNeedsPick).nextElementSibling)
      .toHaveTextContent('1');
    expect(screen.getByText(RETURN_PROPOSAL_COPY.breakdownCantCredit).nextElementSibling)
      .toHaveTextContent('1');
  });

  it('should label the headline as an estimate, never as the amount the document will carry (review finding on #3376)', () => {
    renderPanel(proposal([line()]));

    expect(screen.getByText(RETURN_PROPOSAL_COPY.headlineEstimateNote)).toBeInTheDocument();
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

  it('should never auto-issue, and never hand off via a dead link (#3094 amendment)', () => {
    renderPanel(proposal([line()]));

    expect(screen.getByText(RETURN_PROPOSAL_COPY.noAutoIssue)).toBeInTheDocument();
    // The `/invoices/:id` link this used to assert was itself the defect
    // (#3094's own amendment: "drift, not a design choice") — the handoff now
    // opens the real `InvoiceCorrectionFlow` in a dialog (see
    // `ksef-invoice-correction-flow.test.tsx` etc. for that wiring), so no
    // link of any kind may exist here.
    expect(
      screen.queryByRole('link', { name: RETURN_PROPOSAL_COPY.handoff }),
    ).not.toBeInTheDocument();
    // "Record for review" exists; a literal "Issue" CTA must not.
    expect(screen.queryByRole('button', { name: /issue/i })).not.toBeInTheDocument();
  });

  it('should name a non-proposed outcome rather than rendering blank', () => {
    renderPanel(null, { outcome: 'no-invoice' });

    expect(screen.getByText(/No invoice has been issued/)).toBeInTheDocument();
  });

  it('should pass an unrecognised outcome through rather than blanking it', () => {
    renderPanel(null, { outcome: 'some-future-outcome' });

    expect(screen.getByText('some-future-outcome')).toBeInTheDocument();
  });

  it('should render no badge for an unrecognised outcome, never a fabricated one', () => {
    renderPanel(null, { outcome: 'some-future-outcome' });

    // Every KNOWN badge text must be absent — proves nothing is guessed.
    for (const badge of Object.values(RETURN_PROPOSAL_COPY.outcomeBadges)) {
      expect(screen.queryByText(badge)).not.toBeInTheDocument();
    }
  });
});

describe('CorrectionProposalPanel — the 4 non-proposing outcomes (#3093)', () => {
  it('should render a distinct badge and message for no-invoice', () => {
    renderPanel(null, { outcome: 'no-invoice' });

    expect(screen.getByText(RETURN_PROPOSAL_COPY.outcomeBadges['no-invoice'])).toBeInTheDocument();
    expect(screen.getByText(RETURN_PROPOSAL_COPY.outcomes['no-invoice'])).toBeInTheDocument();
  });

  it('should render a distinct badge and message for no-line-snapshot', () => {
    renderPanel(null, { outcome: 'no-line-snapshot' });

    expect(
      screen.getByText(RETURN_PROPOSAL_COPY.outcomeBadges['no-line-snapshot']),
    ).toBeInTheDocument();
    expect(screen.getByText(RETURN_PROPOSAL_COPY.outcomes['no-line-snapshot'])).toBeInTheDocument();
  });

  it('should render a distinct badge, message and a real remedy link for no-disposed-lines', () => {
    renderPanel(null, { outcome: 'no-disposed-lines' });

    expect(
      screen.getByText(RETURN_PROPOSAL_COPY.outcomeBadges['no-disposed-lines']),
    ).toBeInTheDocument();
    expect(
      screen.getByText(RETURN_PROPOSAL_COPY.outcomes['no-disposed-lines']),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: RETURN_PROPOSAL_COPY.recordWhatCameBack }),
    ).toHaveAttribute('href', '#custody');
  });

  it('should render a distinct badge and message for nothing-correctable', () => {
    renderPanel(null, { outcome: 'nothing-correctable' });

    expect(
      screen.getByText(RETURN_PROPOSAL_COPY.outcomeBadges['nothing-correctable']),
    ).toBeInTheDocument();
    expect(
      screen.getByText(RETURN_PROPOSAL_COPY.outcomes['nothing-correctable']),
    ).toBeInTheDocument();
  });

  it('should give each of the 4 outcomes a DIFFERENT badge and message', () => {
    const outcomes = ['no-invoice', 'no-line-snapshot', 'no-disposed-lines', 'nothing-correctable'];
    const badges = outcomes.map((o) => RETURN_PROPOSAL_COPY.outcomeBadges[o]);
    const messages = outcomes.map((o) => RETURN_PROPOSAL_COPY.outcomes[o]);

    expect(new Set(badges).size).toBe(outcomes.length);
    expect(new Set(messages).size).toBe(outcomes.length);
  });

  it('should NOT render the remedy link for no-invoice or no-line-snapshot — no real destination exists', () => {
    renderPanel(null, { outcome: 'no-invoice' });
    expect(
      screen.queryByRole('link', { name: RETURN_PROPOSAL_COPY.recordWhatCameBack }),
    ).not.toBeInTheDocument();
  });
});

describe('CorrectionProposalPanel — record for review (#3092)', () => {
  it('should record the proposal and show a success toast on click', async () => {
    const user = userEvent.setup();
    const { recordCorrectionProposal } = renderPanel(proposal([line()]));

    await user.click(screen.getByRole('button', { name: RETURN_PROPOSAL_COPY.recordAction }));

    await waitFor(() => expect(recordCorrectionProposal).toHaveBeenCalledWith(RETURN_ID));
    expect(await screen.findByText(RETURN_PROPOSAL_COPY.recordSuccess)).toBeInTheDocument();
  });

  it('should disable the action while any line is ambiguous, with a reason beside it', () => {
    renderPanel(proposal([line({ status: 'ambiguous', selectedOriginalLineNumber: null, candidates: [
      { originalLineNumber: 1, name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '23' },
      { originalLineNumber: 2, name: 'Widget', quantity: 1, unitPriceGross: 12, taxRate: '23' },
    ] })]));

    expect(screen.getByRole('button', { name: RETURN_PROPOSAL_COPY.recordAction })).toBeDisabled();
    expect(screen.getByText(RETURN_PROPOSAL_COPY.recordBlockedAmbiguous)).toBeInTheDocument();
  });

  it('should render a persistent recorded badge and disable re-recording once changeId is set', () => {
    renderPanel(proposal([line()]), { changeId: 'ol_order_change_1' });

    expect(screen.getByText(RETURN_PROPOSAL_COPY.recordedBadge)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: RETURN_PROPOSAL_COPY.recordAction })).toBeDisabled();
  });

  it('should not render the action at all when write access is not visible', () => {
    renderPanel(proposal([line()]), {
      writeAccess: { canWrite: false, demoReadOnly: false, visible: false },
    });

    expect(
      screen.queryByRole('button', { name: RETURN_PROPOSAL_COPY.recordAction }),
    ).not.toBeInTheDocument();
  });

  it('should show an error toast without leaving the recorded state on a failed attempt', async () => {
    const user = userEvent.setup();
    const recordCorrectionProposal = vi.fn().mockRejectedValue(new Error('network error'));
    renderPanel(proposal([line()]), { recordCorrectionProposal });

    await user.click(screen.getByRole('button', { name: RETURN_PROPOSAL_COPY.recordAction }));

    expect(await screen.findByText(RETURN_PROPOSAL_COPY.recordError)).toBeInTheDocument();
    expect(screen.queryByText(RETURN_PROPOSAL_COPY.recordedBadge)).not.toBeInTheDocument();
  });
});

describe('CorrectionProposalPanel — record for review (#3092)', () => {
  it('should record the proposal and show a success toast on click', async () => {
    const user = userEvent.setup();
    const { recordCorrectionProposal } = renderPanel(proposal([line()]));

    await user.click(screen.getByRole('button', { name: RETURN_PROPOSAL_COPY.recordAction }));

    await waitFor(() => expect(recordCorrectionProposal).toHaveBeenCalledWith(RETURN_ID));
    expect(await screen.findByText(RETURN_PROPOSAL_COPY.recordSuccess)).toBeInTheDocument();
  });

  it('should disable the action while any line is ambiguous, with a reason beside it', () => {
    renderPanel(proposal([line({ status: 'ambiguous', selectedOriginalLineNumber: null, candidates: [
      { originalLineNumber: 1, name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '23' },
      { originalLineNumber: 2, name: 'Widget', quantity: 1, unitPriceGross: 12, taxRate: '23' },
    ] })]));

    expect(screen.getByRole('button', { name: RETURN_PROPOSAL_COPY.recordAction })).toBeDisabled();
    expect(screen.getByText(RETURN_PROPOSAL_COPY.recordBlockedAmbiguous)).toBeInTheDocument();
  });

  it('should render a persistent recorded badge and disable re-recording once changeId is set', () => {
    renderPanel(proposal([line()]), { changeId: 'ol_order_change_1' });

    expect(screen.getByText(RETURN_PROPOSAL_COPY.recordedBadge)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: RETURN_PROPOSAL_COPY.recordAction })).toBeDisabled();
  });

  it('should not render the action at all when write access is not visible', () => {
    renderPanel(proposal([line()]), {
      writeAccess: { canWrite: false, demoReadOnly: false, visible: false },
    });

    expect(
      screen.queryByRole('button', { name: RETURN_PROPOSAL_COPY.recordAction }),
    ).not.toBeInTheDocument();
  });

  it('should show an error toast without leaving the recorded state on a failed attempt', async () => {
    const user = userEvent.setup();
    const recordCorrectionProposal = vi.fn().mockRejectedValue(new Error('network error'));
    renderPanel(proposal([line()]), { recordCorrectionProposal });

    await user.click(screen.getByRole('button', { name: RETURN_PROPOSAL_COPY.recordAction }));

    expect(await screen.findByText(RETURN_PROPOSAL_COPY.recordError)).toBeInTheDocument();
    expect(screen.queryByText(RETURN_PROPOSAL_COPY.recordedBadge)).not.toBeInTheDocument();
  });
});

describe('CorrectionProposalPanel — orphan shell (#3094, PR #3379 review)', () => {
  it('owns its own section shell + heading, at the #correction anchor', () => {
    renderPanel(null, { orphan: true });

    const heading = screen.getByText(RETURN_PROPOSAL_COPY.sectionTitle);
    expect(heading.closest('section')).toHaveAttribute('id', 'correction');
    expect(screen.getByText(RETURN_PROPOSAL_COPY.orphanAbsent)).toBeInTheDocument();
  });

  it('never renders the proposal body, even if a proposal is somehow supplied alongside orphan', () => {
    renderPanel(proposal([line()]), { orphan: true });

    expect(screen.queryByText(RETURN_PROPOSAL_COPY.headlineLabel)).not.toBeInTheDocument();
    expect(screen.getByText(RETURN_PROPOSAL_COPY.orphanAbsent)).toBeInTheDocument();
  });
});
