/**
 * Fulfillment Relay Gate Service — unit tests (#2401)
 *
 * @module libs/core/src/fulfillment/application/services/__tests__
 */
import type { FulfillmentWorkRepositoryPort } from '../../../domain/ports/fulfillment-work-repository.port';
import type { FulfillmentWork } from '../../../domain/types/fulfillment-work.types';
import { FulfillmentRelayGateService } from '../fulfillment-relay-gate.service';

const work = (over: Partial<FulfillmentWork> = {}): FulfillmentWork =>
  ({
    id: 'ol_fulfillmentwork_1',
    orderId: 'ol_order_1',
    assignedConnectionId: 'threepl-conn',
    dispatchRelayedAt: null,
    ...over,
  }) as FulfillmentWork;

describe('FulfillmentRelayGateService', () => {
  let repository: jest.Mocked<FulfillmentWorkRepositoryPort>;
  let service: FulfillmentRelayGateService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      claimDispatchRelay: jest.fn(),
      releaseDispatchRelay: jest.fn(),
    } as unknown as jest.Mocked<FulfillmentWorkRepositoryPort>;
    service = new FulfillmentRelayGateService(repository);
  });

  it('projects the order and holder when it wins the claim', async () => {
    repository.findById.mockResolvedValue(work());
    repository.claimDispatchRelay.mockResolvedValue(true);

    await expect(service.claimDispatch('ol_fulfillmentwork_1')).resolves.toEqual({
      status: 'claimed',
      orderId: 'ol_order_1',
      holderConnectionId: 'threepl-conn',
    });
  });

  it('reports already-relayed when a peer won the conditional UPDATE', async () => {
    repository.findById.mockResolvedValue(work());
    repository.claimDispatchRelay.mockResolvedValue(false);

    await expect(service.claimDispatch('ol_fulfillmentwork_1')).resolves.toEqual({
      status: 'already-relayed',
    });
  });

  it('never touches the claim for an unknown work id', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.claimDispatch('nope')).resolves.toEqual({
      status: 'unknown-work',
      workId: 'nope',
    });
    // Read-before-claim: an unknown id must not reach the claim at all.
    expect(repository.claimDispatchRelay).not.toHaveBeenCalled();
  });

  it('claims work with no holder and reports a null author rather than inventing one', async () => {
    repository.findById.mockResolvedValue(work({ assignedConnectionId: null }));
    repository.claimDispatchRelay.mockResolvedValue(true);

    await expect(service.claimDispatch('ol_fulfillmentwork_1')).resolves.toEqual({
      status: 'claimed',
      orderId: 'ol_order_1',
      holderConnectionId: null,
    });
  });

  it('delegates release to the repository', async () => {
    await service.releaseDispatch('ol_fulfillmentwork_1');
    expect(repository.releaseDispatchRelay).toHaveBeenCalledWith('ol_fulfillmentwork_1');
  });
});
