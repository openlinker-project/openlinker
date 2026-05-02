/**
 * parseAllegroErrorBody tests (#486)
 *
 * @module libs/integrations/allegro/src/infrastructure/http/__tests__
 */
import { Logger } from '@openlinker/shared/logging';
import { parseAllegroErrorBody } from '../parse-allegro-error-body';

describe('parseAllegroErrorBody', () => {
  it('returns [] for undefined / null / empty body', () => {
    expect(parseAllegroErrorBody(undefined)).toEqual([]);
    expect(parseAllegroErrorBody(null)).toEqual([]);
    expect(parseAllegroErrorBody('')).toEqual([]);
  });

  it('returns the structured errors array when present', () => {
    const body = JSON.stringify({
      errors: [
        {
          code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED',
          message: 'Responsible producer is required for every product in the offer',
          userMessage: 'Producent odpowiedzialny jest obowiązkowy dla każdego produktu w ofercie',
          path: 'offer.modules.productSafety.data.productsData[0].responsibleProducer',
        },
      ],
    });

    const result = parseAllegroErrorBody(body);

    expect(result).toEqual([
      {
        code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED',
        message: 'Responsible producer is required for every product in the offer',
        userMessage: 'Producent odpowiedzialny jest obowiązkowy dla każdego produktu w ofercie',
        path: 'offer.modules.productSafety.data.productsData[0].responsibleProducer',
      },
    ]);
  });

  it('returns [] for non-Allegro JSON (no errors key)', () => {
    expect(parseAllegroErrorBody(JSON.stringify({ message: 'something else' }))).toEqual([]);
  });

  it('returns [] for JSON where errors is not an array', () => {
    expect(parseAllegroErrorBody(JSON.stringify({ errors: 'not-an-array' }))).toEqual([]);
    expect(parseAllegroErrorBody(JSON.stringify({ errors: { not: 'array' } }))).toEqual([]);
  });

  it('returns [] for malformed JSON without throwing', () => {
    expect(() => parseAllegroErrorBody('not-json-at-all')).not.toThrow();
    expect(parseAllegroErrorBody('not-json-at-all')).toEqual([]);
    expect(parseAllegroErrorBody('<html><body>502 Bad Gateway</body></html>')).toEqual([]);
  });

  it('logs a warning breadcrumb on malformed JSON when logger is provided', () => {
    const logger = { warn: jest.fn() } as unknown as Logger;

    parseAllegroErrorBody('definitely not json', logger);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(jest.mocked(logger.warn).mock.calls[0][0]).toContain(
      'Failed to parse Allegro error body as JSON',
    );
  });

  it('does not log when JSON is valid but lacks errors array', () => {
    const logger = { warn: jest.fn() } as unknown as Logger;

    parseAllegroErrorBody(JSON.stringify({ status: 'ok' }), logger);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
