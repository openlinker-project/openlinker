import { describe, expect, it } from 'vitest';
import { serverErrorText } from './server-error-text';

const TEMPLATE = 'The server said: {message}';

describe('serverErrorText', () => {
  it('should prefix the server message when one is present', () => {
    expect(serverErrorText(TEMPLATE, 'Order is locked', 'Try again.')).toBe(
      'The server said: Order is locked'
    );
  });

  it('should return the fallback when the server message is empty', () => {
    expect(serverErrorText(TEMPLATE, '', 'Try again.')).toBe('Try again.');
    expect(serverErrorText(TEMPLATE, undefined, 'Try again.')).toBe('Try again.');
  });
});
