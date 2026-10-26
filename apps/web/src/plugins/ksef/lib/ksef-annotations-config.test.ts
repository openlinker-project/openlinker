/**
 * KSeF annotation defaults and cross-border switch - config round-trip
 * (DEF-18 / DEF-20 / DEF-22)
 */
import { describe, expect, it } from 'vitest';
import { applyKsefAnnotationsToConfig, readKsefAnnotations } from './ksef-annotations-config';

describe('applyKsefAnnotationsToConfig', () => {
  it('should write allowCrossBorder as a real boolean and remove it when cleared', () => {
    const on = applyKsefAnnotationsToConfig({ env: 'test' }, { ksefAllowCrossBorder: 'true' });
    expect(on.allowCrossBorder).toBe(true);

    const off = applyKsefAnnotationsToConfig(on, { ksefAllowCrossBorder: '' });
    expect('allowCrossBorder' in off).toBe(false);
  });

  it('should keep a half-typed exemption basis instead of dropping it', () => {
    const next = applyKsefAnnotationsToConfig({}, { annExemptionKind: 'statute' });

    expect(next.annotationsDefault).toEqual({ exemptionBasis: { kind: 'statute' } });
  });

  it('should touch only the leaf the patch names', () => {
    const start = { annotationsDefault: { cashAccounting: true, marginKind: 'used-goods' } };

    const next = applyKsefAnnotationsToConfig(start, { annSelfBilling: 'true' });

    expect(next.annotationsDefault).toEqual({
      cashAccounting: true,
      marginKind: 'used-goods',
      selfBilling: true,
    });
  });

  it('should drop an emptied annotationsDefault object entirely', () => {
    const next = applyKsefAnnotationsToConfig(
      { annotationsDefault: { cashAccounting: true } },
      { annCashAccounting: '' },
    );

    expect('annotationsDefault' in next).toBe(false);
  });

  it('should round-trip through the form values', () => {
    const config = applyKsefAnnotationsToConfig(
      {},
      {
        annMarginScheme: 'true',
        annMarginKind: 'works-of-art',
        annExemptionKind: 'directive',
        annExemptionText: 'art. 132 dyrektywy',
      },
    );

    expect(readKsefAnnotations(config)).toMatchObject({
      annMarginScheme: 'true',
      annMarginKind: 'works-of-art',
      annExemptionKind: 'directive',
      annExemptionText: 'art. 132 dyrektywy',
      ksefAllowCrossBorder: '',
    });
  });
});
