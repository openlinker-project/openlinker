import {
  isSourceChangeHoldCause,
  planSourceAmendment,
  sourceChangeAcceptTargetRef,
  type SourceAmendmentPlanInput,
} from './source-amendment-plan.types';

const base = (overrides: Partial<SourceAmendmentPlanInput> = {}): SourceAmendmentPlanInput => ({
  effectiveByLine: { li_1: 2, li_2: 1 },
  requiredByLine: { li_1: 2, li_2: 1 },
  verifiedByLine: {},
  fulfilledByLine: {},
  increasedLineIds: new Set<string>(),
  unrouted: false,
  boxClosed: false,
  shipped: false,
  outsideHolder: false,
  ...overrides,
});

describe('planSourceAmendment', () => {
  it('should plan nothing when the order has no packing work', () => {
    expect(planSourceAmendment(base({ unrouted: true, effectiveByLine: { li_1: 1 } }))).toEqual({
      kind: 'no-work',
    });
  });

  it('should report in-sync when every line matches its work', () => {
    expect(planSourceAmendment(base())).toEqual({ kind: 'in-sync' });
  });

  it('should apply a decrease when nothing has been packed past the new quantity', () => {
    expect(planSourceAmendment(base({ effectiveByLine: { li_1: 1, li_2: 1 } }))).toEqual({
      kind: 'apply',
      lines: [{ orderLineId: 'li_1', from: 2, to: 1 }],
    });
  });

  it('should apply a decrease to zero when the source removed the line', () => {
    expect(planSourceAmendment(base({ effectiveByLine: { li_2: 1 } }))).toEqual({
      kind: 'apply',
      lines: [{ orderLineId: 'li_1', from: 2, to: 0 }],
    });
  });

  it('should apply when the packer verified exactly the new quantity', () => {
    const plan = planSourceAmendment(
      base({ effectiveByLine: { li_1: 1, li_2: 1 }, verifiedByLine: { li_1: 1 } })
    );
    expect(plan.kind).toBe('apply');
  });

  it('should hold with box-holds-more when the box already holds more than the new quantity', () => {
    expect(
      planSourceAmendment(base({ effectiveByLine: { li_1: 1, li_2: 1 }, verifiedByLine: { li_1: 2 } }))
    ).toEqual({ kind: 'hold', cause: 'box-holds-more', lines: [{ orderLineId: 'li_1', from: 2, to: 1 }] });
  });

  it('should hold with box-closed when the box was closed, even with nothing verified above', () => {
    const plan = planSourceAmendment(base({ effectiveByLine: { li_1: 1, li_2: 1 }, boxClosed: true }));
    expect(plan).toMatchObject({ kind: 'hold', cause: 'box-closed' });
  });

  it('should hold with packed-elsewhere when a holder outside OpenLinker has the work', () => {
    const plan = planSourceAmendment(base({ effectiveByLine: { li_1: 1, li_2: 1 }, outsideHolder: true }));
    expect(plan).toMatchObject({ kind: 'hold', cause: 'packed-elsewhere' });
  });

  it('should hold with already-fulfilled when more units were reported fulfilled', () => {
    const plan = planSourceAmendment(
      base({ effectiveByLine: { li_1: 1, li_2: 1 }, fulfilledByLine: { li_1: 2 } })
    );
    expect(plan).toMatchObject({ kind: 'hold', cause: 'already-fulfilled' });
  });

  it('should only report a change after shipping, never hold or apply it', () => {
    expect(
      planSourceAmendment(
        base({ effectiveByLine: { li_1: 1, li_2: 1 }, shipped: true, boxClosed: true, verifiedByLine: { li_1: 2 } })
      )
    ).toEqual({ kind: 'shipped', lines: [{ orderLineId: 'li_1', from: 2, to: 1 }] });
  });

  it('should hold with units-added when the stored amendment raised a line', () => {
    expect(
      planSourceAmendment(
        base({ effectiveByLine: { li_1: 3, li_2: 1 }, increasedLineIds: new Set(['li_1']) })
      )
    ).toEqual({ kind: 'hold', cause: 'units-added', lines: [{ orderLineId: 'li_1', from: 2, to: 3 }] });
  });

  it('should hold with units-added for a line the source added after routing', () => {
    expect(
      planSourceAmendment(
        base({ effectiveByLine: { li_1: 2, li_2: 1, li_3: 1 }, increasedLineIds: new Set(['li_3']) })
      )
    ).toEqual({ kind: 'hold', cause: 'units-added', lines: [{ orderLineId: 'li_3', from: 0, to: 1 }] });
  });

  it('should NOT treat a line routing never put in any work as an increase', () => {
    // An unfulfillable line looks exactly like "the order wants more", so only
    // the stored amendment may make it an increase.
    expect(planSourceAmendment(base({ effectiveByLine: { li_1: 2, li_2: 1, li_3: 4 } }))).toEqual({
      kind: 'in-sync',
    });
  });

  it('should hold the whole change when one line decreases and another increases', () => {
    const plan = planSourceAmendment(
      base({ effectiveByLine: { li_1: 1, li_2: 2 }, increasedLineIds: new Set(['li_2']) })
    );
    expect(plan).toEqual({
      kind: 'hold',
      cause: 'units-added',
      lines: [
        { orderLineId: 'li_1', from: 2, to: 1 },
        { orderLineId: 'li_2', from: 1, to: 2 },
      ],
    });
  });

  it('should report in-sync once the operator edit already lowered the work to the same quantity', () => {
    // Operator lowered 2 -> 1 first (work narrowed to 1); the source then also
    // went 2 -> 1. Nothing is left to do, so no stock is given back twice.
    expect(
      planSourceAmendment(base({ effectiveByLine: { li_1: 1, li_2: 1 }, requiredByLine: { li_1: 1, li_2: 1 } }))
    ).toEqual({ kind: 'in-sync' });
  });
});

describe('sourceChangeAcceptTargetRef', () => {
  it('should be the same for the same mismatch whatever the line order', () => {
    const a = sourceChangeAcceptTargetRef([
      { orderLineId: 'b', from: 1, to: 2 },
      { orderLineId: 'a', from: 2, to: 1 },
    ]);
    const b = sourceChangeAcceptTargetRef([
      { orderLineId: 'a', from: 2, to: 1 },
      { orderLineId: 'b', from: 1, to: 2 },
    ]);
    expect(a).toBe(b);
    expect(a).toBe('source-change:a:2>1,b:1>2');
  });

  it('should differ when the source changes the same line again', () => {
    expect(sourceChangeAcceptTargetRef([{ orderLineId: 'a', from: 2, to: 1 }])).not.toBe(
      sourceChangeAcceptTargetRef([{ orderLineId: 'a', from: 2, to: 0 }])
    );
  });
});

describe('isSourceChangeHoldCause', () => {
  it('should accept a known cause and refuse anything else', () => {
    expect(isSourceChangeHoldCause('box-closed')).toBe(true);
    expect(isSourceChangeHoldCause('shipped')).toBe(false);
    expect(isSourceChangeHoldCause(undefined)).toBe(false);
  });
});
