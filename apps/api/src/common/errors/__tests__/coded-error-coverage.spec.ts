/**
 * Coded error coverage (#3864)
 *
 * No API endpoint may regain an error
 * whose body is only an English sentence: the frontend picks its copy by
 * `code` (ADR-081), so a string-bodied Nest exception would reach the operator
 * as a generic message. An exception built from a coded body is allowed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const API_SRC = join(__dirname, '../../..');

/** Every production `.ts` file under `apps/api/src` (#3865 widened the scan from #3864's three files). */
function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

const NEST_EXCEPTIONS =
  'BadRequest|NotFound|Conflict|UnprocessableEntity|NotImplemented|BadGateway|ServiceUnavailable|Forbidden|Unauthorized|PayloadTooLarge|InternalServerError';

/** `new XException(` whose first argument is a sentence: a string literal, a template or `x.message`. */
const STRING_BODIED = new RegExp(
  `new (?:${NEST_EXCEPTIONS})Exception\\(\\s*(?:['"\`]|[\\w.]+\\.message\\b)`
);

describe('coded error coverage (#3864, #3865)', () => {
  it('should find no sentence-only HTTP error anywhere in apps/api/src', () => {
    const offenders = productionSources(API_SRC)
      .filter((path) => STRING_BODIED.test(readFileSync(path, 'utf8')))
      .map((path) => relative(API_SRC, path));

    expect(offenders).toEqual([]);
  });
});
