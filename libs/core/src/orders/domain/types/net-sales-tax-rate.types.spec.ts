import {
  deriveNetLineAmount,
  netSalesEraEligibleSql,
  netSalesLineNetAmountSql,
  netSalesLineNetEligibleConditionSql,
  netSalesOrderNetEligibleSql,
  netSalesRateFractionSql,
  resolveNetSalesTaxRate,
} from './net-sales-tax-rate.types';

describe('resolveNetSalesTaxRate', () => {
  it.each([
    ['23', 0.23],
    ['8', 0.08],
    ['5', 0.05],
    ['0', 0],
  ])('resolves numeric code %s to a known %s fraction', (taxRate, expected) => {
    expect(resolveNetSalesTaxRate(taxRate)).toEqual({ kind: 'known', rateFraction: expected });
  });

  it.each(['zw', 'np', 'oo'])('resolves exempt code %s to a known 0 fraction', (taxRate) => {
    expect(resolveNetSalesTaxRate(taxRate)).toEqual({ kind: 'known', rateFraction: 0 });
  });

  it.each([null, undefined, '', '   '])('resolves %s to unknown', (taxRate) => {
    expect(resolveNetSalesTaxRate(taxRate)).toEqual({ kind: 'unknown' });
  });

  it('resolves fractional notation to unknown rather than guessing', () => {
    expect(resolveNetSalesTaxRate('0.23')).toEqual({ kind: 'unknown' });
  });

  it('resolves an out-of-range percent to unknown', () => {
    expect(resolveNetSalesTaxRate('150')).toEqual({ kind: 'unknown' });
    expect(resolveNetSalesTaxRate('-5')).toEqual({ kind: 'unknown' });
  });

  it('resolves a garbage string to unknown', () => {
    expect(resolveNetSalesTaxRate('not-a-rate')).toEqual({ kind: 'unknown' });
  });
});

describe('netSalesRateFractionSql', () => {
  it('produces a CASE expression referencing the given column', () => {
    const sql = netSalesRateFractionSql('li."taxRate"');
    expect(sql).toContain('li."taxRate" IN (\'zw\',\'np\',\'oo\')');
    expect(sql).toContain('li."taxRate"::numeric / 100');
  });

  it('rejects fractional notation the same way resolveNetSalesTaxRate does (#1985 review)', () => {
    // JS twin: resolveNetSalesTaxRate('0.23') must resolve to 'unknown', never a
    // guessed rate. The SQL twin must exclude the same open interval (0, 1) or
    // the two aggregates disagree on a historical fractional-notation row.
    expect(resolveNetSalesTaxRate('0.23')).toEqual({ kind: 'unknown' });
    const sql = netSalesRateFractionSql('li."taxRate"');
    expect(sql).toContain('NOT (li."taxRate"::numeric > 0 AND li."taxRate"::numeric < 1)');
  });
});

describe('deriveNetLineAmount', () => {
  it('returns unitPrice × quantity when taxTreatment is exclusive', () => {
    expect(deriveNetLineAmount(100, 2, null, 'exclusive')).toBe(200);
    expect(deriveNetLineAmount(100, 2, '23', 'exclusive')).toBe(200);
  });

  it('strips VAT from gross-priced lines when taxTreatment is inclusive', () => {
    expect(deriveNetLineAmount(100, 1, '23', 'inclusive')).toBe(77);
  });

  it('treats absent taxTreatment as gross-priced', () => {
    expect(deriveNetLineAmount(100, 1, '23', null)).toBe(77);
    expect(deriveNetLineAmount(100, 1, '23', undefined)).toBe(77);
  });

  it('returns null when a gross-priced line has an unresolvable tax rate', () => {
    expect(deriveNetLineAmount(100, 1, null, 'inclusive')).toBeNull();
  });
});

describe('netSalesLineNetAmountSql', () => {
  it('branches on taxTreatment before applying the rate fraction', () => {
    const sql = netSalesLineNetAmountSql(
      'li."unitPrice"',
      'li."quantity"',
      'li."taxRate"',
      'rec."taxTreatment"'
    );
    expect(sql).toContain("rec.\"taxTreatment\" = 'exclusive'");
    expect(sql).toContain('li."unitPrice" * li."quantity"');
  });
});

describe('netSalesEraEligibleSql (#2469)', () => {
  it("keeps ADR-063's blanket pre-rollout exclusion when the operator has not opted in", () => {
    expect(netSalesEraEligibleSql(false)).toBe(`rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'`);
  });

  it('makes the era clause vacuous when the operator HAS opted in', () => {
    // Vacuous, not "admit everything": the rate-resolution requirement lives in
    // the sibling clauses of both predicates below, which is what keeps the
    // opt-in equivalent to Phase 4's category-A definition.
    expect(netSalesEraEligibleSql(true)).toBe('TRUE');
  });
});

describe('netSalesOrderNetEligibleSql (#2469)', () => {
  const build = (flag: boolean): string =>
    netSalesOrderNetEligibleSql('rec."internalOrderId"', 'net_li', 'rec."taxTreatment"', flag);

  it('excludes pre-rollout orders outright with the flag OFF', () => {
    const sql = build(false);
    expect(sql).toContain(`rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'`);
  });

  it('drops the era test with the flag ON', () => {
    const sql = build(true);
    expect(sql).not.toContain('taxRateEra');
    expect(sql).toContain('TRUE');
  });

  it('keeps the has-lines and every-line-resolves requirements in BOTH flag states', () => {
    // This is the whole reason the flag can be a vacuous era clause rather than
    // a second predicate: turning it ON must not admit an order whose rate is
    // still unresolved.
    for (const flag of [false, true]) {
      const sql = build(flag);
      expect(sql).toContain('EXISTS (');
      expect(sql).toContain('NOT EXISTS (');
      expect(sql).toContain(`rec."taxTreatment" = 'exclusive'`);
      expect(sql).toContain('IS NULL');
    }
  });

  it('differs between the two flag states ONLY in the era clause', () => {
    const off = build(false).replace(`rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'`, 'TRUE');
    expect(off).toBe(build(true));
  });
});

describe('netSalesLineNetEligibleConditionSql (#2469)', () => {
  const build = (flag: boolean): string =>
    netSalesLineNetEligibleConditionSql('li."taxRate"', 'rec."taxTreatment"', flag);

  it('excludes pre-rollout lines outright with the flag OFF', () => {
    expect(build(false)).toContain(`rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'`);
  });

  it('drops the era test with the flag ON', () => {
    const sql = build(true);
    expect(sql).not.toContain('taxRateEra');
    expect(sql).toContain('TRUE');
  });

  it("keeps the line's own rate-resolution requirement in BOTH flag states", () => {
    for (const flag of [false, true]) {
      const sql = build(flag);
      expect(sql).toContain(`rec."taxTreatment" = 'exclusive'`);
      expect(sql).toContain('IS NOT NULL');
    }
  });

  it('differs between the two flag states ONLY in the era clause', () => {
    const off = build(false).replace(`rec."taxRateEra" IS DISTINCT FROM 'pre-rollout'`, 'TRUE');
    expect(off).toBe(build(true));
  });
});
