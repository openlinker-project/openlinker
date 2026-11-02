/**
 * Both refund entry points enforce ONE ceiling predicate (#3289).
 *
 * The returns pre-flight and the direct record write must not be able to
 * disagree about the same order, so neither may carry its own copy of the
 * arithmetic. This scans both services' source rather than mocking them: the
 * failure it guards is a quiet local re-implementation, which no behavioural
 * spec of either service would notice.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICES = {
  'OrderRefundService (direct record write)': join(__dirname, 'order-refund.service.ts'),
  'ReturnRefundService (returns pre-flight)': join(
    __dirname,
    '../../../returns/application/services/return-refund.service.ts'
  ),
};

describe('refund ceiling single predicate (#3289)', () => {
  it.each(Object.entries(SERVICES))(
    'should call the shared evaluate and decide functions in %s',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');

      expect(source).toMatch(/\bevaluateRefundCeiling\(/);
      expect(source).toMatch(/\bdecideRefundCeiling\(/);
    }
  );

  it.each(Object.entries(SERVICES))(
    'should not define its own ceiling arithmetic in %s',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');

      expect(source).not.toMatch(/function\s+(evaluateRefundCeiling|decideRefundCeiling)\b/);
      expect(source).not.toMatch(/\b(totalAmount|ceiling)\s*-\s*alreadyRefunded\b/);
    }
  );
});
