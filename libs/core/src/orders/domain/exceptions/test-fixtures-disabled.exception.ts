/**
 * Test Fixtures Disabled Exception (#2855)
 *
 * Raised by `OrderTestFixtureService` when a test-fixture-only write is
 * attempted but `OL_ALLOW_TEST_FIXTURES` is not `'true'` in the process env.
 * This is the SECOND gate alongside `@Roles('admin')` on the HTTP layer — role
 * alone would let a real production admin silently corrupt a real order's
 * Net Sales eligibility by mistake. The env var defaults OFF and must never
 * be set in a production `.env`.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class TestFixturesDisabledException extends Error {
  constructor() {
    super(
      'Test fixtures are disabled — set OL_ALLOW_TEST_FIXTURES=true in a non-production ' +
        'environment to enable this endpoint.'
    );
    this.name = 'TestFixturesDisabledException';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TestFixturesDisabledException);
    }
  }
}
