/**
 * parseTriggerModel unit tests (OL #1120).
 *
 * @module libs/core/src/invoicing/domain/types
 */
import {
  describeInvalidTriggerModels,
  parseTriggerModel,
  InvoiceTriggerModelValues,
  resolveTriggerModelForKind,
} from './invoice-trigger.types';

/**
 * #3582 - one case table, mirrored verbatim by the web resolver's test
 * (`apps/web/src/features/connections/lib/resolve-trigger-model-for-kind.test.ts`).
 * Change both together.
 */
describe('resolveTriggerModelForKind', () => {
  it.each([
    ['nothing set', {}, 'invoice', 'manual', 'default'],
    ['config not an object', 'oops', 'invoice', 'manual', 'default'],
    ['legacy only, invoice', { invoicing: { triggerModel: 'auto-on-paid' } }, 'invoice', 'auto-on-paid', 'legacy'],
    ['legacy only, receipt', { invoicing: { triggerModel: 'auto-on-paid' } }, 'fiscal-receipt', 'auto-on-paid', 'legacy'],
    [
      'kind set, other kind falls back to legacy',
      { invoicing: { triggerModel: 'auto-on-shipped' }, salesDocument: { triggerModels: { invoice: 'batched' } } },
      'fiscal-receipt',
      'auto-on-shipped',
      'legacy',
    ],
    [
      'kind set overrides legacy',
      { invoicing: { triggerModel: 'manual' }, salesDocument: { triggerModels: { invoice: 'batched' } } },
      'invoice',
      'batched',
      'kind',
    ],
    [
      'unrecognised kind value falls back to legacy',
      { invoicing: { triggerModel: 'auto-on-paid' }, salesDocument: { triggerModels: { invoice: 'nope' } } },
      'invoice',
      'auto-on-paid',
      'legacy',
    ],
    [
      'both unrecognised',
      { invoicing: { triggerModel: 'x' }, salesDocument: { triggerModels: { invoice: '' } } },
      'invoice',
      'manual',
      'default',
    ],
    ['triggerModels not an object', { salesDocument: { triggerModels: 'batched' } }, 'invoice', 'manual', 'default'],
    ['salesDocument not an object', { salesDocument: ['x'] }, 'invoice', 'manual', 'default'],
    [
      'open-world kind reads its own key',
      { salesDocument: { triggerModels: { 'simplified-invoice': 'auto-on-paid' } } },
      'simplified-invoice',
      'auto-on-paid',
      'kind',
    ],
  ])('%s', (_label, config, kind, model, source) => {
    expect(resolveTriggerModelForKind(config, kind)).toEqual({ model, source });
  });
});

describe('parseTriggerModel', () => {
  it('returns each known value verbatim (manual / auto-on-paid / auto-on-shipped / batched)', () => {
    for (const value of InvoiceTriggerModelValues) {
      expect(parseTriggerModel(value)).toBe(value);
    }
  });

  it('returns "manual" for undefined / null', () => {
    expect(parseTriggerModel(undefined)).toBe('manual');
    expect(parseTriggerModel(null)).toBe('manual');
  });

  it('returns "manual" for an unrecognized string', () => {
    expect(parseTriggerModel('auto-on-delivered')).toBe('manual');
    expect(parseTriggerModel('')).toBe('manual');
  });

  it('returns "manual" for a non-string value', () => {
    expect(parseTriggerModel(42)).toBe('manual');
    expect(parseTriggerModel({ triggerModel: 'auto-on-paid' })).toBe('manual');
    expect(parseTriggerModel(['auto-on-paid'])).toBe('manual');
  });

  it('exposes the four trigger-model values', () => {
    expect(InvoiceTriggerModelValues).toHaveLength(4);
  });
});

describe('describeInvalidTriggerModels', () => {
  it.each([
    ['no salesDocument key', {}],
    ['no triggerModels', { salesDocument: { documentKind: 'invoice' } }],
    ['a cleared kind', { salesDocument: { triggerModels: { invoice: null } } }],
    [
      'recognised models',
      { salesDocument: { triggerModels: { invoice: 'batched', 'fiscal-receipt': 'auto-on-paid' } } },
    ],
  ])('should accept %s', (_label, config) => {
    expect(describeInvalidTriggerModels(config)).toBeNull();
  });

  it('should refuse an unrecognised model, naming the kind', () => {
    expect(
      describeInvalidTriggerModels({ salesDocument: { triggerModels: { invoice: 'batch' } } }),
    ).toContain('triggerModels.invoice');
  });

  it('should refuse a non-object map', () => {
    expect(
      describeInvalidTriggerModels({ salesDocument: { triggerModels: 'batched' } }),
    ).toContain('must be an object');
  });
});
