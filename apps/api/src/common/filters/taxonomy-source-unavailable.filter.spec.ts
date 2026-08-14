/**
 * Taxonomy Source Unavailable Filter — unit spec (#2074)
 *
 * @module apps/api/src/common/filters
 */
import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';

import { TaxonomySourceUnavailableException } from '@openlinker/core/listings';
import { TaxonomySourceUnavailableFilter } from './taxonomy-source-unavailable.filter';

function createHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('TaxonomySourceUnavailableFilter', () => {
  const filter = new TaxonomySourceUnavailableFilter();

  it('should return 422 when the connection has no taxonomy source', () => {
    const { host, status, json } = createHost();

    filter.catch(
      new TaxonomySourceUnavailableException('conn-1', 'no CategoryBrowser capability'),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      error: 'TaxonomySourceUnavailableException',
      message: expect.stringContaining('no CategoryBrowser capability'),
    });
  });

  it('should surface the operator-actionable remediation verbatim', () => {
    // The #2063 message tells the reader which capability to implement. Losing
    // it to a generic string is the failure mode this asserts against — it is
    // the whole reason the filter forwards `exception.message` rather than a
    // fixed one.
    const { host, json } = createHost();

    filter.catch(
      new TaxonomySourceUnavailableException(
        'conn-1',
        'the connection browses a marketplace taxonomy but declares no taxonomy identity — implement TaxonomyIdentityProvider on its adapter',
      ),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('implement TaxonomyIdentityProvider'),
      }),
    );
  });
});
