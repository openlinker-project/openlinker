/**
 * Fulfilment worklist — rendered-output copy audit (AC4, #2410).
 *
 * `scripts/check-ui-vocabulary.mjs` already scans `features/fulfillment`, so
 * every `*.copy.ts` and `.tsx` this body adds under that folder is gated with
 * no script change — which is why ALL worklist copy lives there and the page
 * carries no string literals of its own.
 *
 * This test covers the script's own documented blind spots, and this body lands
 * in two of the three: it renders a BACKEND-SOURCED message on the un-coded 409
 * path, and it HUMANISES raw vocabulary values (`fulfillmentStatusLabel` falls
 * back to a title-cased form of whatever the server sent). Neither reaches any
 * source literal, so a source scan cannot see them. This is therefore a
 * RENDERED-OUTPUT audit, not a second source scan.
 *
 * ## The banned terms are READ, not restated
 *
 * They come from the fenced `<!-- ui-vocabulary:start -->` table in the product
 * spec — the same table the script treats as the single source under its Rule
 * A. A hand-copied list here would be a second, ungated mirror of a nine-term
 * vocabulary, drifting the day a tenth term or a mode change lands.
 *
 * The TABLE is read rather than the script's exported parser, because
 * `check-ui-vocabulary.mjs` calls `main()` at module scope (and `process.exit`s
 * on some paths), so importing it from a test would run the whole repo scan as
 * a side effect. The parser below therefore mirrors the script's row rule — a
 * backticked term cell plus a mode cell — while the VOCABULARY, which is the
 * half that actually drifts, is read from the one source.
 *
 * If the fence parses to zero rows this test FAILS: the script's own Z1 rule,
 * because a scan with an empty deny-list cannot fire.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FulfillmentWorklistPage } from './fulfillment-worklist-page';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
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

    // A row counts only when its TERM cell is backticked — that skips the
    // header and the `|---|` separator without counting either.
    const termMatch = /^`([^`]+)`$/.exec(cells[1].trim());
    if (!termMatch) continue;

    const modeCell = cells[2].trim();
    const mode: 'word' | 'exact' | null = /case-insensitive/i.test(modeCell)
      ? 'word'
      : /\bexact\b/i.test(modeCell)
        ? 'exact'
        : null;
    // A mode the table does not name is FATAL rather than defaulted: guessing
    // would make the mirror meaningless in exactly the direction it guards.
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

/** The matched term, or `null`. Mirrors the script's `matchBannedTerm`. */
function matchBannedTerm(text: string, row: BannedTerm): string | null {
  if (row.mode === 'word') {
    if (new RegExp(`\\b${escapeRegExp(row.term)}\\b`, 'i').test(text)) return row.term;
  } else if (text.includes(row.term)) {
    return row.term;
  }
  for (const alt of row.alternates) {
    // Alternates are case-SENSITIVE whole-word, so `ATP` does not fire on
    // "adaptive".
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

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: 'ol_work_1',
    orderId: 'ol_order_1',
    locationId: 'loc_warsaw',
    deliveryMethod: 'courier',
    assignedConnectionId: null,
    status: 'open',
    requestStatus: 'unsubmitted',
    assignmentAttempt: 0,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: null,
    cancelledAt: null,
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
  list: ReturnType<typeof vi.fn>;
  route?: string;
  demoMode?: boolean;
}): void {
  const api = createMockApiClient({
    system: {
      getConfig: vi.fn().mockResolvedValue({ demoMode: opts.demoMode ?? false }),
    },
    fulfillment: {
      list: opts.list,
      applyAction: vi.fn().mockResolvedValue(task()),
    } as never,
  });

  renderWithProviders(<FulfillmentWorklistPage />, {
    apiClient: api,
    route: opts.route ?? '/fulfillment',
    sessionAdapter: createAuthenticatedSessionAdapter(OPERATOR),
  });
}

/**
 * Every user-visible string the render produced, as DISCRETE strings.
 *
 * Deliberately NOT `document.body.textContent`. That concatenates sibling
 * nodes with no separator — a real render produced
 * `…ol_work_1ol_order_1Posture check…` — so a whole-word rule finds no word
 * boundary before a term that happens to abut the previous node, and the scan
 * silently misses it. Six of the nine banned terms are whole-word rules, so
 * that is most of the vocabulary failing to fire on most of the screen. The
 * shared script scans discrete string literals for exactly this reason; this
 * is the rendered-output analogue.
 *
 * User-facing ATTRIBUTES are collected too: a `title` is the tooltip an
 * operator reads, and this feature puts an action's hint there.
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

/**
 * Assert the render produced text, contains a sentinel known to be in THIS
 * state's copy, and carries none of the banned terms.
 *
 * The sentinel is the vacuity guard that matters most here: a banned-word scan
 * over an empty render passes trivially, and the whole point of splitting the
 * states into their own `it()`s is that one throwing render cannot silently
 * skip the others.
 */
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

describe('fulfilment worklist copy audit', () => {
  it('reads a non-empty banned-term list from the fenced spec table', () => {
    // The script's own Z1 rule: a scan with an empty deny-list cannot fire, so
    // an unreadable fence is a FAILURE rather than a silent pass.
    expect(BANNED_TERMS.length).toBeGreaterThan(0);
    // The table is the vocabulary; if it ever parses to a single row that is a
    // parser regression, not a shrinking vocabulary.
    expect(BANNED_TERMS.length).toBeGreaterThanOrEqual(9);
  });

  it('is clean while loading', () => {
    renderState({ list: vi.fn(() => new Promise(() => undefined)) });
    expectCleanCopy('Loading fulfilment tasks');
  });

  it('is clean on a failed read', async () => {
    renderState({ list: vi.fn().mockRejectedValue(new ApiError('boom', 500, {})) });
    await screen.findByText('Could not load the fulfilment worklist');
    expectCleanCopy('Could not load the fulfilment worklist');
  });

  it('is clean on an empty unfiltered worklist', async () => {
    renderState({
      list: vi.fn().mockResolvedValue({ works: [], total: 0, limit: 25, offset: 0 }),
    });
    await screen.findByText('Nothing to work right now');
    expectCleanCopy('Nothing to work right now');
  });

  it('is clean on an empty filtered worklist', async () => {
    renderState({
      list: vi.fn().mockResolvedValue({ works: [], total: 0, limit: 25, offset: 0 }),
      route: '/fulfillment?orderId=nope',
    });
    await screen.findByText('No fulfilment tasks match these filters');
    expectCleanCopy('No fulfilment tasks match these filters');
  });

  it('is clean when paged past the end', async () => {
    renderState({
      list: vi.fn().mockResolvedValue({ works: [], total: 40, limit: 25, offset: 100 }),
      route: '/fulfillment?offset=100',
    });
    await screen.findByText('Nothing on this page');
    expectCleanCopy('Nothing on this page');
  });

  it('is clean with a populated worklist carrying a held task', async () => {
    renderState({
      list: vi.fn().mockResolvedValue({
        works: [
          task({
            activeHolds: [
              {
                id: 'hold_1',
                reason: 'awaiting_payment',
                note: 'Buyer asked us to wait.',
                placedAt: '2026-08-20T11:00:00.000Z',
              },
            ],
          }),
          task({ id: 'ol_work_2', locationId: null, deliveryMethod: null }),
        ],
        total: 2,
        limit: 25,
        offset: 0,
      }),
    });
    await screen.findAllByText(/on hold/i);
    expectCleanCopy('No location yet');
  });

  it('is clean when the server sends a status this build does not recognise', async () => {
    // Reaches the screen ONLY through the humanising fallback — no source
    // literal anywhere carries it, which is precisely the shared script's blind
    // spot this test exists to cover.
    renderState({
      list: vi.fn().mockResolvedValue({
        works: [task({ status: 'awaiting_wave', requestStatus: 'submitted' })],
        total: 1,
        limit: 25,
        offset: 0,
      }),
    });
    await screen.findAllByText(/awaiting wave/i);
    expectCleanCopy('Awaiting wave');
  });

  it('is clean when the server offers an action this build has no copy for', async () => {
    renderState({
      list: vi.fn().mockResolvedValue({
        works: [task({ supportedActions: ['expedite_pick'] })],
        total: 1,
        limit: 25,
        offset: 0,
      }),
    });
    await screen.findAllByRole('button', { name: 'Expedite pick' });
    expectCleanCopy('Expedite pick');
  });

  it('is clean in the demo read-only render', async () => {
    renderState({
      list: vi.fn().mockResolvedValue({ works: [task()], total: 1, limit: 25, offset: 0 }),
      demoMode: true,
    });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
    });
    expectCleanCopy('Close');
  });
});
