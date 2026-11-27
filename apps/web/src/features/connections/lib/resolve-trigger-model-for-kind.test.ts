import { describe, expect, it } from 'vitest';
import {
  resolveTriggerModelForKind,
  writeTriggerModelForKind,
} from './resolve-trigger-model-for-kind';

/**
 * The same case table as core's
 * `libs/core/src/invoicing/domain/types/invoice-trigger.types.spec.ts`
 * (`resolveTriggerModelForKind`). Change both together.
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

describe('writeTriggerModelForKind', () => {
  it('should set one kind and keep the other kind, documentKind and the legacy key', () => {
    const out = writeTriggerModelForKind(
      {
        invoicing: { triggerModel: 'manual' },
        salesDocument: { documentKind: 'both', triggerModels: { 'fiscal-receipt': 'auto-on-paid' } },
        rateLimit: { maxConcurrent: 2 },
      },
      'invoice',
      'batched',
    );

    expect(out).toEqual({
      invoicing: { triggerModel: 'manual' },
      salesDocument: {
        documentKind: 'both',
        triggerModels: { 'fiscal-receipt': 'auto-on-paid', invoice: 'batched' },
      },
      rateLimit: { maxConcurrent: 2 },
    });
  });

  it('should drop the kind entry and the emptied objects when cleared', () => {
    expect(
      writeTriggerModelForKind({ salesDocument: { triggerModels: { invoice: 'manual' } } }, 'invoice', ''),
    ).toEqual({});
  });

  it('should keep documentKind when clearing the last trigger entry', () => {
    expect(
      writeTriggerModelForKind(
        { salesDocument: { documentKind: 'invoice', triggerModels: { invoice: 'manual' } } },
        'invoice',
        '',
      ),
    ).toEqual({ salesDocument: { documentKind: 'invoice' } });
  });
});
