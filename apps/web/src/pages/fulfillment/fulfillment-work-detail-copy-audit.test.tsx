/**
 * `FulfillmentWorkDetailPage` — rendered-output copy audit (Wave 5, #3096).
 *
 * `scripts/check-ui-vocabulary.mjs` scans `features/fulfillment/**` source
 * literals, and `apps/web/src/pages` is outside its walk entirely — this
 * page's own module docblock says so. So the source scan cannot see this
 * file's copy at all; what it CAN see is `FULFILLMENT_WORK_DETAIL_COPY`, which
 * this page composes exclusively. The gap the script leaves is the same one
 * `fulfillment-copy-audit.test.tsx` closes for the assign board: text that
 * reaches the screen without ever being a source literal — a HUMANISING
 * fallback for a status/action/reason this build does not recognise, and a
 * BACKEND-SOURCED message on the un-coded 409 path. This is that audit for the
 * detail page.
 *
 * ## The banned terms are READ, not restated
 *
 * Same rule as the assign-board audit: the vocabulary comes from the fenced
 * `<!-- ui-vocabulary:start -->` table in the product spec, never a
 * hand-copied list here. The parser below is a second copy of that audit's own
 * parser rather than an import from it — that file exports nothing, and
 * importing a `*.test.tsx` from another test is not a pattern this repo uses.
 * Both copies read the same one source, so they cannot drift from EACH OTHER
 * even though they are not the same code.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Route, Routes } from 'react-router-dom';

import { FulfillmentWorkDetailPage } from './fulfillment-work-detail-page';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  findToastDescription,
  renderWithProviders,
} from '../../test/test-utils';
import type { FulfillmentTask } from '../../features/fulfillment';
import type { SessionUser } from '../../shared/auth/session.types';
import { ApiError } from '../../shared/api/api-error';

afterEach(cleanup);

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const SPEC_FILE = join(
  REPO_ROOT,
  'docs',
  'specs',
  'product-spec-oms-wave2-operator-experience.md'
);
const FENCE_START = '<!-- ui-vocabulary:start -->';
const FENCE_END = '<!-- ui-vocabulary:end -->';

interface BannedTerm {
  term: string;
  mode: 'word' | 'exact';
  alternates: string[];
}

function readBannedTerms(): BannedTerm[] {
  const content = readFileSync(SPEC_FILE, 'utf8');
  const start = content.indexOf(FENCE_START);
  const end = content.indexOf(FENCE_END, start);
  if (start === -1 || end === -1) return [];

  const rows: BannedTerm[] = [];
  for (const raw of content.slice(start + FENCE_START.length, end).split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.split('|').slice(1, -1);
    if (cells.length < 3) continue;

    const termMatch = /^`([^`]+)`$/.exec(cells[1].trim());
    if (!termMatch) continue;

    const modeCell = cells[2].trim();
    const mode: 'word' | 'exact' | null = /case-insensitive/i.test(modeCell)
      ? 'word'
      : /\bexact\b/i.test(modeCell)
        ? 'exact'
        : null;
    expect(mode, `unreadable match mode for \`${termMatch[1]}\``).not.toBeNull();

    const alternates: string[] = [];
    for (const alt of modeCell.matchAll(/["“”]([^"“”]+)["“”]/g)) alternates.push(alt[1]);

    rows.push({ term: termMatch[1], mode: mode as 'word' | 'exact', alternates });
  }
  return rows;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchBannedTerm(text: string, row: BannedTerm): string | null {
  if (row.mode === 'word') {
    if (new RegExp(`\\b${escapeRegExp(row.term)}\\b`, 'i').test(text)) return row.term;
  } else if (text.includes(row.term)) {
    return row.term;
  }
  for (const alt of row.alternates) {
    if (new RegExp(`\\b${escapeRegExp(alt)}\\b`).test(text)) return alt;
  }
  return null;
}

const BANNED_TERMS = readBannedTerms();

const OPERATOR: SessionUser = {
  id: 'user_2',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
};

const WORK_ID = 'ol_work_1';

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: WORK_ID,
    orderId: 'ol_order_a1b2c3d4e5f60718293a4b5c6d7e8f90',
    locationId: 'loc_warsaw',
    deliveryMethod: 'courier',
    assignedConnectionId: null,
    assignedToUserId: null,
    selfServeEligible: true,
    status: 'open',
    requestStatus: 'unsubmitted',
    assignmentAttempt: 0,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: null,
    cancelledAt: null,
    expeditedAt: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    lines: [
      {
        id: 'line_1',
        orderLineId: 'ol_orderline_1',
        productVariantId: 'ol_variant_1',
        totalQuantity: 5,
        fulfilledQuantity: 3,
        cancelledQuantity: 0,
      },
    ],
    activeHolds: [],
    supportedActions: ['hold', 'close'],
    version: 3,
    ...overrides,
  };
}

function renderState(opts: {
  get: ReturnType<typeof vi.fn>;
  applyAction?: ReturnType<typeof vi.fn>;
  route?: string;
  demoMode?: boolean;
  user?: SessionUser;
}): void {
  const apiClient = createMockApiClient({
    system: {
      getConfig: vi.fn().mockResolvedValue({ demoMode: opts.demoMode ?? false }),
    },
    fulfillment: {
      get: opts.get,
      applyAction: opts.applyAction ?? vi.fn().mockResolvedValue(task()),
    } as never,
  });

  renderWithProviders(
    <Routes>
      <Route path="/fulfillment/works/:workId" element={<FulfillmentWorkDetailPage />} />
    </Routes>,
    {
      apiClient,
      route: opts.route ?? `/fulfillment/works/${WORK_ID}`,
      sessionAdapter: createAuthenticatedSessionAdapter(opts.user ?? OPERATOR),
    }
  );
}

/**
 * Every user-visible string the render produced, as DISCRETE strings — see
 * `fulfillment-copy-audit.test.tsx` for why `body.textContent` cannot be used
 * instead (it concatenates sibling nodes with no separator, which defeats the
 * whole-word rules most of this vocabulary uses).
 */
function visibleStrings(): string[] {
  const strings: string[] = [];

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    if (text.length > 0) strings.push(text);
  }

  const ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt'] as const;
  for (const element of document.body.querySelectorAll('*')) {
    for (const attribute of ATTRIBUTES) {
      const value = element.getAttribute(attribute)?.trim() ?? '';
      if (value.length > 0) strings.push(value);
    }
  }

  return strings;
}

function expectCleanCopy(sentinel: string): void {
  const strings = visibleStrings();
  expect(strings.length).toBeGreaterThan(0);
  expect(strings.join(' ')).toContain(sentinel);

  const found: string[] = [];
  for (const text of strings) {
    for (const row of BANNED_TERMS) {
      const matched = matchBannedTerm(text, row);
      if (matched !== null) found.push(`${matched} (rule: ${row.term}) in "${text}"`);
    }
  }
  expect(found, 'banned vocabulary reached the screen').toEqual([]);
}

describe('fulfilment work detail copy audit', () => {
  it('reads a non-empty banned-term list from the fenced spec table', () => {
    expect(BANNED_TERMS.length).toBeGreaterThan(0);
    expect(BANNED_TERMS.length).toBeGreaterThanOrEqual(9);
  });

  it('is clean while loading', async () => {
    renderState({ get: vi.fn(() => new Promise<never>(() => undefined)) });
    // The gate renders nothing until the session hydrates, so wait for the
    // skeleton's own status text rather than reading the first paint.
    await screen.findByText('Loading this fulfilment task');
    expectCleanCopy('Loading this fulfilment task');
  });

  it('is clean on the access-denied render (#3096)', async () => {
    renderState({
      get: vi.fn().mockResolvedValue(task()),
      user: { ...OPERATOR, role: 'viewer', permissions: ['orders:read'] },
    });
    await screen.findByText('Fulfilment tasks are for supervisors');
    expectCleanCopy('Fulfilment tasks are for supervisors');
  });

  it('is clean on a 404, and never the generic error copy', async () => {
    renderState({ get: vi.fn().mockRejectedValue(new ApiError('nope', 404, null)) });
    await screen.findAllByText('Task not found');
    expectCleanCopy('No fulfilment task matches this address');
  });

  it('is clean on a failed read that is not a 404', async () => {
    renderState({ get: vi.fn().mockRejectedValue(new ApiError('boom', 500, {})) });
    await screen.findByText('Could not load this fulfilment task');
    expectCleanCopy('Could not load this fulfilment task');
  });

  it('is clean when the server sends a status this build does not recognise', async () => {
    // Reaches the screen ONLY through `fulfillmentStatusLabel`'s humanising
    // fallback — no source literal anywhere carries it, so a source scan
    // cannot see it. The hero and the Details grid (#3100) both render it.
    renderState({
      get: vi.fn().mockResolvedValue(task({ status: 'awaiting_wave', requestStatus: 'submitted' })),
    });
    const hits = await screen.findAllByText(/awaiting wave/i);
    expect(hits.length).toBeGreaterThan(0);
    expectCleanCopy('Awaiting wave');
  });

  it('is clean when a hold carries a reason this build does not recognise', async () => {
    // `holdReasonLabel` passes an unrecognised reason through VERBATIM
    // (`order-hold.types.test.ts`), so an operator-unfriendly string can reach
    // this screen with no source literal behind it either.
    renderState({
      get: vi.fn().mockResolvedValue(
        task({
          activeHolds: [
            {
              id: 'hold_1',
              reason: 'a-reason-from-a-newer-build',
              note: null,
              placedAt: '2026-08-20T11:00:00.000Z',
            },
          ],
        })
      ),
    });
    await screen.findByText('a-reason-from-a-newer-build');
    expectCleanCopy('a-reason-from-a-newer-build');
  });

  it('is clean when the server offers an action this build has no copy for', async () => {
    renderState({ get: vi.fn().mockResolvedValue(task({ supportedActions: ['expedite_pick'] })) });
    await screen.findByRole('button', { name: 'Expedite pick' });
    expectCleanCopy('Expedite pick');
  });

  it('is clean on a partly-cancelled line, an external reference and no location', async () => {
    // No Location fact on a one-location install (#3096), so the external
    // reference is the sentinel the render is waited on.
    renderState({
      get: vi.fn().mockResolvedValue(
        task({
          locationId: null,
          externalWorkId: 'EXT-9182',
          lines: [
            {
              id: 'line_1',
              orderLineId: 'ol_orderline_1',
              productVariantId: 'ol_variant_1',
              totalQuantity: 5,
              fulfilledQuantity: 2,
              cancelledQuantity: 1,
            },
          ],
        })
      ),
    });
    await screen.findByText('EXT-9182');
    expectCleanCopy('(1 cancelled)');
  });

  it("is clean on the un-coded 409 an operator hits from this page’s own action bar", async () => {
    // No `code` in the body, matching `FulfillmentHoldLimitExceededError` /
    // `FulfillmentHoldAlreadyReleasedError` (`fulfillment-conflict.ts`).
    // `describeFulfillmentActionError` passes the server's OWN sentence
    // through verbatim on this path, so this is the toast-shown analogue of
    // the assign-board audit's un-coded-409 blind spot.
    renderState({
      get: vi.fn().mockResolvedValue(task({ supportedActions: ['hold'] })),
      applyAction: vi
        .fn()
        .mockRejectedValue(
          new ApiError('This fulfilment task already has the maximum number of active holds.', 409, {})
        ),
    });
    const holdButton = await screen.findByRole('button', { name: 'Put on hold' });
    holdButton.click();
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Put on hold' });
    submit.click();
    await findToastDescription(/maximum number of active holds/);
    expectCleanCopy('maximum number of active holds');
  });

  it('is clean in the demo read-only render', async () => {
    renderState({ get: vi.fn().mockResolvedValue(task()), demoMode: true });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
    });
    expectCleanCopy('Close');
  });
});
