/**
 * Fulfillment Dispatch Relay Service — unit tests (#2401)
 *
 * The release-predicate cases are the point of this file. The realistic relay
 * failure is a `rejected` TARGET, not a thrown error — `writeToTarget` catches
 * every adapter throw — so a spec that only mocked a throw would be a check that
 * cannot fail against the AC it was written for.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import type { IFulfillmentRelayGateService } from '@openlinker/core/fulfillment';

import type { IOrderLifecycleRelayService } from '../../interfaces/order-lifecycle-relay.service.interface';
import {
  FULFILLMENT_DISPATCH_RELAY_ORIGIN,
  FulfillmentDispatchRelayService,
} from '../fulfillment-dispatch-relay.service';

const intent = { kind: 'dispatch', workId: 'ol_fulfillmentwork_1' } as const;

describe('FulfillmentDispatchRelayService', () => {
  let gate: jest.Mocked<IFulfillmentRelayGateService>;
  let relay: jest.Mocked<IOrderLifecycleRelayService>;
  let service: FulfillmentDispatchRelayService;

  beforeEach(() => {
    gate = {
      claimDispatch: jest.fn(),
      releaseDispatch: jest.fn(),
    } as unknown as jest.Mocked<IFulfillmentRelayGateService>;
    relay = { relay: jest.fn() } as unknown as jest.Mocked<IOrderLifecycleRelayService>;
    service = new FulfillmentDispatchRelayService(gate, relay);

    gate.claimDispatch.mockResolvedValue({
      status: 'claimed',
      orderId: 'ol_order_1',
      holderConnectionId: 'threepl-conn',
    });
  });

  it('relays once with the holder as the excluded author and a non-participant origin', async () => {
    relay.relay.mockResolvedValue({ targets: [{ connectionId: 'ps-conn', outcome: 'applied' }] });

    await expect(service.relayDispatch(intent)).resolves.toEqual({ status: 'relayed' });

    expect(relay.relay).toHaveBeenCalledWith({
      internalOrderId: 'ol_order_1',
      originConnectionId: FULFILLMENT_DISPATCH_RELAY_ORIGIN,
      authoredByConnectionId: 'threepl-conn',
      event: { type: 'dispatched' },
    });
    expect(gate.releaseDispatch).not.toHaveBeenCalled();
  });

  it('releases the claim when every target REJECTED — the failure production actually produces', async () => {
    relay.relay.mockResolvedValue({
      targets: [{ connectionId: 'allegro-conn', outcome: 'rejected', detail: 'HTTP 500' }],
    });

    const result = await service.relayDispatch(intent);

    expect(result.status).toBe('released');
    expect(gate.releaseDispatch).toHaveBeenCalledWith('ol_fulfillmentwork_1');
  });

  it('releases the claim when every target is the TRANSIENT adapter-unresolved', async () => {
    relay.relay.mockResolvedValue({
      targets: [
        {
          connectionId: 'allegro-conn',
          outcome: 'unsupported',
          unsupportedReason: 'adapter-unresolved',
        },
      ],
    });

    expect((await service.relayDispatch(intent)).status).toBe('released');
    expect(gate.releaseDispatch).toHaveBeenCalled();
  });

  it('KEEPS the claim for a structural no-capability — there is nothing to retry', async () => {
    relay.relay.mockResolvedValue({
      targets: [
        { connectionId: 'ps-conn', outcome: 'unsupported', unsupportedReason: 'no-capability' },
      ],
    });

    await expect(service.relayDispatch(intent)).resolves.toEqual({ status: 'relayed' });
    expect(gate.releaseDispatch).not.toHaveBeenCalled();
  });

  it('KEEPS the claim for a BARE unsupported with no reason — the common adapter default arm', async () => {
    // `unsupportedReason` is populated by the RELAY, not the adapter, and
    // `writeToTarget` passes an adapter's own result through verbatim — so a
    // reasonless `unsupported` is what Allegro/Erli/WooCommerce/PrestaShop
    // actually emit from their own `default:` arms. Treated as structural: when
    // the reason is unknowable, not re-driving a non-idempotent POST is the safe
    // direction. Asserted so the arm is a DECISION, not a fall-through.
    relay.relay.mockResolvedValue({
      targets: [{ connectionId: 'allegro-conn', outcome: 'unsupported' }],
    });

    await expect(service.relayDispatch(intent)).resolves.toEqual({ status: 'relayed' });
    expect(gate.releaseDispatch).not.toHaveBeenCalled();
  });

  it('KEEPS the claim on a mixed result — releasing would re-relay the target that applied', async () => {
    relay.relay.mockResolvedValue({
      targets: [
        { connectionId: 'ps-conn', outcome: 'applied' },
        { connectionId: 'allegro-conn', outcome: 'rejected' },
      ],
    });

    await expect(service.relayDispatch(intent)).resolves.toEqual({ status: 'relayed' });
    expect(gate.releaseDispatch).not.toHaveBeenCalled();
  });

  it('KEEPS the claim when there were no targets at all', async () => {
    // Routine under author-exclusion: a single-participant order whose only
    // participant IS the holder. `[].every(...)` is vacuously true, so an
    // unguarded predicate would release and re-claim forever.
    relay.relay.mockResolvedValue({ targets: [] });

    await expect(service.relayDispatch(intent)).resolves.toEqual({ status: 'relayed' });
    expect(gate.releaseDispatch).not.toHaveBeenCalled();
  });

  it('releases the claim when the relay throws', async () => {
    relay.relay.mockRejectedValue(new Error('identifier mapping unavailable'));

    expect((await service.relayDispatch(intent)).status).toBe('released');
    expect(gate.releaseDispatch).toHaveBeenCalled();
  });

  it('fires no relay when a peer already holds the claim', async () => {
    gate.claimDispatch.mockResolvedValue({ status: 'already-relayed' });

    await expect(service.relayDispatch(intent)).resolves.toEqual({ status: 'already-relayed' });
    expect(relay.relay).not.toHaveBeenCalled();
    expect(gate.releaseDispatch).not.toHaveBeenCalled();
  });

  it('fires no relay for an unknown work row', async () => {
    gate.claimDispatch.mockResolvedValue({ status: 'unknown-work', workId: 'nope' });

    await expect(service.relayDispatch({ kind: 'dispatch', workId: 'nope' })).resolves.toEqual({
      status: 'unknown-work',
      workId: 'nope',
    });
    expect(relay.relay).not.toHaveBeenCalled();
  });

  it('relays with no author exclusion when the work carries no holder', async () => {
    gate.claimDispatch.mockResolvedValue({
      status: 'claimed',
      orderId: 'ol_order_1',
      holderConnectionId: null,
    });
    relay.relay.mockResolvedValue({ targets: [{ connectionId: 'ps-conn', outcome: 'applied' }] });

    await service.relayDispatch(intent);

    expect(relay.relay).toHaveBeenCalledWith(
      expect.objectContaining({ authoredByConnectionId: undefined })
    );
  });
});
