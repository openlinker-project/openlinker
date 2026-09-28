/**
 * `FulfillmentWorkDetailBody` - the four detail sections (#3100, #3291).
 *
 * Every assertion below is written against a property that would survive a
 * reviewer deleting the code under it, rather than against the shape of the
 * markup. The four that carry #3100's acceptance criteria:
 *
 *   1. The holds section is ABSENT, heading included, when nothing is holding
 *      the task - not an empty heading, and not derived from `status`, which
 *      never says `on_hold` (#2406). Asserted in both directions, because a
 *      component that rendered the heading unconditionally would still pass a
 *      one-sided "the banner is gone" check.
 *   2. The stale-count caveat is `COPY.lines.caveat` - byte-identical to the
 *      shipped `FulfillmentTaskCard`'s own inline sentence - not a second
 *      wording, and it appears exactly ONCE for a two-line task - once per
 *      page, never once per line.
 *   3. The Location row renders even with no location, carrying the copy
 *      table's own sentence (divergence 5) rather than disappearing; when the
 *      backend resolves a friendly name, that name renders instead of the raw
 *      id (divergence 2, #3258 superseded by the backend already carrying
 *      `locationName`).
 *   4. The connection executing the task is NOT a fact row - it moved to its
 *      own section below, so "Details" never repeats it.
 *
 * #3291's own acceptance criteria are the "who's handling this" `describe`
 * block further down: the panel renders in every reachable state, an
 * unassigned task never fires the lookup at all, and a lookup that 404s still
 * shows the raw id rather than nothing.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FulfillmentWorkDetailBody } from './fulfillment-work-detail-body';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { FulfillmentTask, FulfillmentTaskLine } from '../api/fulfillment.types';
import { FULFILLMENT_WORK_DETAIL_COPY } from '../lib/fulfillment-work-detail.copy';

afterEach(cleanup);

const COPY = FULFILLMENT_WORK_DETAIL_COPY;

function line(overrides: Partial<FulfillmentTaskLine> = {}): FulfillmentTaskLine {
  return {
    id: 'line_1',
    orderLineId: 'ol_orderline_1',
    productVariantId: 'ol_variant_1',
    totalQuantity: 5,
    fulfilledQuantity: 3,
    cancelledQuantity: 0,
    ...overrides,
  };
}

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: 'ol_work_1',
    orderId: 'ol_order_1',
    locationId: 'loc_warsaw',
    locationName: undefined,
    deliveryMethod: 'courier',
    // `null` by default so the sections above and below "who's handling this"
    // never fire the #3291 connection lookup as a side effect of a fixture
    // they have no opinion about; the executor tests set their own id.
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
    lines: [line()],
    activeHolds: [],
    supportedActions: ['close'],
    version: 3,
    ...overrides,
  };
}

/** The `<section>` whose heading is `title`, so each case reads one section. */
function section(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const owner = heading.closest('section');
  expect(owner).not.toBeNull();
  return owner as HTMLElement;
}

describe('FulfillmentWorkDetailBody', () => {
  describe('why it is stuck', () => {
    it('renders one banner per active hold, with its reason, note and when it started', () => {
      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({
            activeHolds: [
              {
                id: 'hold_1',
                reason: 'stock-shortfall',
                note: 'Two units short in Warsaw.',
                placedAt: '2026-08-20T09:00:00.000Z',
              },
              {
                id: 'hold_2',
                reason: 'address-invalid',
                note: null,
                placedAt: '2026-08-20T09:30:00.000Z',
              },
            ],
          })}
        />
      );

      const holds = section(COPY.sections.holds);

      // The shared `holdReasonLabel` mirror, never a second copy of the
      // vocabulary: these are the labels `features/orders` already ships.
      expect(within(holds).getByText('Stock shortfall')).toBeInTheDocument();
      expect(within(holds).getByText('Address invalid')).toBeInTheDocument();
      expect(within(holds).getByText('Two units short in Warsaw.')).toBeInTheDocument();

      // One banner each - two holds must not collapse into one warning.
      expect(within(holds).getAllByRole('status')).toHaveLength(2);
      expect(within(holds).getAllByText(new RegExp(`^${COPY.holds.since}\\b`))).toHaveLength(2);
    });

    it('renders the hold reason raw when this build does not recognise it', () => {
      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({
            activeHolds: [
              {
                id: 'hold_1',
                reason: 'reason-from-a-newer-backend',
                note: null,
                placedAt: '2026-08-20T09:00:00.000Z',
              },
            ],
          })}
        />
      );

      // Shown-but-unlabelled beats silently dropped: an unknown reason still
      // tells the operator the task is stuck.
      expect(
        within(section(COPY.sections.holds)).getByText('reason-from-a-newer-backend')
      ).toBeInTheDocument();
    });

    it('omits the section entirely - heading included - when nothing is holding the task', () => {
      renderWithProviders(<FulfillmentWorkDetailBody task={task({ activeHolds: [] })} />);

      expect(screen.queryByRole('heading', { name: COPY.sections.holds })).not.toBeInTheDocument();
      // The guard of the guard: the other sections DID render, so the
      // assertion above is about the holds section and not about a body that
      // rendered nothing at all.
      expect(screen.getByRole('heading', { name: COPY.sections.lines })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: COPY.sections.facts })).toBeInTheDocument();
    });

    it('reads heldness from activeHolds and never from the status axis', () => {
      // Nothing writes `status: 'on_hold'`; a component that believed the
      // status axis would show a held task as unheld and an unheld one as
      // held. Both directions are asserted, since either alone passes against
      // a component that ignores one input.
      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({
            status: 'on_hold',
            activeHolds: [],
          })}
        />
      );
      expect(screen.queryByRole('heading', { name: COPY.sections.holds })).not.toBeInTheDocument();

      cleanup();

      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({
            status: 'in_progress',
            activeHolds: [
              {
                id: 'hold_1',
                reason: 'operator',
                note: null,
                placedAt: '2026-08-20T09:00:00.000Z',
              },
            ],
          })}
        />
      );
      expect(screen.getByRole('heading', { name: COPY.sections.holds })).toBeInTheDocument();
    });
  });

  describe("who's handling this", () => {
    it('renders the connection name and an external-partner label once the lookup resolves', async () => {
      const apiClient = createMockApiClient({
        connections: {
          getById: vi.fn().mockResolvedValue({
            id: 'conn_3pl',
            name: '3PL Warehouse',
            platformType: 'prestashop',
            status: 'active',
            config: {},
            credentialsBacked: true,
            enabledCapabilities: [],
            supportedCapabilities: [],
            createdAt: '2026-08-20T00:00:00.000Z',
            updatedAt: '2026-08-20T00:00:00.000Z',
          }),
        },
      });

      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ assignedConnectionId: 'conn_3pl' })} />,
        { apiClient }
      );

      const panel = section(COPY.sections.executor);
      expect(await within(panel).findByText('3PL Warehouse')).toBeInTheDocument();
      // "External partner", never the in-house sentence, for a non-`openlinker`
      // connection - and the resolved platform label rides alongside it.
      expect(within(panel).getByText(new RegExp(COPY.executor.externalPartner))).toBeInTheDocument();
      expect(within(panel).queryByText(COPY.executor.inHouse)).not.toBeInTheDocument();
    });

    it('says the task is handled automatically for an openlinker (in-house) connection', async () => {
      const apiClient = createMockApiClient({
        connections: {
          getById: vi.fn().mockResolvedValue({
            id: 'conn_oms',
            name: 'OpenLinker OMS',
            platformType: 'openlinker',
            status: 'active',
            config: {},
            credentialsBacked: false,
            enabledCapabilities: [],
            supportedCapabilities: [],
            createdAt: '2026-08-20T00:00:00.000Z',
            updatedAt: '2026-08-20T00:00:00.000Z',
          }),
        },
      });

      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ assignedConnectionId: 'conn_oms' })} />,
        { apiClient }
      );

      const panel = section(COPY.sections.executor);
      expect(await within(panel).findByText(COPY.executor.inHouse)).toBeInTheDocument();
      // No partner label for OL's own OMS - that wording is reserved for a
      // holder that is not OpenLinker itself.
      expect(
        within(panel).queryByText(new RegExp(COPY.executor.externalPartner))
      ).not.toBeInTheDocument();
    });

    it("renders 'not assigned yet' and never fires the lookup when the task has no executing connection", () => {
      const getById = vi.fn();
      const apiClient = createMockApiClient({ connections: { getById } });

      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ assignedConnectionId: null })} />,
        { apiClient }
      );

      // `scheduled`/`unsubmitted` work with nothing routed to it yet is a
      // real, reachable state - not an error and not a blank panel.
      expect(
        within(section(COPY.sections.executor)).getByText(COPY.executor.unassigned)
      ).toBeInTheDocument();
      expect(getById).not.toHaveBeenCalled();
    });

    it('degrades to the raw connection id when the lookup 404s - never to nothing', async () => {
      const apiClient = createMockApiClient({
        connections: {
          getById: vi.fn().mockRejectedValue(new ApiError('Not Found', 404, null)),
        },
      });

      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ assignedConnectionId: 'conn_deleted' })} />,
        { apiClient }
      );

      const panel = section(COPY.sections.executor);
      // A deleted or renamed connection must not make the panel disappear -
      // the raw id is what survives when the friendly name cannot be read.
      expect(await within(panel).findByText('conn_deleted')).toBeInTheDocument();
      expect(within(panel).getByText(COPY.executor.removed)).toBeInTheDocument();
    });

    it('also renders the raw connection id on a non-404 read failure', async () => {
      const apiClient = createMockApiClient({
        connections: {
          getById: vi.fn().mockRejectedValue(new Error('network down')),
        },
      });

      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ assignedConnectionId: 'conn_flaky' })} />,
        { apiClient }
      );

      // "Never nothing" does not stop at the 404 case named in the issue - any
      // failed read still degrades to the raw id rather than an empty panel.
      const panel = section(COPY.sections.executor);
      expect(await within(panel).findByText('conn_flaky')).toBeInTheDocument();
      expect(within(panel).getByText(COPY.executor.unavailable)).toBeInTheDocument();
    });
  });

  describe("what's in this task", () => {
    it('renders one row per line with its picked-of-total counts', () => {
      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({
            lines: [
              line({ id: 'line_1', productVariantId: 'ol_variant_a', fulfilledQuantity: 1 }),
              line({
                id: 'line_2',
                productVariantId: 'ol_variant_b',
                totalQuantity: 2,
                fulfilledQuantity: 2,
              }),
            ],
          })}
        />
      );

      const lines = section(COPY.sections.lines);
      const rows = within(lines).getAllByRole('listitem');
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).getByText('ol_variant_a')).toBeInTheDocument();
      expect(rows[0].textContent).toContain('1 / 5');
      expect(within(rows[1]).getByText('ol_variant_b')).toBeInTheDocument();
      expect(rows[1].textContent).toContain('2 / 2');
    });

    it('appends the cancelled count only when it is non-zero', () => {
      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({
            lines: [
              line({ id: 'line_1', productVariantId: 'ol_variant_a', cancelledQuantity: 2 }),
              line({ id: 'line_2', productVariantId: 'ol_variant_b', cancelledQuantity: 0 }),
            ],
          })}
        />
      );

      const rows = within(section(COPY.sections.lines)).getAllByRole('listitem');
      expect(rows[0].textContent).toContain(COPY.lines.cancelledSuffix(2));
      // A zero cancelled count says nothing and is not rendered as "(0
      // cancelled)", which reads as a thing that happened.
      expect(rows[1].textContent).not.toContain('cancelled');
    });

    it('marks a complete line with a tick that assistive technology never reads', () => {
      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({
            lines: [
              line({ id: 'line_1', totalQuantity: 4, fulfilledQuantity: 4 }),
              line({ id: 'line_2', totalQuantity: 4, fulfilledQuantity: 1 }),
            ],
          })}
        />
      );

      const lines = section(COPY.sections.lines);
      const ticks = lines.querySelectorAll('.fulfilment-work-detail__line-done');
      expect(ticks).toHaveLength(1);
      // Decorative reinforcement: the counts already say 4 of 4, so the glyph
      // must not reach a screen reader as stray punctuation.
      expect(ticks[0].getAttribute('aria-hidden')).toBe('true');
    });

    it('states the stale-count caveat once per page, as the shared constant — byte-identical to the card', () => {
      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({
            lines: [line({ id: 'line_1' }), line({ id: 'line_2' })],
          })}
        />
      );

      // The CONSTANT, so a re-worded copy of the sentence fails here rather
      // than shipping as a second answer to one question.
      expect(screen.getAllByText(COPY.lines.caveat)).toHaveLength(1);
      // Byte-identical to the shipped card's own inline sentence — the two
      // surfaces must describe the stale-counter fact identically.
      expect(COPY.lines.caveat).toBe(
        'Picked counts are reported by whoever is working the task and can be a little behind what you see here.'
      );
    });

    it('says the task covers no lines, and drops the count caveat with them', () => {
      renderWithProviders(<FulfillmentWorkDetailBody task={task({ lines: [] })} />);

      const lines = section(COPY.sections.lines);
      expect(within(lines).getByText(COPY.lines.empty)).toBeInTheDocument();
      expect(within(lines).queryAllByRole('listitem')).toHaveLength(0);
      // There is no count here to be behind, so the caveat would be a claim
      // about nothing.
      expect(screen.queryByText(COPY.lines.caveat)).not.toBeInTheDocument();
    });
  });

  describe('details', () => {
    it('renders the mockup fields, with the raw location id when no friendly name is known', () => {
      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({
            locationId: 'loc_warsaw',
            locationName: null,
            deliveryMethod: 'courier',
            externalWorkId: 'wh-88231',
          })}
        />
      );

      const facts = section(COPY.sections.facts);
      const labels = [...facts.querySelectorAll('dt')].map((node) => node.textContent);
      expect(labels).toEqual([
        COPY.facts.state,
        COPY.facts.handshake,
        COPY.facts.location,
        COPY.facts.delivery,
        COPY.facts.externalReference,
        COPY.facts.started,
      ]);

      expect(within(facts).getByText('loc_warsaw')).toBeInTheDocument();
      expect(within(facts).getByText('courier')).toBeInTheDocument();
      expect(within(facts).getByText('wh-88231')).toBeInTheDocument();
    });

    it('renders the friendly location name when the backend resolved one (#3258)', () => {
      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({ locationId: 'loc_warsaw', locationName: 'Warsaw — Main warehouse' })}
        />
      );

      const facts = section(COPY.sections.facts);
      expect(within(facts).getByText('Warsaw — Main warehouse')).toBeInTheDocument();
      // The raw id is not rendered ALONGSIDE the name — one Location row, one
      // value.
      expect(within(facts).queryByText('loc_warsaw')).not.toBeInTheDocument();
    });

    it('keeps the Location row and names the absence when there is no location', () => {
      renderWithProviders(<FulfillmentWorkDetailBody task={task({ locationId: null })} />);

      const facts = section(COPY.sections.facts);
      const labels = [...facts.querySelectorAll('dt')].map((node) => node.textContent);
      expect(labels).toContain(COPY.facts.location);
      // A row that names the absent fact, never a row that silently vanishes -
      // a disappearing row reads as a page that forgot.
      expect(within(facts).getByText(COPY.facts.noLocation)).toBeInTheDocument();
    });

    it('treats an empty string like an absent value, never as a blank row', () => {
      // `nullableString` passes `''` straight through, so a row rendered on
      // `!== null` would be a label over nothing.
      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({ locationId: '', deliveryMethod: '', externalWorkId: '' })}
        />
      );

      const facts = section(COPY.sections.facts);
      const labels = [...facts.querySelectorAll('dt')].map((node) => node.textContent);
      expect(labels).toEqual([
        COPY.facts.state,
        COPY.facts.handshake,
        COPY.facts.location,
        COPY.facts.started,
      ]);
      expect(within(facts).getByText(COPY.facts.noLocation)).toBeInTheDocument();
      expect([...facts.querySelectorAll('dd')].every((node) => node.textContent !== '')).toBe(
        true
      );
    });

    it('drops the delivery and reference rows when the task carries neither', () => {
      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ deliveryMethod: null, externalWorkId: null })} />
      );

      const labels = [...section(COPY.sections.facts).querySelectorAll('dt')].map(
        (node) => node.textContent
      );
      // No copy exists for an absent delivery or reference, so the row goes
      // rather than carrying a sentence nobody wrote.
      expect(labels).toEqual([
        COPY.facts.state,
        COPY.facts.handshake,
        COPY.facts.location,
        COPY.facts.started,
      ]);
    });

    it('never repeats the executing connection - that lives in its own section now', async () => {
      const apiClient = createMockApiClient({
        connections: {
          getById: vi.fn().mockResolvedValue({
            id: 'conn_3pl',
            name: '3PL Warehouse',
            platformType: 'prestashop',
            status: 'active',
            config: {},
            credentialsBacked: true,
            enabledCapabilities: [],
            supportedCapabilities: [],
            createdAt: '2026-08-20T00:00:00.000Z',
            updatedAt: '2026-08-20T00:00:00.000Z',
          }),
        },
      });

      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ assignedConnectionId: 'conn_3pl' })} />,
        { apiClient }
      );

      // The name resolves inside "Who's handling this" (below), never inside
      // "Details" - the row this test used to guard against was replaced by a
      // whole section, not deleted outright.
      await screen.findByText('3PL Warehouse');
      expect(
        within(section(COPY.sections.facts)).queryByText('3PL Warehouse')
      ).not.toBeInTheDocument();
      expect(within(section(COPY.sections.facts)).queryByText('conn_3pl')).not.toBeInTheDocument();
    });

    it('renders Started as a machine-readable time, not a re-formatted string', () => {
      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ createdAt: '2026-08-20T10:00:00.000Z' })} />
      );

      const started = section(COPY.sections.facts).querySelector('time');
      expect(started?.getAttribute('datetime')).toBe('2026-08-20T10:00:00.000Z');
    });
  });

  describe('shipment (#3292)', () => {
    it('renders "nothing dispatched yet" and NO create-label CTA for a 3rd-party holder', async () => {
      const apiClient = createMockApiClient({
        fulfillment: { listShipments: vi.fn().mockResolvedValue([]) } as never,
        connections: {
          getById: vi.fn().mockResolvedValue({
            id: 'conn_3pl',
            name: '3PL Warehouse',
            platformType: 'prestashop',
            status: 'active',
            config: {},
            credentialsBacked: true,
            enabledCapabilities: [],
            supportedCapabilities: [],
            createdAt: '2026-08-20T00:00:00.000Z',
            updatedAt: '2026-08-20T00:00:00.000Z',
          }),
        },
      });

      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ assignedConnectionId: 'conn_3pl' })} />,
        { apiClient }
      );

      const panel = section(COPY.sections.shipment);
      expect(await within(panel).findByText(COPY.shipment.none)).toBeInTheDocument();
      // A 3rd-party holder ships on its own — offering the CTA would invite
      // a duplicate shipment.
      expect(
        within(panel).queryByRole('link', { name: COPY.shipment.createLabel })
      ).not.toBeInTheDocument();
    });

    it('offers the create-label CTA, linking into the order page, for OL-executed work', async () => {
      const apiClient = createMockApiClient({
        fulfillment: { listShipments: vi.fn().mockResolvedValue([]) } as never,
        connections: {
          getById: vi.fn().mockResolvedValue({
            id: 'conn_oms',
            name: 'OpenLinker OMS',
            platformType: 'openlinker',
            status: 'active',
            config: {},
            credentialsBacked: false,
            enabledCapabilities: [],
            supportedCapabilities: [],
            createdAt: '2026-08-20T00:00:00.000Z',
            updatedAt: '2026-08-20T00:00:00.000Z',
          }),
        },
      });

      renderWithProviders(
        <FulfillmentWorkDetailBody
          task={task({ orderId: 'ol_order_42', assignedConnectionId: 'conn_oms' })}
        />,
        { apiClient }
      );

      const panel = section(COPY.sections.shipment);
      const cta = await within(panel).findByRole('link', { name: COPY.shipment.createLabel });
      expect(cta).toHaveAttribute('href', '/orders/ol_order_42#shipment');
    });

    it('renders carrier, tracking number and status for a dispatched shipment', async () => {
      const apiClient = createMockApiClient({
        fulfillment: {
          listShipments: vi.fn().mockResolvedValue([
            {
              id: 'ol_shipment_1',
              status: 'dispatched',
              carrier: 'inpost',
              trackingNumber: '6800000001',
              hasLabel: true,
              createdAt: '2026-08-20T09:00:00.000Z',
              dispatchedAt: '2026-08-20T09:05:00.000Z',
              deliveredAt: null,
            },
          ]),
        } as never,
      });

      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ assignedConnectionId: null })} />,
        { apiClient }
      );

      const panel = section(COPY.sections.shipment);
      expect(await within(panel).findByText('6800000001')).toBeInTheDocument();
      expect(within(panel).getByText('InPost')).toBeInTheDocument();
      expect(within(panel).getByText('dispatched')).toBeInTheDocument();
      // The "Track this parcel" link is a real tracker URL, not a placeholder.
      const trackLink = screen.getByRole('link', { name: COPY.shipment.trackParcel });
      expect(trackLink).toHaveAttribute('href', expect.stringContaining('6800000001'));
    });

    it('reports no label yet rather than throwing when a shipment has none', async () => {
      const apiClient = createMockApiClient({
        fulfillment: {
          listShipments: vi.fn().mockResolvedValue([
            {
              id: 'ol_shipment_1',
              status: 'draft',
              carrier: null,
              trackingNumber: null,
              hasLabel: false,
              createdAt: '2026-08-20T09:00:00.000Z',
              dispatchedAt: null,
              deliveredAt: null,
            },
          ]),
        } as never,
      });

      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ assignedConnectionId: null })} />,
        { apiClient }
      );

      expect(await screen.findByText(COPY.shipment.noLabelYet)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: COPY.shipment.trackParcel })).not.toBeInTheDocument();
    });
  });

  describe('payment (#3293)', () => {
    it('renders total, currency and the source channel, never a COD/prepaid claim', async () => {
      const apiClient = createMockApiClient({
        fulfillment: { listShipments: vi.fn().mockResolvedValue([]) } as never,
        orders: {
          getById: vi.fn().mockResolvedValue({
            internalOrderId: 'ol_order_1',
            customerId: null,
            sourceConnectionId: 'conn_shop',
            sourceEventId: null,
            orderSnapshot: {
              totals: {
                subtotal: 20,
                tax: 3.92,
                shipping: 5,
                total: 28.92,
                currency: 'PLN',
                taxTreatment: 'inclusive',
              },
            },
            syncStatus: [],
            syncAttempts: [],
            recordStatus: 'ready',
            createdAt: '2026-08-20T00:00:00.000Z',
            updatedAt: '2026-08-20T00:00:00.000Z',
          }),
        },
        connections: {
          getById: vi.fn().mockResolvedValue({
            id: 'conn_shop',
            name: 'My PrestaShop Store',
            platformType: 'prestashop',
            status: 'active',
            config: {},
            credentialsBacked: true,
            enabledCapabilities: [],
            supportedCapabilities: [],
            createdAt: '2026-08-20T00:00:00.000Z',
            updatedAt: '2026-08-20T00:00:00.000Z',
          }),
        },
      });

      renderWithProviders(
        <FulfillmentWorkDetailBody task={task({ orderId: 'ol_order_1' })} />,
        { apiClient }
      );

      const panel = section(COPY.sections.payment);
      expect(await within(panel).findByText('My PrestaShop Store')).toBeInTheDocument();
      expect(within(panel).getByText(/28[.,]92/)).toBeInTheDocument();
      // Never a true/false payment-method claim — the copy is explicit about
      // what this build does not yet know.
      expect(within(panel).getByText(COPY.payment.followUpNote)).toBeInTheDocument();
      expect(screen.queryByText(/cash on delivery/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/prepaid/i)).not.toBeInTheDocument();
    });

    it('says the summary could not be loaded rather than throwing when the order read fails', async () => {
      const apiClient = createMockApiClient({
        fulfillment: { listShipments: vi.fn().mockResolvedValue([]) } as never,
        orders: { getById: vi.fn().mockRejectedValue(new ApiError('boom', 500, null)) },
      });

      renderWithProviders(<FulfillmentWorkDetailBody task={task()} />, { apiClient });

      expect(await screen.findByText(COPY.payment.unavailable)).toBeInTheDocument();
    });
  });
});
