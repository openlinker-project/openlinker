import { describe, expect, it } from 'vitest';
import { collectFormErrorMessages } from './collect-form-error-messages';

describe('collectFormErrorMessages', () => {
  it('should return top-level messages when fields are flat', () => {
    expect(
      collectFormErrorMessages({ name: { type: 'too_small', message: 'Connection name is required' } }),
    ).toEqual(['Connection name is required']);
  });

  it('should return nested messages when an object field fails', () => {
    expect(
      collectFormErrorMessages({
        rateLimit: { maxConcurrent: { type: 'custom', message: 'Must be at most 64' } },
        pricingRule: { percent: { type: 'custom', message: 'Margin must be below 100%' } },
      }),
    ).toEqual(['Must be at most 64', 'Margin must be below 100%']);
  });

  it('should collect messages inside array fields', () => {
    expect(
      collectFormErrorMessages({
        attachments: [undefined, { id: { type: 'too_small', message: 'Attachment id is required' } }],
      }),
    ).toEqual(['Attachment id is required']);
  });

  it('should not walk into a field ref or its types map', () => {
    const ref = { message: 'from a DOM node', parent: { message: 'deeper DOM node' } };
    expect(
      collectFormErrorMessages({
        name: { type: 'custom', message: 'Required', ref, types: { custom: 'Required (types)' } },
      }),
    ).toEqual(['Required']);
  });

  it('should drop duplicate messages when two fields share one', () => {
    expect(
      collectFormErrorMessages({
        rateLimit: {
          requestsPerMinute: { type: 'custom', message: 'Must be a positive whole number' },
          maxConcurrent: { type: 'custom', message: 'Must be a positive whole number' },
        },
      }),
    ).toEqual(['Must be a positive whole number']);
  });

  it('should return an empty list when there are no errors', () => {
    expect(collectFormErrorMessages({})).toEqual([]);
    expect(collectFormErrorMessages(undefined)).toEqual([]);
  });
});
