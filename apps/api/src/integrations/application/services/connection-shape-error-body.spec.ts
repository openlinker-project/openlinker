import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { toConfigShapeErrorBody } from './connection-shape-error-body';

describe('toConfigShapeErrorBody', () => {
  it('should keep message and errors and add the code and one field per issue', () => {
    const issues = [
      { path: 'baseUrl', message: 'baseUrl must be a URL', code: 'isUrl' },
      { path: 'defaults', message: 'must be an object' },
    ];

    expect(toConfigShapeErrorBody(new InvalidConnectionConfigException('shoper', issues))).toEqual({
      statusCode: 400,
      message: 'Invalid shoper connection config',
      error: 'Bad Request',
      errors: issues,
      code: 'VALIDATION_FAILED',
      fields: [
        { path: 'baseUrl', code: 'isUrl' },
        { path: 'defaults', code: 'invalid' },
      ],
    });
  });
});
