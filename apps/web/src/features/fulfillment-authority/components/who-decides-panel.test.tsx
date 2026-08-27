/**
 * Who-decides panel — component tests.
 *
 * The acceptance criteria of #2354, in the order the issue lists them.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 */
import { screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WhoDecidesPanel } from './who-decides-panel';
import { ApiError } from '../../../shared/api/api-error';
import type {
  AuthorityAnswerRow,
  AuthorityPresetPreview,
  AuthorityStatus,
} from '../api/who-decides.types';
import type { ApiClient } from '../../../app/api/api-client';
import { PermissionValues, type Permission, type SessionUser } from '../../../shared/auth/session.types';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';

function zeroConfigStatus(): AuthorityStatus {
  return {
    rows: [
      {
        question: 'availability',
        state: 'default',
        source: 'default',
        answer: { kind: 'openlinker' },
        why: { kind: 'default', code: 'a1-computed-from-master-minus-buffer' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'sourcing',
        state: 'default',
        source: 'default',
        answer: { kind: 'nobody-to-route' },
        why: { kind: 'default', code: 'a2-single-origin-nothing-to-choose' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'fulfillment-execution',
        state: 'default',
        source: 'default',
        answer: { kind: 'default-today' },
        why: { kind: 'default', code: 'a3-lands-where-it-does-today' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'order-lifecycle',
        state: 'default',
        source: 'default',
        answer: { kind: 'openlinker' },
        why: { kind: 'default', code: 'a4-derived-from-observed-facts' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'returns-disposition',
        state: 'default',
        source: 'default',
        answer: { kind: 'manual' },
        why: { kind: 'default', code: 'a5-nothing-decides-yet-handled-by-hand' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'refund-trigger',
        state: 'resolved',
        source: 'fixed-by-design',
        answer: { kind: 'openlinker' },
        why: { kind: 'default', code: 'a6-only-ol-holds-payment-credentials' },
        inactiveClaimantConnectionIds: [],
      },
      {
        question: 'sales-documents',
        state: 'unavailable',
        source: 'delegated',
        answer: { kind: 'configured-elsewhere', surface: 'sales-documents' },
        why: { kind: 'default', code: 'a7-configured-under-sales-documents' },
        inactiveClaimantConnectionIds: [],
      },
    ],
    attention: { counted: [], routine: [], affectedOrderCount: 0 },
    presets: [
      { id: 'leave-as-they-are', available: true, unavailableReason: null },
      { id: 'openlinker-decides', available: true, unavailableReason: null },
      {
        id: 'keep-other-system',
        available: false,
        unavailableReason: 'needs-a-system-that-can-take-over',
      },
    ],
    applied: null,
  };
}

/**
 * A preview envelope in the shape the SERVER sends.
 *
 * Built from the real DTO (`presetId` / `changes[{question,before,after}]` /
 * `resultingAmbiguities` / `blocked`), never invented alongside the code that
 * reads it — a fixture that agrees only with itself proves nothing.
 */
function preview(overrides: Partial<AuthorityPresetPreview> = {}): AuthorityPresetPreview {
  return {
    presetId: 'openlinker-decides',
    changes: [],
    resultingAmbiguities: [],
    blocked: false,
    ...overrides,
  };
}

function answerRow(overrides: Partial<AuthorityAnswerRow> = {}): AuthorityAnswerRow {
  return {
    question: 'availability',
    state: 'default',
    source: 'default',
    answer: { kind: 'openlinker' },
    why: { kind: 'default', code: 'a1-computed-from-master-minus-buffer' },
    inactiveClaimantConnectionIds: [],
    ...overrides,
  };
}

interface RenderPanelOptions {
  status?: AuthorityStatus | null;
  applyPreset?: ApiClient['fulfillmentAuthority']['applyPreset'];
  previewPreset?: ApiClient['fulfillmentAuthority']['previewPreset'];
  /** Omit for a full-permission admin; pass `[]` for a read-only session. */
  permissions?: Permission[];
}

/**
 * No `as never` anywhere.
 *
 * `as never` silences ANY shape mismatch, which is the mechanism that lets a
 * fixture drift from the contract it claims to test — and this file already
 * shipped one such drift (a 422 body invented alongside the handler that read
 * it). Every override here is typed against the real `ApiClient` / `SessionUser`
 * so a shape change fails the build instead of the operator.
 */
function renderPanel(options: RenderPanelOptions = {}): RenderResult {
  const overrides: Partial<ApiClient> = {
    fulfillmentAuthority: {
      // `'status' in options`, not `??`: the unreadable-response case passes an
      // explicit `null`, which `??` would silently replace with a good payload.
      getStatus: vi
        .fn()
        .mockResolvedValue('status' in options ? options.status : zeroConfigStatus()),
      applyPreset: options.applyPreset ?? vi.fn().mockResolvedValue(zeroConfigStatus()),
      previewPreset: options.previewPreset ?? vi.fn().mockResolvedValue(preview()),
    },
  };

  const user: SessionUser = {
    id: 'u1',
    username: 'operator',
    email: 'op@example.com',
    role: options.permissions ? 'viewer' : 'admin',
    permissions: options.permissions ?? [...PermissionValues],
    analyticsConsent: true,
  };

  return renderWithProviders(<WhoDecidesPanel />, {
    apiClient: createMockApiClient(overrides),
    sessionAdapter: createAuthenticatedSessionAdapter(user),
  });
}

/**
 * Confirm the dialog, once it is allowed to be confirmed.
 *
 * Save is disabled until the preview resolves — a confirm dialog must not let a
 * change out while it cannot yet say what the change does — so a bare click
 * would silently no-op and the test would assert against an apply that never
 * happened.
 */
async function confirmSave(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const save = await screen.findByRole('button', { name: 'Save' });
  await waitFor(() => expect(save).toBeEnabled());
  await user.click(save);
}

describe('WhoDecidesPanel', () => {
  it('should render an answer and a why line for all seven rows on a zero-config install', async () => {
    renderPanel();

    // Every question renders — no empty state anywhere (§ 2.3).
    expect(await screen.findByText('How much stock can we promise?')).toBeInTheDocument();
    for (const question of [
      'Where does an order ship from?',
      'Who picks and ships?',
      'What state is an order in?',
      'What happens to returned goods?',
      'Who issues refunds?',
      'Who issues invoices and receipts?',
    ]) {
      expect(screen.getByText(question)).toBeInTheDocument();
    }

    const rows = document.querySelectorAll('.who-decides-row');
    expect(rows).toHaveLength(7);
    // The why-line is the point of the table: every row must carry one.
    for (const row of Array.from(rows)) {
      const why = row.querySelector('.who-decides-row__why');
      expect(why?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('should render the unavailable arrangement disabled with its reason visible', async () => {
    renderPanel();

    const card = await waitFor(() => {
      const found = document.querySelector('[data-preset="keep-other-system"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });

    expect(card.querySelector('input')).toBeDisabled();
    expect(screen.getByText('Not available yet')).toBeInTheDocument();
    expect(
      screen.getByText('Needs a system that can take over. Connect one first.'),
    ).toBeInTheDocument();
  });

  it('should render the refunds row locked and the documents row as a link with no mirrored answer', async () => {
    renderPanel();

    const refunds = await waitFor(() => {
      const found = document.querySelector('[data-question="refund-trigger"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    // A6 keeps the closed vocabulary's `Always` badge; the lock is separate.
    expect(refunds.querySelector('.who-decides-row__badge')?.textContent).toContain('Always');
    expect(refunds.querySelector('.who-decides-row__locked')?.textContent).toContain(
      'Cannot be handed over',
    );

    const documents = document.querySelector('[data-question="sales-documents"]') as HTMLElement;
    expect(documents.getAttribute('data-badge')).toBe('elsewhere');
    const link = documents.querySelector('a');
    expect(link).toHaveAttribute('href', '/settings/sales-documents');
    // It mirrors no state of its own — the answer is the link and nothing else.
    expect(documents.querySelector('.who-decides-row__answer')?.textContent).toBe(
      'Set up under Sales documents',
    );
  });

  it('should show a read-only session the whole page and no write control', async () => {
    renderPanel({ permissions: [] });

    expect(await screen.findByText('How much stock can we promise?')).toBeInTheDocument();
    expect(document.querySelectorAll('.who-decides-row')).toHaveLength(7);
    // The read is authorised for this role; only the write is not.
    expect(screen.queryByRole('button', { name: 'Save this arrangement' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Only an administrator can change who decides what.'),
    ).toBeInTheDocument();
  });

  it('should report a partially-applied result rather than a flat success', async () => {
    const partial: AuthorityStatus = { ...zeroConfigStatus() };
    const applyPreset = vi.fn().mockResolvedValue({
      ...partial,
      applied: { updatedConnectionIds: ['c1'], failedConnectionIds: ['c2'] },
    });
    renderPanel({ applyPreset });

    const user = userEvent.setup();
    await screen.findByText('How much stock can we promise?');
    await user.click(screen.getByRole('radio', { name: /Let OpenLinker decide/ }));
    await user.click(screen.getByRole('button', { name: 'Save this arrangement' }));
    await confirmSave(user);

    expect(await screen.findByText('Only part of this was saved')).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('should render both the candidate list and the inactive-claim line on one row', async () => {
    // The two sets are DISJOINT and independently non-empty: inactive claimants
    // are filtered on `!isActive`, ambiguity is computed over ACTIVE claimants
    // only. Three connections claiming `availability` — two active and fighting,
    // one disabled — populates both, which is exactly the pair that shared one
    // CSS grid area and therefore rendered stacked on top of each other. Every
    // other fixture in this file sets `inactiveClaimantConnectionIds: []`, which
    // is why nothing caught it.
    const status = zeroConfigStatus();
    const rows = status.rows.map((row) =>
      row.question === 'availability'
        ? {
            ...row,
            state: 'ambiguous' as const,
            source: 'operator-config' as const,
            answer: {
              kind: 'cannot-tell' as const,
              reason: 'multiple-claimants-same-scope' as const,
              candidateConnectionIds: ['conn-a', 'conn-b'],
            },
            why: {
              kind: 'ambiguous' as const,
              reason: 'multiple-claimants-same-scope' as const,
            },
            inactiveClaimantConnectionIds: ['conn-disabled'],
          }
        : row
    );
    renderPanel({ status: { ...status, rows } });

    await screen.findByText('How much stock can we promise?');

    const inactiveLine = screen.getByText('A switched-off connection still claims this.');
    expect(inactiveLine).toBeInTheDocument();

    const rowElement = inactiveLine.closest('.who-decides-row');
    expect(rowElement).not.toBeNull();
    // Both parts live on the SAME row, so they cannot be allowed to occupy one
    // grid area — `who-decides-styles.test.ts` asserts the areas differ.
    expect(rowElement?.querySelector('.who-decides-row__candidates')).not.toBeNull();
    expect(rowElement?.querySelector('.who-decides-row__inactive')).not.toBeNull();
  });

  it('should not claim success when the apply response cannot be read', async () => {
    // `parseAuthorityStatus` returns `null` on ANY whole-envelope parse failure,
    // and the schema is strict over unions this programme widens wave by wave.
    // Read as `result?.applied?.failedConnectionIds ?? []`, a rolling-deploy
    // apply that wrote 3 of 5 connections and honestly reported the other two
    // was announced as `Saved`.
    const applyPreset = vi.fn().mockResolvedValue(null);
    renderPanel({ applyPreset });

    const user = userEvent.setup();
    await screen.findByText('How much stock can we promise?');
    await user.click(screen.getByRole('radio', { name: /Let OpenLinker decide/ }));
    await user.click(screen.getByRole('button', { name: 'Save this arrangement' }));
    await confirmSave(user);

    expect(await screen.findByText('We could not read the result')).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.queryByText('Only part of this was saved')).not.toBeInTheDocument();
  });

  it('should report a 422 refusal as nothing changed and name the conflicting connections', async () => {
    // The REAL envelope the service throws: `{ message, presetId, ambiguities }`,
    // with the ids one level down on each item's `connectionIds`
    // (`authority-status.service.ts`). The previous fixture invented a top-level
    // `candidateConnectionIds` the endpoint never sends, so it proved only that
    // the handler agreed with itself.
    const applyPreset = vi.fn().mockRejectedValue(
      new ApiError('unprocessable', 422, {
        message: 'Applying this arrangement would leave OpenLinker unable to tell which system decides.',
        presetId: 'leave-as-they-are',
        ambiguities: [
          {
            reason: 'availability-unknown',
            badge: 'stopped',
            surfaces: ['product'],
            origin: 'authority-resolution',
            question: 'availability',
            connectionIds: ['c1', 'c2'],
          },
          {
            // A second ambiguous decision caused by the SAME pair — the ids are
            // deduped, because naming a connection twice reads as two problems.
            reason: 'sourcing-ambiguous',
            badge: 'stopped',
            surfaces: ['order'],
            origin: 'authority-resolution',
            question: 'sourcing',
            connectionIds: ['c1', 'c2'],
          },
        ],
      }),
    );
    renderPanel({ applyPreset });

    const user = userEvent.setup();
    await screen.findByText('How much stock can we promise?');
    await user.click(screen.getByRole('radio', { name: /Leave things as they are/ }));
    await user.click(screen.getByRole('button', { name: 'Save this arrangement' }));
    await confirmSave(user);

    expect(await screen.findByText('Nothing was changed')).toBeInTheDocument();
    // Both candidates are named and linked, so the operator can act on them.
    const links = document.querySelectorAll('.who-decides__id-list a');
    expect(links).toHaveLength(2);
  });

  it('should report a 400 honestly rather than as a save that did nothing', async () => {
    const applyPreset = vi.fn().mockRejectedValue(new ApiError('bad request', 400, {}));
    renderPanel({ applyPreset });

    const user = userEvent.setup();
    await screen.findByText('How much stock can we promise?');
    await user.click(screen.getByRole('radio', { name: /Leave things as they are/ }));
    await user.click(screen.getByRole('button', { name: 'Save this arrangement' }));
    await confirmSave(user);

    expect(await screen.findByText('OpenLinker did not accept that choice')).toBeInTheDocument();
  });

  it('should render an error rather than an empty table when the response cannot be read', async () => {
    renderPanel({ status: null });

    expect(await screen.findByText('We could not load this page')).toBeInTheDocument();
    expect(document.querySelectorAll('.who-decides-row')).toHaveLength(0);
  });

  it('should replace an ambiguous row why-line with the matching inert-state copy', async () => {
    const status = zeroConfigStatus();
    const ambiguous: AuthorityStatus = {
      ...status,
      rows: status.rows.map((row) =>
        row.question === 'availability'
          ? {
              ...row,
              state: 'ambiguous' as const,
              source: 'operator-config' as const,
              answer: {
                kind: 'cannot-tell' as const,
                reason: 'multiple-claimants-same-scope' as const,
                candidateConnectionIds: ['c1', 'c2'],
              },
              why: { kind: 'ambiguous' as const, reason: 'multiple-claimants-same-scope' as const },
            }
          : row,
      ),
      attention: {
        counted: [
          {
            reason: 'availability-unknown',
            badge: 'stopped',
            surfaces: ['product'],
            origin: 'authority-resolution',
            question: 'availability',
            connectionIds: ['c1', 'c2'],
          },
        ],
        routine: [],
        affectedOrderCount: 0,
      },
    };
    renderPanel({ status: ambiguous });

    const row = await waitFor(() => {
      const found = document.querySelector('[data-question="availability"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });

    expect(row.getAttribute('data-badge')).toBe('nothing-is-deciding');
    expect(row.querySelector('.who-decides-row__answer')?.textContent).toContain(
      "OpenLinker can't tell",
    );
    expect(row.querySelector('.who-decides-row__why')?.textContent).toContain(
      "Two of your systems both say they're in charge of your stock",
    );
  });
  it('should generate the confirm dialog from the preview diff rather than from static copy', async () => {
    const previewPreset = vi.fn().mockResolvedValue(
      preview({
        changes: [
          {
            question: 'availability',
            before: answerRow({
              state: 'resolved',
              source: 'operator-config',
              answer: { kind: 'holders', parties: [{ connectionId: 'c1', scopeKind: 'global' }] },
              why: { kind: 'default', code: 'a1-claimed-by-connection' },
            }),
            after: answerRow(),
          },
        ],
      }),
    );
    renderPanel({ previewPreset });

    const user = userEvent.setup();
    await screen.findByText('How much stock can we promise?');
    await user.click(screen.getByRole('radio', { name: /Let OpenLinker decide/ }));
    await user.click(screen.getByRole('button', { name: 'Save this arrangement' }));

    // Exactly the changed row, named by the same question copy the table uses.
    const lines = await waitFor(() => {
      const found = document.querySelectorAll('.who-decides-confirm__line');
      expect(found).toHaveLength(1);
      return found;
    });
    expect(lines[0].getAttribute('data-question')).toBe('availability');
    expect(lines[0].textContent).toContain('How much stock can we promise?');
    expect(lines[0].textContent).toContain('OpenLinker will decide this from now on.');

    // The claim is switched off, not deleted — the operator can switch back.
    expect(
      screen.getByText(/keep their settings, so you can put them back in charge later/),
    ).toBeInTheDocument();

    // The prospective-only line is present whatever the dialog is showing.
    // Scoped to the dialog: § 3.2 also renders it persistently below the cards,
    // so an unscoped query matches twice and proves neither copy.
    expect(
      within(screen.getByRole('dialog')).getByText(/only affects what happens from now on/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('should say nothing changes and still allow saving when the diff is empty', async () => {
    renderPanel({ previewPreset: vi.fn().mockResolvedValue(preview()) });

    const user = userEvent.setup();
    await screen.findByText('How much stock can we promise?');
    await user.click(screen.getByRole('radio', { name: /Leave things as they are/ }));
    await user.click(screen.getByRole('button', { name: 'Save this arrangement' }));

    expect(
      await screen.findByText('Nothing changes when you save this — your setup already works this way.'),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('.who-decides-confirm__line')).toHaveLength(0);
    // An empty diff is a legitimate save, unlike a refusal.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(
      within(screen.getByRole('dialog')).getByText(/only affects what happens from now on/),
    ).toBeInTheDocument();
  });

  it('should block the save and name the conflicting connections when the result would be ambiguous', async () => {
    // The refusal is over the RESULT, not the delta — so the option that
    // changes nothing is refused too, and must not read as "nothing changes".
    const applyPreset = vi.fn();
    const previewPreset = vi.fn().mockResolvedValue(
      preview({
        presetId: 'leave-as-they-are',
        changes: [],
        blocked: true,
        resultingAmbiguities: [
          {
            reason: 'availability-unknown',
            badge: 'stopped',
            surfaces: ['product'],
            origin: 'authority-resolution',
            question: 'availability',
            connectionIds: ['c1', 'c2'],
          },
        ],
      }),
    );
    renderPanel({ applyPreset, previewPreset });

    const user = userEvent.setup();
    await screen.findByText('How much stock can we promise?');
    await user.click(screen.getByRole('radio', { name: /Leave things as they are/ }));
    await user.click(screen.getByRole('button', { name: 'Save this arrangement' }));

    expect(await screen.findByText('This cannot be saved yet')).toBeInTheDocument();
    // What would stop working — the same § 4.2 body the ambiguous row renders.
    expect(
      screen.getByText(/Two of your systems both say they're in charge of your stock/),
    ).toBeInTheDocument();
    // Both conflicting connections are named and linked, so the operator can act.
    // Pins the list element, not just the anchors: rendered as a bare inline
    // span the two links run together with no separator, which no DOM query
    // would notice.
    const links = document.querySelectorAll('.who-decides-confirm__block-links a');
    expect(links).toHaveLength(2);

    // The refusal reads differently from an empty diff, and blocks the save.
    expect(screen.queryByText(/Nothing changes when you save this/)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(applyPreset).not.toHaveBeenCalled();
  });

  it('should render an unresolvable connection as its own id so two of them stay tellable apart', async () => {
    const previewPreset = vi.fn().mockResolvedValue(
      preview({
        blocked: true,
        resultingAmbiguities: [
          {
            reason: 'availability-unknown',
            badge: 'stopped',
            surfaces: ['product'],
            origin: 'authority-resolution',
            question: 'availability',
            connectionIds: ['conn-aaa', 'conn-bbb'],
          },
        ],
      }),
    );
    renderPanel({ previewPreset });

    const user = userEvent.setup();
    await screen.findByText('How much stock can we promise?');
    await user.click(screen.getByRole('radio', { name: /Let OpenLinker decide/ }));
    await user.click(screen.getByRole('button', { name: 'Save this arrangement' }));

    await screen.findByText('This cannot be saved yet');
    // The id is what the backend said; a placeholder would render both as one word.
    expect(screen.getByRole('link', { name: 'conn-aaa' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'conn-bbb' })).toBeInTheDocument();
  });

  it('should refuse the save rather than claim nothing changes when the preview cannot be read', async () => {
    const applyPreset = vi.fn();
    renderPanel({ applyPreset, previewPreset: vi.fn().mockResolvedValue(null) });

    const user = userEvent.setup();
    await screen.findByText('How much stock can we promise?');
    await user.click(screen.getByRole('radio', { name: /Let OpenLinker decide/ }));
    await user.click(screen.getByRole('button', { name: 'Save this arrangement' }));

    expect(
      await screen.findByText(/could not work out what this would change/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing changes when you save this/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(applyPreset).not.toHaveBeenCalled();
  });

  it('should not write anything when the operator opens the dialog and cancels', async () => {
    // The dry run is a READ. Opening the dialog must never reach the apply.
    const applyPreset = vi.fn();
    const previewPreset = vi.fn().mockResolvedValue(preview());
    renderPanel({ applyPreset, previewPreset });

    const user = userEvent.setup();
    await screen.findByText('How much stock can we promise?');
    await user.click(screen.getByRole('radio', { name: /Let OpenLinker decide/ }));
    await user.click(screen.getByRole('button', { name: 'Save this arrangement' }));
    await screen.findByRole('button', { name: 'Save' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(previewPreset).toHaveBeenCalledWith('openlinker-decides');
    expect(applyPreset).not.toHaveBeenCalled();
  });
});
