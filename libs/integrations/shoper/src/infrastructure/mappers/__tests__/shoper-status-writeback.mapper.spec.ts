import type { ShoperOrderStatusEntry } from '../../../domain/types/shoper-order-status.types';
import { pickShoperWritebackStatus, planShoperStatusWriteback } from '../shoper-status-writeback.mapper';

const status = (statusId: string, type: number, label: string, active?: boolean): ShoperOrderStatusEntry => ({
  statusId,
  type,
  labels: [label],
  ...(active === undefined ? {} : { active }),
});

describe('shoper-status-writeback.mapper', () => {
  describe('pickShoperWritebackStatus', () => {
    const STATUSES = [
      status('1', 1, 'złożone'),
      status('2', 2, 'przyjęte', false),
      status('3', 2, 'w realizacji'),
      status('6', 4, 'zwrócone'),
      status('8', 4, 'odrzucone'),
    ];

    it('should pick the first active in-progress status', () => {
      expect(pickShoperWritebackStatus(STATUSES, 'in-progress')).toBe('3');
    });

    it('should pick the first active not-completed status that is not a refund or a return', () => {
      expect(pickShoperWritebackStatus(STATUSES, 'cancelled')).toBe('8');
    });

    it('should answer null when the shop lists none', () => {
      expect(pickShoperWritebackStatus([status('6', 4, 'zwrócone')], 'cancelled')).toBeNull();
      expect(pickShoperWritebackStatus([status('2', 2, 'przyjęte', false)], 'in-progress')).toBeNull();
    });
  });

  describe('planShoperStatusWriteback', () => {
    it.each([
      [1, 'write'],
      [2, 'write'],
      [3, 'refused'],
      [4, 'already-applied'],
    ])('should plan a cancellation of a type-%i order as %s', (type, kind) => {
      expect(planShoperStatusWriteback({ type, labels: [] }, 'cancelled').kind).toBe(kind);
    });

    it.each([
      [1, 'write'],
      [2, 'already-applied'],
      [3, 'refused'],
      [4, 'refused'],
    ])('should plan an in-progress of a type-%i order as %s', (type, kind) => {
      expect(planShoperStatusWriteback({ type, labels: [] }, 'in-progress').kind).toBe(kind);
    });

    it('should write over a status the shop does not list', () => {
      expect(planShoperStatusWriteback(null, 'cancelled')).toEqual({ kind: 'write' });
      expect(planShoperStatusWriteback(null, 'in-progress')).toEqual({ kind: 'write' });
    });
  });
});
