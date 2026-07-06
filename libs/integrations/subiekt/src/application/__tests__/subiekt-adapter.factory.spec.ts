/**
 * Subiekt Adapter Factory — config-parsing unit tests (#1324)
 *
 * Exercises `validateAndParseConfig` (via bracket access to the private method)
 * to cover the four payment/branch config fields added in Unit B. Constructing
 * the adapter itself is out of scope here (that path lands with Unit C's 4th
 * constructor param).
 *
 * @module libs/integrations/subiekt/src/application/__tests__
 */
import { SubiektConfigException } from '../../domain/exceptions/subiekt-config.exception';
import type { SubiektConnectionConfig } from '../../domain/types/subiekt-connection-config.types';
import { SubiektAdapterFactory } from '../subiekt-adapter.factory';

type ParseFn = (config: Record<string, unknown>) => SubiektConnectionConfig;

function parse(config: Record<string, unknown>): SubiektConnectionConfig {
  const factory = new SubiektAdapterFactory();
  const fn = (factory as unknown as { validateAndParseConfig: ParseFn }).validateAndParseConfig;
  return fn.call(factory, config);
}

describe('SubiektAdapterFactory.validateAndParseConfig', () => {
  it('parses a config with all payment/cash-register fields', () => {
    const parsed = parse({
      bridgeBaseUrl: 'http://192.168.1.10:5000',
      defaultPaymentMethod: 'transfer',
      bankAccountId: 5,
      defaultStanowiskoKasoweId: 100067,
    });

    expect(parsed).toEqual({
      bridgeBaseUrl: 'http://192.168.1.10:5000',
      defaultPaymentMethod: 'transfer',
      bankAccountId: 5,
      defaultStanowiskoKasoweId: 100067,
    });
  });

  it('omits absent optional fields', () => {
    const parsed = parse({ bridgeBaseUrl: 'http://192.168.1.10' });

    expect(parsed).toEqual({ bridgeBaseUrl: 'http://192.168.1.10' });
    expect(parsed.defaultPaymentMethod).toBeUndefined();
    expect(parsed.bankAccountId).toBeUndefined();
    expect(parsed.defaultStanowiskoKasoweId).toBeUndefined();
  });

  it('accepts defaultPaymentMethod: cash', () => {
    expect(
      parse({ bridgeBaseUrl: 'http://192.168.1.10', defaultPaymentMethod: 'cash' })
        .defaultPaymentMethod,
    ).toBe('cash');
  });

  it('throws SubiektConfigException on an invalid defaultPaymentMethod', () => {
    expect(() =>
      parse({ bridgeBaseUrl: 'http://192.168.1.10', defaultPaymentMethod: 'card' }),
    ).toThrow(SubiektConfigException);
  });

  it.each([
    ['bankAccountId', 0],
    ['bankAccountId', -1],
    ['bankAccountId', 1.5],
    ['bankAccountId', 'x'],
    ['defaultStanowiskoKasoweId', 0],
    ['defaultStanowiskoKasoweId', -3],
    ['defaultStanowiskoKasoweId', 3.3],
  ])('throws SubiektConfigException when %s is %p', (field, value) => {
    expect(() => parse({ bridgeBaseUrl: 'http://192.168.1.10', [field]: value })).toThrow(
      SubiektConfigException,
    );
  });

  it('still throws for a missing bridgeBaseUrl (existing behavior)', () => {
    expect(() => parse({})).toThrow(SubiektConfigException);
  });
});
