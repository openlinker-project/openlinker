/**
 * interpolate - unit tests
 *
 * @module shared/i18n
 */
import { describe, expect, it } from 'vitest';
import { interpolate } from './interpolate';

describe('interpolate', () => {
  it('should fill named placeholders', () => {
    expect(interpolate('{n} orders from {channel}', { n: 3, channel: 'Allegro' })).toBe(
      '3 orders from Allegro',
    );
  });

  it('should leave a placeholder without a value as written', () => {
    const template: string = 'Hello {name}';
    expect(interpolate(template, {})).toBe('Hello {name}');
  });
});
