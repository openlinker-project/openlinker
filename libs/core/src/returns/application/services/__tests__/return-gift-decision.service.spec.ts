import { ReturnGiftDecisionInvalidError } from '../../../domain/exceptions/return-gift-decision-invalid.error';
import { ReturnNotFoundError } from '../../../domain/exceptions/return-not-found.error';
import type { ReturnGiftDecisionRepositoryPort } from '../../../domain/ports/return-gift-decision-repository.port';
import type { ReturnRepositoryPort } from '../../../domain/ports/return-repository.port';
import { ReturnGiftDecisionService } from '../return-gift-decision.service';
import type { IReturnsService } from '../returns.service.interface';

function build(): {
  service: ReturnGiftDecisionService;
  decisions: jest.Mocked<ReturnGiftDecisionRepositoryPort>;
  returns: { findById: jest.Mock };
  returnsService: { assertAttributedForTrigger: jest.Mock };
} {
  const decisions: jest.Mocked<ReturnGiftDecisionRepositoryPort> = {
    findByReturnId: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockImplementation((input) => Promise.resolve({ id: 'd1', ...input })),
  };
  const returns = { findById: jest.fn().mockResolvedValue({ id: 'r1' }) };
  const returnsService = { assertAttributedForTrigger: jest.fn().mockResolvedValue({}) };
  const service = new ReturnGiftDecisionService(
    decisions,
    returns as unknown as ReturnRepositoryPort,
    returnsService as unknown as IReturnsService
  );
  return { service, decisions, returns, returnsService };
}

describe('ReturnGiftDecisionService', () => {
  it('should record keep without touching any amount', async () => {
    const { service, decisions, returnsService } = build();
    await service.decide({ returnId: 'r1', giftLineId: 'g1', decision: 'keep', actorUserId: 'u1', validGiftLineIds: ['g1'] });
    expect(returnsService.assertAttributedForTrigger).toHaveBeenCalledWith('r1', 'refund');
    expect(decisions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'keep' }),
      expect.any(Date)
    );
  });

  it('should refuse a deduction without a positive amount', async () => {
    const { service, decisions } = build();
    await expect(
      service.decide({ returnId: 'r1', giftLineId: 'g1', decision: 'deduct', actorUserId: null, validGiftLineIds: ['g1'] })
    ).rejects.toMatchObject({ reason: 'deduction-required' });
    await expect(
      service.decide({
        returnId: 'r1',
        giftLineId: 'g1',
        decision: 'deduct',
        deductionGross: 0,
        actorUserId: null,
        validGiftLineIds: ['g1'],
      })
    ).rejects.toBeInstanceOf(ReturnGiftDecisionInvalidError);
    expect(decisions.upsert).not.toHaveBeenCalled();
  });

  it('should refuse an amount on a decision that takes nothing off the refund', async () => {
    const { service } = build();
    await expect(
      service.decide({
        returnId: 'r1',
        giftLineId: 'g1',
        decision: 'ask_back',
        deductionGross: 5,
        actorUserId: null,
        validGiftLineIds: ['g1'],
      })
    ).rejects.toMatchObject({ reason: 'deduction-not-allowed' });
  });

  it('should not record a decision for an orphan return', async () => {
    const { service, decisions, returnsService } = build();
    returnsService.assertAttributedForTrigger.mockRejectedValue(new Error('not attributed'));
    await expect(
      service.decide({ returnId: 'r1', giftLineId: 'g1', decision: 'keep', actorUserId: null, validGiftLineIds: ['g1'] })
    ).rejects.toThrow('not attributed');
    expect(decisions.upsert).not.toHaveBeenCalled();
  });

  it('should refuse a decision about a line that is not a gift on the return\'s order', async () => {
    const { service, decisions } = build();
    await expect(
      service.decide({
        returnId: 'r1',
        giftLineId: 'other-orders-line',
        decision: 'keep',
        actorUserId: null,
        validGiftLineIds: ['g1'],
      })
    ).rejects.toMatchObject({ reason: 'unknown-gift-line' });
    expect(decisions.upsert).not.toHaveBeenCalled();
  });

  it('should refuse to list the decisions of an unknown return', async () => {
    const { service, returns } = build();
    returns.findById.mockResolvedValue(null);
    await expect(service.list('nope')).rejects.toBeInstanceOf(ReturnNotFoundError);
  });
});
