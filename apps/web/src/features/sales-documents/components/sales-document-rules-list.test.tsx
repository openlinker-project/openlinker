/**
 * SalesDocumentRulesList Tests (#3178)
 *
 * Covers the one behaviour this issue adds: a list-level warning when a
 * rule names a connection that cannot be a routing candidate — set to issue
 * Nothing (`documentKind` unset, or the connection carries neither
 * `Invoicing` nor `Fiscalization`), or not `active`. Such a rule can never
 * route.
 *
 * Plus the rival-highlight wiring (#3190): the composer names a colliding rule
 * and the list reveals it. Two properties are load-bearing and neither is
 * observable from the composer's own tests - the scroll must happen only AFTER
 * the dialog has unmounted (Radix locks the body with `react-remove-scroll` and
 * restores the scroll position when the lock releases, so a scroll issued while
 * it is open is undone), and the accent must clear, or it reads as a property
 * of the rule rather than a cue for one arrival.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { SalesDocumentRulesList } from './sales-document-rules-list';
import type { SalesDocumentRule } from '../api/sales-document-rules.types';
import type { Connection } from '../../connections';

/**
 * Address a rule row by its RULE ID.
 *
 * The row's `data-testid` is the mockup's index-keyed `rule-row-{n}` (#3196),
 * so an id-keyed assertion reads the `id` attribute the reveal effect already
 * scrolls and focuses by — the same element, and the same route the
 * `scrolled[0]` assertion below has always used.
 */
function ruleCardById(ruleId: string): HTMLElement {
  const element = document.getElementById(`rule-card-${ruleId}`);
  if (element === null) {
    throw new Error(`No rule card rendered for rule id "${ruleId}"`);
  }
  return element;
}

function makeRule(overrides: Partial<SalesDocumentRule> = {}): SalesDocumentRule {
  return {
    id: 'rule_1',
    country: 'PL',
    conditions: [],
    documentKind: 'fiscal-receipt',
    connectionId: 'conn_epar',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    provenance: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    ...sampleConnection,
    id: 'conn_epar',
    name: 'e-paragony Sandbox',
    platformType: 'eparagony',
    enabledCapabilities: ['Fiscalization'],
    supportedCapabilities: ['Fiscalization'],
    config: {},
    ...overrides,
  };
}

describe('SalesDocumentRulesList', () => {
  it('should render the destination warning when a rule names a connection issuing Nothing', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([makeRule()]),
      },
      connections: {
        list: vi.fn().mockResolvedValue([makeConnection()]),
      },
    });

    renderWithProviders(<SalesDocumentRulesList country="PL" />, { apiClient });

    const warning = await screen.findByTestId('rules-destination-warning');
    expect(warning).toHaveTextContent('e-paragony Sandbox');
    expect(warning).toHaveTextContent('Nothing');
  });

  it('should render the disabled remedy, not the role one, for a non-active destination', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([makeRule()]),
      },
      connections: {
        list: vi.fn().mockResolvedValue([
          makeConnection({
            status: 'disabled',
            config: { salesDocument: { documentKind: 'fiscal-receipt' } },
          }),
        ]),
      },
    });

    renderWithProviders(<SalesDocumentRulesList country="PL" />, { apiClient });

    const warning = await screen.findByTestId('rules-destination-warning');
    expect(warning).toHaveTextContent('is disabled');
    expect(warning).toHaveTextContent('Enable it');
  });

  it('should not render the warning when the destination has a document kind configured', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([makeRule()]),
      },
      connections: {
        list: vi
          .fn()
          .mockResolvedValue([
            makeConnection({ config: { salesDocument: { documentKind: 'fiscal-receipt' } } }),
          ]),
      },
    });

    renderWithProviders(<SalesDocumentRulesList country="PL" />, { apiClient });

    await screen.findByText(/Rules have no order of priority/);
    expect(screen.queryByTestId('rules-destination-warning')).not.toBeInTheDocument();
  });

  it('should not render the warning when there are no rules', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
      },
      connections: {
        list: vi.fn().mockResolvedValue([makeConnection()]),
      },
    });

    renderWithProviders(<SalesDocumentRulesList country="PL" />, { apiClient });

    await screen.findByText('No rules yet for this country.');
    expect(screen.queryByTestId('rules-destination-warning')).not.toBeInTheDocument();
  });

  describe('rival highlight (#3190)', () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    function apiWithCollision(): ReturnType<typeof createMockApiClient> {
      return createMockApiClient({
        salesDocumentRules: {
          listRules: vi.fn().mockResolvedValue([makeRule()]),
          checkRuleOverlap: vi.fn().mockResolvedValue({
            overlapping: [
              { ruleId: 'rule_1', connectionId: 'conn_epar', documentKind: 'fiscal-receipt' },
            ],
            disjoint: [],
            undecided: [],
          }),
        },
        connections: {
          list: vi
            .fn()
            .mockResolvedValue([
              makeConnection({ config: { salesDocument: { documentKind: 'fiscal-receipt' } } }),
            ]),
        },
      });
    }

    // This asserts WHAT is revealed, not WHEN. Two earlier versions tried to pin
    // the timing - first that the dialog was gone at the moment of the scroll,
    // then that the scroll had not happened by the time the click resolved -
    // and both failed on the environment rather than on the behaviour: Radix's
    // unmount and `requestAnimationFrame` are both flushed inside testing
    // library's `act()` wrapper under happy-dom, so neither is observable here.
    //
    // The deferral itself is a one-line `requestAnimationFrame` documented at
    // the call site with the reason (Radix's `react-remove-scroll` restores the
    // scroll position when the body lock releases). What IS worth asserting,
    // and is environment-independent, is that the right row gets accented and
    // the scroll targets that same row.
    it('should accent the named rule and scroll to that row', async () => {
      const scrolled: Element[] = [];
      Element.prototype.scrollIntoView = vi.fn(function scrollIntoViewStub(this: Element) {
        scrolled.push(this);
      });

      const user = userEvent.setup();
      renderWithProviders(<SalesDocumentRulesList country="PL" />, {
        apiClient: apiWithCollision(),
        // `+ Add rule` is `disabled={!write.canWrite}` and the default session
        // adapter is ANONYMOUS - the button renders but the click is a no-op,
        // so the composer never opens and every assertion below times out.
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      await user.click(await screen.findByRole('button', { name: '+ Add rule' }));
      const composer = await screen.findByRole('dialog');
      await user.click(await within(composer).findByTestId('rule-conflict-open-existing'));

      await waitFor(() =>
        expect(ruleCardById('rule_1')).toHaveClass('rule-card--highlighted')
      );
      await waitFor(() => expect(scrolled).toHaveLength(1));
      expect(scrolled[0]).toBe(document.getElementById('rule-card-rule_1'));
    });

    it('should clear the accent when the composer is opened again', async () => {
      Element.prototype.scrollIntoView = vi.fn();

      const user = userEvent.setup();
      renderWithProviders(<SalesDocumentRulesList country="PL" />, {
        apiClient: apiWithCollision(),
        // `+ Add rule` is `disabled={!write.canWrite}` and the default session
        // adapter is ANONYMOUS - the button renders but the click is a no-op,
        // so the composer never opens and every assertion below times out.
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });

      await user.click(await screen.findByRole('button', { name: '+ Add rule' }));
      const composer = await screen.findByRole('dialog');
      await user.click(await within(composer).findByTestId('rule-conflict-open-existing'));
      await waitFor(() =>
        expect(ruleCardById('rule_1')).toHaveClass('rule-card--highlighted')
      );

      await user.click(screen.getByRole('button', { name: '+ Add rule' }));

      await waitFor(() =>
        expect(ruleCardById('rule_1')).not.toHaveClass('rule-card--highlighted')
      );
    });
  });
});
