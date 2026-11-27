import type { RoutingEvaluation } from '@openlinker/core/fulfillment';

import { diffRoutingEvaluations } from './diff-routing-evaluations';

const assign = (
  orderLineId: string,
  locationId: string | null,
  quantity: number
): RoutingEvaluation['candidates'][number] => ({
  orderLineId,
  locationId,
  connectionId: 'conn-oms',
  deliveryMethod: null,
  quantity,
});

const evaluation = (
  candidates: RoutingEvaluation['candidates'],
  unfulfillable: RoutingEvaluation['unfulfillable'] = []
): RoutingEvaluation => ({ candidates, unfulfillable, explanation: [] });

describe('diffRoutingEvaluations', () => {
  it('should report nothing when both rulesets place every line identically', () => {
    const same = evaluation([assign('l1', 'loc-a', 2), assign('l2', 'loc-b', 1)]);

    expect(diffRoutingEvaluations(same, same)).toEqual([]);
  });

  it('should name only the lines that moved to another location', () => {
    const saved = evaluation([assign('l1', 'loc-a', 2), assign('l2', 'loc-a', 1)]);
    const draft = evaluation([assign('l1', 'loc-b', 2), assign('l2', 'loc-a', 1)]);

    expect(diffRoutingEvaluations(saved, draft)).toEqual([
      { orderLineId: 'l1', saved: ['loc-a:2'], draft: ['loc-b:2'] },
    ]);
  });

  it('should not treat a different assignment order as a change', () => {
    const saved = evaluation([assign('l1', 'loc-a', 1), assign('l1', 'loc-b', 1)]);
    const draft = evaluation([assign('l1', 'loc-b', 1), assign('l1', 'loc-a', 1)]);

    expect(diffRoutingEvaluations(saved, draft)).toEqual([]);
  });

  it('should report a line that became unfulfillable', () => {
    const saved = evaluation([assign('l1', 'loc-a', 2)]);
    const draft = evaluation(
      [],
      [{ orderLineId: 'l1', quantity: 2, resolution: 'refund', reason: 'x' }]
    );

    expect(diffRoutingEvaluations(saved, draft)).toEqual([
      { orderLineId: 'l1', saved: ['loc-a:2'], draft: ['unfulfillable:2'] },
    ]);
  });

  it('should report a split that changed its quantities', () => {
    const saved = evaluation([assign('l1', 'loc-a', 3), assign('l1', 'loc-b', 1)]);
    const draft = evaluation([assign('l1', 'loc-a', 2), assign('l1', 'loc-b', 2)]);

    expect(diffRoutingEvaluations(saved, draft)).toHaveLength(1);
  });

  it('should be deterministic: lines come back sorted by id', () => {
    const saved = evaluation([assign('b', 'loc-a', 1), assign('a', 'loc-a', 1)]);
    const draft = evaluation([assign('b', 'loc-b', 1), assign('a', 'loc-b', 1)]);

    expect(diffRoutingEvaluations(saved, draft).map((c) => c.orderLineId)).toEqual(['a', 'b']);
  });
});
