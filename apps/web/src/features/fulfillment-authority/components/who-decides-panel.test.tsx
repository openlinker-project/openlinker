/**
 * Who-decides panel — component tests.
 *
 * The acceptance criteria of #2354, in the order the issue lists them.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 */
import { screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WhoDecidesPanel } from './who-decides-panel';
import { ApiError } from '../../../shared/api/api-error';
import type { AuthorityStatus } from '../api/who-decides.types';
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

interface RenderPanelOptions {
  status?: AuthorityStatus | null;
  applyPreset?: ApiClient['fulfillmentAuthority']['applyPreset'];
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
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Only part of this was saved')).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
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
    await user.click(await screen.findByRole('button', { name: 'Save' }));

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
    await user.click(await screen.findByRole('button', { name: 'Save' }));

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
});
