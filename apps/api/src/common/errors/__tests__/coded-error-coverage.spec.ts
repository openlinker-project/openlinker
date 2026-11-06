/**
 * Coded error coverage (#3864)
 *
 * The endpoints converted by the error-code track must not regain an error
 * whose body is only an English sentence: the frontend picks its copy by
 * `code` (ADR-081), so a string-bodied Nest exception would reach the operator
 * as a generic message. A body-object exception (e.g. #3861's shape errors)
 * already names its code and is allowed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONVERTED_FILES = [
  'integrations/application/services/connection.service.ts',
  'invoicing/http/invoicing.controller.ts',
  'invoicing/http/numbering-series.controller.ts',
];

const NEST_EXCEPTIONS =
  'BadRequest|NotFound|Conflict|UnprocessableEntity|NotImplemented|BadGateway|ServiceUnavailable|Forbidden';

/** `new XException(` followed by anything but `{` - a sentence, not a coded body. */
const STRING_BODIED = new RegExp(`new (?:${NEST_EXCEPTIONS})Exception\\(\\s*(?!\\{|toConfigShapeErrorBody)`);

describe('coded error coverage (#3864)', () => {
  it.each(CONVERTED_FILES)('%s throws no sentence-only HTTP error', (relativePath) => {
    const source = readFileSync(join(__dirname, '../../..', relativePath), 'utf8');

    expect(source).not.toMatch(STRING_BODIED);
  });
});
