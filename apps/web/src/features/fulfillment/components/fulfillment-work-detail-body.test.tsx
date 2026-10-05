/**
 * `FulfillmentWorkDetailBody` — the task detail's two columns (#3100, rebuilt
 * to the mockup's box model by #3096).
 *
 * Each assertion is written against a property that would survive a reviewer
 * deleting the code under it, rather than against markup shape:
 *
 *   1. Every section is a CARD (`.detail-card`) — the page used to pass every
 *      text check while rendering its sections flat on the page background.
 *   2. The holds card is ABSENT, heading included, when nothing holds the
 *      task, and heldness is read from `activeHolds`, never from `status`.
 *   3. A line renders as a product card — name, SKU · EAN, attributes — and
 *      falls back to the variant id only when the catalogue has no product.
 *   4. Delivery is a carrier NAME, never the raw delivery-method id, and the
 *      Location fact renders only on a multi-location install.
 *   5. The bench facts (#3096, G02-3): parcel closed, channel notified, and
 *      the warning when a closed parcel has not been settled yet.
 *   6. The right column is the order page's own modules, fed by one order
 *      read, plus the Packer card.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FulfillmentWorkDetailBody } from './fulfillment-work-detail-body';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { ApiClient } from '../../../app/api/api-client';
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
    id: 'ol_fwork_1',
    orderId: 'ol_order_1',
    locationId: 'loc_warsaw',
    locationName: 'Main warehouse',
    deliveryMethod: '2488f7b7-5d1c-4d65-b85c-4cbcf253fd93',
    carrierName: null,
    // `null` so the executor lookup only fires in the tests that set one.
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

function connection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

/** A mock API whose reads the body makes all settle, so no test trips on a stray `undefined`. */
function api(overrides: Partial<ApiClient> & { activeLocations?: number } = {}): ApiClient {
  const { activeLocations = 1, ...rest } = overrides;
  return createMockApiClient({
    inventory: {
      listActiveLocations: vi.fn().mockResolvedValue({ items: [], total: activeLocations, page: 1, limit: 1 }),
    } as never,
    users: { listPackers: vi.fn().mockResolvedValue({ packers: [] }) } as never,
    orders: { getById: vi.fn().mockRejectedValue(new ApiError('boom', 500, null)) } as never,
    ...rest,
  });
}

function renderBody(t: FulfillmentTask, apiClient: ApiClient = api()): void {
  renderWithProviders(
    <FulfillmentWorkDetailBody
      task={t}
      actions={<section aria-label="actions-slot">actions</section>}
      canStaff
      readOnly={false}
    />,
    { apiClient }
  );
}

/** The card whose heading is `title`, so each case reads one card. */
function card(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const owner = heading.closest('section');
  expect(owner).not.toBeNull();
  return owner as HTMLElement;
}

function factLabels(): (string | null)[] {
  return [...card(COPY.sections.facts).querySelectorAll('dt')].map((node) => node.textContent);
}

describe('FulfillmentWorkDetailBody', () => {
  describe('the cards (#3096)', () => {
    it('should render every left-column section as a detail card when the task loads', () => {
      renderBody(
        task({
          activeHolds: [
            { id: 'hold_1', reason: 'operator', note: null, placedAt: '2026-08-20T09:00:00.000Z' },
          ],
        })
      );

      for (const title of [COPY.sections.holds, COPY.sections.lines, COPY.sections.facts]) {
        expect(card(title)).toHaveClass('detail-card');
      }
      expect(screen.getByTestId('work-detail-hero')).toHaveClass('detail-card', 'detail-card--hero');
    });

    it('should place the caller-composed action card in the left column when given one', () => {
      renderBody(task());

      const main = document.querySelector('.fulfilment-work-detail__main');
      expect(main).not.toBeNull();
      expect(within(main as HTMLElement).getByRole('region', { name: 'actions-slot' })).toBeInTheDocument();
    });
  });

  describe('the hero', () => {
    it('should join both axis labels into the headline when rendered', () => {
      renderBody(task({ status: 'open', requestStatus: 'accepted' }));

      expect(screen.getByText('Open · Accepted')).toHaveClass('fulfilment-work-detail__headline');
    });

    it('should name the in-house executor in the sub-line and the sentence when it resolves', async () => {
      const apiClient = api({
        connections: { getById: vi.fn().mockResolvedValue(connection()) } as never,
      });
      renderBody(task({ assignedConnectionId: 'conn_oms', requestStatus: 'accepted' }), apiClient);

      const hero = screen.getByTestId('work-detail-hero');
      expect(
        await within(hero).findByText('OpenLinker OMS accepted this and has not started picking yet.')
      ).toBeInTheDocument();
      expect(within(hero).getByText(/· OpenLinker OMS/)).toBeInTheDocument();
    });

    it('should call an external executor a partner in the sub-line when it is not the OMS', async () => {
      const apiClient = api({
        connections: {
          getById: vi.fn().mockResolvedValue(
            connection({ id: 'conn_3pl', name: '3PL Warehouse', platformType: 'prestashop' })
          ),
        } as never,
      });
      renderBody(task({ assignedConnectionId: 'conn_3pl' }), apiClient);

      const hero = screen.getByTestId('work-detail-hero');
      expect(
        await within(hero).findByText(new RegExp(`3PL Warehouse · ${COPY.executor.externalPartner}`))
      ).toBeInTheDocument();
    });

    it('should say the task is not routed, and never fire the lookup, when it has no executor', () => {
      const getById = vi.fn();
      renderBody(task({ assignedConnectionId: null }), api({ connections: { getById } as never }));

      expect(
        within(screen.getByTestId('work-detail-hero')).getByText(new RegExp(COPY.executor.unassigned))
      ).toBeInTheDocument();
      expect(getById).not.toHaveBeenCalled();
    });

    it('should keep the sub-line informative when the executor lookup fails', async () => {
      renderBody(
        task({ assignedConnectionId: 'conn_flaky' }),
        api({ connections: { getById: vi.fn().mockRejectedValue(new Error('down')) } as never })
      );

      expect(
        await within(screen.getByTestId('work-detail-hero')).findByText(
          new RegExp(COPY.executor.unavailable)
        )
      ).toBeInTheDocument();
    });

    it('should show the expedited pill beside the headline when the task was moved to the front', () => {
      renderBody(task({ expeditedAt: '2026-08-20T11:00:00.000Z' }));

      const pill = screen.getByTestId('expedited-badge');
      expect(pill.textContent).toContain('Moved to the front');
      expect(pill.closest('.fulfilment-work-detail__hero-row')).not.toBeNull();
    });

    it('should leave the location out of the sub-line on a one-location install', async () => {
      renderBody(task({ locationName: 'Main warehouse' }));

      // Settle the location count first, so the assertion is about the answer.
      await waitFor(() => {
        expect(screen.getByTestId('work-detail-hero').textContent).not.toContain('Main warehouse');
      });
    });

    it('should name the location in the sub-line when the install has several', async () => {
      renderBody(task({ locationName: 'Berlin — 3PL partner' }), api({ activeLocations: 2 }));

      expect(
        await within(screen.getByTestId('work-detail-hero')).findByText(/Berlin — 3PL partner/)
      ).toBeInTheDocument();
    });
  });

  describe("why it's stuck", () => {
    it('should render one compact banner per active hold with its reason, note and start', () => {
      renderBody(
        task({
          activeHolds: [
            {
              id: 'hold_1',
              reason: 'stock-shortfall',
              note: 'Two units short in Warsaw.',
              placedAt: '2026-08-20T09:00:00.000Z',
            },
            { id: 'hold_2', reason: 'address-invalid', note: null, placedAt: '2026-08-20T09:30:00.000Z' },
          ],
        })
      );

      const holds = card(COPY.sections.holds);
      expect(within(holds).getByText('Stock shortfall')).toBeInTheDocument();
      expect(within(holds).getByText('Address invalid')).toBeInTheDocument();
      expect(within(holds).getByText('Two units short in Warsaw.')).toBeInTheDocument();
      const banners = within(holds).getAllByRole('status');
      expect(banners).toHaveLength(2);
      for (const banner of banners) expect(banner).toHaveClass('alert--compact');
    });

    it('should render the hold reason raw when this build does not recognise it', () => {
      renderBody(
        task({
          activeHolds: [
            { id: 'hold_1', reason: 'reason-from-a-newer-backend', note: null, placedAt: '2026-08-20T09:00:00.000Z' },
          ],
        })
      );

      expect(within(card(COPY.sections.holds)).getByText('reason-from-a-newer-backend')).toBeInTheDocument();
    });

    it('should omit the card, heading included, when nothing holds the task', () => {
      renderBody(task({ status: 'on_hold', activeHolds: [] }));

      expect(screen.queryByRole('heading', { name: COPY.sections.holds })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: COPY.sections.lines })).toBeInTheDocument();
    });
  });

  describe("what's in this task", () => {
    it('should render a product card with name, codes and attributes when the line carries them', () => {
      renderBody(
        task({
          lines: [
            line({
              id: 'line_1',
              productName: 'Phone case',
              sku: 'CASE-1',
              ean: '5901234123457',
              attributes: { Kolor: 'srebrny', Rozmiar: 'L' },
              fulfilledQuantity: 0,
              totalQuantity: 1,
            }),
          ],
        })
      );

      const row = within(card(COPY.sections.lines)).getByRole('listitem');
      expect(within(row).getByText('Phone case')).toBeInTheDocument();
      expect(within(row).getByText('SKU CASE-1 · EAN 5901234123457')).toBeInTheDocument();
      expect(within(row).getByText('Kolor: srebrny · Rozmiar: L')).toBeInTheDocument();
      expect(row.textContent).toContain('0 / 1');
      // The raw id is not shown once the product is known.
      expect(within(row).queryByText('ol_variant_1')).not.toBeInTheDocument();
    });

    it('should fall back to the variant id, muted, when the catalogue has no product', () => {
      renderBody(task({ lines: [line({ productVariantId: 'ol_variant_gone' })] }));

      const code = within(card(COPY.sections.lines)).getByText('ol_variant_gone');
      expect(code).toHaveClass('mono-text', 'text-muted');
    });

    it('should show only the attributes that tell two lines apart when they share some', () => {
      renderBody(
        task({
          lines: [
            line({ id: 'a', productName: 'Tee', attributes: { Size: 'M', Brand: 'Acme' } }),
            line({ id: 'b', productName: 'Tee', attributes: { Size: 'L', Brand: 'Acme' } }),
          ],
        })
      );

      const lines = card(COPY.sections.lines);
      expect(within(lines).getByText('Size: M')).toBeInTheDocument();
      expect(within(lines).getByText('Size: L')).toBeInTheDocument();
      expect(within(lines).queryByText(/Brand/)).not.toBeInTheDocument();
    });

    it('should fetch the line picture with the session token when the line has an image path', async () => {
      const requestBlob = vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
      renderBody(
        task({ lines: [line({ productName: 'Case', imageUrl: '/products/p1/images/0' })] }),
        api({ requestBlob } as Partial<ApiClient>)
      );

      await waitFor(() => {
        expect(requestBlob).toHaveBeenCalledWith('/products/p1/images/0');
      });
    });

    it('should append the cancelled count only when it is non-zero', () => {
      renderBody(
        task({
          lines: [
            line({ id: 'line_1', productVariantId: 'ol_variant_a', cancelledQuantity: 2 }),
            line({ id: 'line_2', productVariantId: 'ol_variant_b', cancelledQuantity: 0 }),
          ],
        })
      );

      const rows = within(card(COPY.sections.lines)).getAllByRole('listitem');
      expect(rows[0].textContent).toContain(COPY.lines.cancelledSuffix(2));
      expect(rows[1].textContent).not.toContain('cancelled');
    });

    it('should mark a complete line with a tick assistive technology never reads', () => {
      renderBody(
        task({
          lines: [
            line({ id: 'line_1', totalQuantity: 4, fulfilledQuantity: 4 }),
            line({ id: 'line_2', totalQuantity: 4, fulfilledQuantity: 1 }),
          ],
        })
      );

      const ticks = card(COPY.sections.lines).querySelectorAll('.fulfilment-work-detail__line-done');
      expect(ticks).toHaveLength(1);
      expect(ticks[0].getAttribute('aria-hidden')).toBe('true');
    });

    it('should state the stale-count caveat once per page when there are several lines', () => {
      renderBody(task({ lines: [line({ id: 'line_1' }), line({ id: 'line_2' })] }));

      expect(screen.getAllByText(COPY.lines.caveat)).toHaveLength(1);
    });

    it('should say the task covers no lines, and drop the caveat, when there are none', () => {
      renderBody(task({ lines: [] }));

      expect(within(card(COPY.sections.lines)).getByText(COPY.lines.empty)).toBeInTheDocument();
      expect(screen.queryByText(COPY.lines.caveat)).not.toBeInTheDocument();
    });
  });

  describe('details', () => {
    it('should render the mockup facts in order when the task carries them', () => {
      renderBody(task({ carrierName: 'InPost Paczkomat', externalWorkId: 'wh-88231' }));

      expect(factLabels()).toEqual([
        COPY.facts.state,
        COPY.facts.handshake,
        COPY.facts.delivery,
        COPY.facts.externalReference,
        COPY.facts.started,
      ]);
      const facts = card(COPY.sections.facts);
      expect(within(facts).getByText('InPost Paczkomat')).toBeInTheDocument();
      expect(within(facts).getByText('wh-88231')).toBeInTheDocument();
    });

    it('should never print the raw delivery-method id when no carrier name is known', () => {
      renderBody(task({ carrierName: null }));

      expect(factLabels()).not.toContain(COPY.facts.delivery);
      expect(screen.queryByText('2488f7b7-5d1c-4d65-b85c-4cbcf253fd93')).not.toBeInTheDocument();
    });

    it('should fall back to the order delivery-method name when the task names no carrier', async () => {
      const apiClient = api({
        orders: { getById: vi.fn().mockResolvedValue(order({ sourceDeliveryMethodName: 'Allegro One Box' })) } as never,
      });
      renderBody(task({ carrierName: null }), apiClient);

      expect(await within(card(COPY.sections.facts)).findByText('Allegro One Box')).toBeInTheDocument();
    });

    it('should leave out the Location fact on a one-location install', async () => {
      renderBody(task());

      await waitFor(() => {
        expect(factLabels()).not.toContain(COPY.facts.location);
      });
    });

    it('should show the Location fact by name when the install has several locations', async () => {
      renderBody(task({ locationName: 'Berlin — 3PL partner' }), api({ activeLocations: 3 }));

      expect(await within(card(COPY.sections.facts)).findByText('Berlin — 3PL partner')).toBeInTheDocument();
      expect(factLabels()).toContain(COPY.facts.location);
    });

    it('should render Started as a machine-readable time', () => {
      renderBody(task({ createdAt: '2026-08-20T10:00:00.000Z' }));

      const started = card(COPY.sections.facts).querySelector('time');
      expect(started?.getAttribute('datetime')).toBe('2026-08-20T10:00:00.000Z');
    });

    describe('what the bench did (G02-3)', () => {
      it('should leave the bench rows out entirely when the API predates them', () => {
        renderBody(task({ parcelClosedAt: undefined }));

        expect(factLabels()).not.toContain(COPY.facts.parcel);
        expect(factLabels()).not.toContain(COPY.facts.parcelClosed);
      });

      it('should say the parcel is still open, and not mention the channel, before it is closed', () => {
        renderBody(task({ parcelClosedAt: null, channelNotifiedAt: null }));

        expect(within(card(COPY.sections.facts)).getByText(COPY.facts.parcelOpen)).toBeInTheDocument();
        expect(factLabels()).not.toContain(COPY.facts.channelNotified);
      });

      it('should show when the parcel closed and when the channel was told once both happened', () => {
        renderBody(
          task({ parcelClosedAt: '2026-08-21T08:00:00.000Z', channelNotifiedAt: '2026-08-21T08:05:00.000Z' })
        );

        const facts = card(COPY.sections.facts);
        const times = [...facts.querySelectorAll('time')].map((node) => node.getAttribute('datetime'));
        expect(times).toContain('2026-08-21T08:00:00.000Z');
        expect(times).toContain('2026-08-21T08:05:00.000Z');
        expect(factLabels()).toEqual(expect.arrayContaining([COPY.facts.parcelClosed, COPY.facts.channelNotified]));
      });

      it('should warn, without alarm, when a closed parcel has not been settled with the channel', () => {
        renderBody(task({ parcelClosedAt: '2026-08-21T08:00:00.000Z', channelNotifiedAt: null }));

        expect(
          within(card(COPY.sections.facts)).getByText(COPY.facts.channelNotYet)
        ).toHaveClass('fulfilment-work-detail__fact-warning');
      });

      it('should show the completion instant when the parcel was declared finished', () => {
        renderBody(task({ completedAt: '2026-08-21T09:00:00.000Z' }));

        expect(factLabels()).toContain(COPY.facts.completed);
      });
    });
  });

  describe('the right column', () => {
    it('should put the Packer card first in the rail', () => {
      renderBody(task());

      const rail = document.querySelector('.fulfilment-work-detail__rail') as HTMLElement;
      const firstCard = rail.querySelector('.detail-card');
      expect(firstCard).toBe(card(COPY.sections.packer));
    });

    it('should render the order totals and the source channel in the Payment card when the order loads', async () => {
      const apiClient = api({
        orders: { getById: vi.fn().mockResolvedValue(order()) } as never,
        connections: {
          getById: vi.fn().mockResolvedValue(
            connection({ id: 'conn_shop', name: 'My PrestaShop Store', platformType: 'prestashop' })
          ),
        } as never,
      });
      renderBody(task(), apiClient);

      const payment = await screen.findByRole('region', { name: COPY.sections.payment });
      expect(within(payment).getByText(/28[.,]92/)).toBeInTheDocument();
      expect(await within(payment).findByText('My PrestaShop Store')).toBeInTheDocument();
      // The bespoke "is it paid?" disclaimer is gone with the bespoke section.
      expect(screen.queryByText(/collected on delivery/i)).not.toBeInTheDocument();
    });

    it('should keep the order page anchors so a #shipment deep link lands here too', async () => {
      renderBody(task(), api({ orders: { getById: vi.fn().mockResolvedValue(order()) } as never }));

      await screen.findByRole('region', { name: COPY.sections.payment });
      expect(document.getElementById('shipment')).not.toBeNull();
      expect(document.getElementById('invoicing')).not.toBeNull();
    });

    it('should say the order modules are unavailable, with a retry, when the order read fails', async () => {
      const getById = vi.fn().mockRejectedValue(new ApiError('boom', 500, null));
      renderBody(task(), api({ orders: { getById } as never }));

      expect(await screen.findByText(COPY.order.unavailable)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: COPY.order.retry })).toBeInTheDocument();
    });
  });
});
