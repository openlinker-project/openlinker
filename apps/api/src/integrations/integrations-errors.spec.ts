/**
 * Integrations error codes (#3865)
 *
 * @module apps/api/src/integrations
 */
import { InternalServerErrorException } from '@nestjs/common';
import { internalServerError } from './integrations-errors';

describe('integrations errors (#3865)', () => {
  it('should keep the 500 class and carry the code', () => {
    const error = internalServerError(
      'OAUTH_ADAPTER_NOT_REGISTERED',
      'No OAuth-completion adapter registered for allegro.publicapi.v1',
      { adapterKey: 'allegro.publicapi.v1' }
    );

    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getResponse()).toEqual({
      statusCode: 500,
      code: 'OAUTH_ADAPTER_NOT_REGISTERED',
      message: 'No OAuth-completion adapter registered for allegro.publicapi.v1',
      params: { adapterKey: 'allegro.publicapi.v1' },
    });
  });
});
