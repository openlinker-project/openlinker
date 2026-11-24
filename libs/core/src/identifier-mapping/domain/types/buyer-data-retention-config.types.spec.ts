import {
  findBuyerDataRetentionConfigIssue,
  readBuyerDataRetentionConfig,
  resolveEffectiveBuyerDataRule,
} from './buyer-data-retention-config.types';

const GLOBAL = {
  enabled: true,
  hideAfterDays: 365,
  eraseAfterDays: 730,
  mode: 'personal-data' as const,
};

describe('buyer data retention config', () => {
  it('should inherit everything when the key is absent, null or malformed', () => {
    for (const config of [
      undefined,
      {},
      { buyerDataRetention: null },
      { buyerDataRetention: 'x' },
    ]) {
      expect(resolveEffectiveBuyerDataRule(GLOBAL, readBuyerDataRetentionConfig(config))).toEqual(
        GLOBAL
      );
    }
  });

  it('should let a connection override only the fields it names', () => {
    const rule = resolveEffectiveBuyerDataRule(
      GLOBAL,
      readBuyerDataRetentionConfig({
        buyerDataRetention: { eraseAfterDays: 0, mode: 'whole-order' },
      })
    );
    expect(rule).toEqual({
      enabled: true,
      hideAfterDays: 365,
      eraseAfterDays: 0,
      mode: 'whole-order',
    });
  });

  it('should inherit the global switch when an override carries only periods and mode', () => {
    const on = resolveEffectiveBuyerDataRule(
      GLOBAL,
      readBuyerDataRetentionConfig({
        buyerDataRetention: { hideAfterDays: 90, mode: 'personal-data' },
      })
    );
    expect(on.enabled).toBe(true);
    const off = resolveEffectiveBuyerDataRule(
      { ...GLOBAL, enabled: false },
      readBuyerDataRetentionConfig({ buyerDataRetention: { hideAfterDays: 90 } })
    );
    expect(off.enabled).toBe(false);
  });

  it('should keep a stored explicit enabled:false off while the global switch is on', () => {
    expect(
      resolveEffectiveBuyerDataRule(
        GLOBAL,
        readBuyerDataRetentionConfig({ buyerDataRetention: { enabled: false, hideAfterDays: 90 } })
      ).enabled
    ).toBe(false);
  });

  it('should ignore an unusable stored period when reading', () => {
    expect(readBuyerDataRetentionConfig({ buyerDataRetention: { hideAfterDays: 7 } })).toEqual({});
  });

  it('should refuse bad shapes on write with the offending field', () => {
    expect(
      findBuyerDataRetentionConfigIssue({ buyerDataRetention: { hideAfterDays: 10 } })?.field
    ).toBe('config.buyerDataRetention.hideAfterDays');
    expect(findBuyerDataRetentionConfigIssue({ buyerDataRetention: { mode: 'x' } })?.rule).toBe(
      'one-of'
    );
    expect(
      findBuyerDataRetentionConfigIssue({
        buyerDataRetention: { hideAfterDays: 400, eraseAfterDays: 100 },
      })?.field
    ).toBe('config.buyerDataRetention.eraseAfterDays');
    expect(
      findBuyerDataRetentionConfigIssue({
        buyerDataRetention: { enabled: true, hideAfterDays: 0, eraseAfterDays: 90 },
      })
    ).toBeNull();
    expect(findBuyerDataRetentionConfigIssue({})).toBeNull();
  });
});
