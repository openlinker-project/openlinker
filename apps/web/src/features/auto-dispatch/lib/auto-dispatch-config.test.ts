/**
 * Automatic shipping labels - config read and write (#2729)
 */
import { describe, expect, it } from 'vitest';

import {
  hasUnrecognisedTrigger,
  readAutoDispatchForm,
  toPreviewRequest,
  withAutoDispatch,
} from './auto-dispatch-config';

describe('readAutoDispatchForm', () => {
  it('should read off, on-accept and empty inputs when nothing is stored', () => {
    expect(readAutoDispatchForm(undefined)).toEqual({
      enabled: false,
      trigger: 'on-accept',
      defaultWeightGrams: '',
      parcelTemplate: '',
      lengthMm: '',
      widthMm: '',
      heightMm: '',
    });
    expect(readAutoDispatchForm({ autoDispatch: 'yes' })).toMatchObject({ enabled: false });
  });

  it('should show every stored value', () => {
    expect(
      readAutoDispatchForm({
        autoDispatch: {
          enabled: true,
          trigger: 'on-parcel-closed',
          defaultWeightGrams: 300,
          parcelTemplate: 'small',
          lengthMm: 300,
          widthMm: 200,
          heightMm: 100,
        },
      })
    ).toEqual({
      enabled: true,
      trigger: 'on-parcel-closed',
      defaultWeightGrams: '300',
      parcelTemplate: 'small',
      lengthMm: '300',
      widthMm: '200',
      heightMm: '100',
    });
  });

  it('should read an unrecognised trigger as on-accept, and say so separately', () => {
    const config = { autoDispatch: { enabled: true, trigger: 'on-close' } };

    expect(readAutoDispatchForm(config).trigger).toBe('on-accept');
    expect(hasUnrecognisedTrigger(config)).toBe(true);
    expect(hasUnrecognisedTrigger({ autoDispatch: { enabled: true } })).toBe(false);
    expect(hasUnrecognisedTrigger({ autoDispatch: { trigger: 'on-accept' } })).toBe(false);
  });

  it('should not show a non-positive weight as a value', () => {
    expect(readAutoDispatchForm({ autoDispatch: { defaultWeightGrams: 0 } }).defaultWeightGrams).toBe('');
    expect(readAutoDispatchForm({ autoDispatch: { defaultWeightGrams: '250' } }).defaultWeightGrams).toBe('');
  });
});

describe('withAutoDispatch', () => {
  it('should change only the autoDispatch key and leave every other key on the connection', () => {
    const config = {
      baseUrl: 'https://shop.example.com',
      sourcingAuthority: { enabled: true, scopes: ['a'] },
      fulfillmentExecutor: { enabled: true },
    };

    const next = withAutoDispatch(config, { enabled: true, trigger: 'on-accept' });

    expect(next).toEqual({
      ...config,
      autoDispatch: { enabled: true, trigger: 'on-accept' },
    });
    expect(config).not.toHaveProperty('autoDispatch');
  });

  it('should carry through a key inside autoDispatch this screen does not own', () => {
    const next = withAutoDispatch(
      { autoDispatch: { enabled: false, someFutureKey: 'keep me' } },
      { enabled: true, trigger: 'on-accept' }
    );

    expect(next.autoDispatch).toEqual({ enabled: true, trigger: 'on-accept', someFutureKey: 'keep me' });
  });

  it('should OMIT a cleared knob rather than write null, because the backend refuses null', () => {
    const next = withAutoDispatch(
      { autoDispatch: { enabled: true, defaultWeightGrams: 300, parcelTemplate: 'small' } },
      { enabled: true, trigger: 'on-accept' }
    );

    expect(next.autoDispatch).toEqual({ enabled: true, trigger: 'on-accept' });
    expect(JSON.stringify(next)).not.toContain('null');
  });

  it('should write the box only as a whole', () => {
    const whole = withAutoDispatch({}, {
      enabled: true,
      trigger: 'on-accept',
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
    });
    const partial = withAutoDispatch({}, { enabled: true, trigger: 'on-accept', widthMm: 200 });

    expect(whole.autoDispatch).toMatchObject({ lengthMm: 300, widthMm: 200, heightMm: 100 });
    expect(partial.autoDispatch).not.toHaveProperty('widthMm');
  });

  it('should write a config into a connection that had none', () => {
    expect(withAutoDispatch(null, { enabled: false, trigger: 'on-parcel-closed' })).toEqual({
      autoDispatch: { enabled: false, trigger: 'on-parcel-closed' },
    });
  });
});

describe('toPreviewRequest', () => {
  it('should send only what is set, plus the limit', () => {
    expect(toPreviewRequest({ enabled: true, trigger: 'on-accept' }, 10)).toEqual({ limit: 10 });
    expect(
      toPreviewRequest(
        { enabled: true, trigger: 'on-accept', defaultWeightGrams: 250, parcelTemplate: 'small' },
        5
      )
    ).toEqual({ defaultWeightGrams: 250, parcelTemplate: 'small', limit: 5 });
  });

  it('should send a box only when all three sides are present', () => {
    expect(
      toPreviewRequest({ enabled: true, trigger: 'on-accept', lengthMm: 1, widthMm: 2 }, 10)
    ).toEqual({ limit: 10 });
    expect(
      toPreviewRequest(
        { enabled: true, trigger: 'on-accept', lengthMm: 1, widthMm: 2, heightMm: 3 },
        10
      )
    ).toEqual({ lengthMm: 1, widthMm: 2, heightMm: 3, limit: 10 });
  });

  it('should never send the enabled flag or the trigger, which a preview does not depend on', () => {
    expect(Object.keys(toPreviewRequest({ enabled: true, trigger: 'on-parcel-closed' }, 10))).toEqual([
      'limit',
    ]);
  });
});
