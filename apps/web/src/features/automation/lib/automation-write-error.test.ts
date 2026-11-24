/**
 * Write-refusal reader tests (#2365)
 *
 * The property under test is that refusals are read from the CODE and PARAMS,
 * never parsed out of the message — including the `index`, which is what lets the composer
 * mark the offending row.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { describeAutomationWriteError } from './automation-write-error';
import { getMessages } from '../../../shared/i18n';

const AUTOMATION_COMPOSER_COPY = getMessages('automation').composer;

describe('describeAutomationWriteError', () => {
  it('should render an actionable message for a duplicate rule', () => {
    const refusal = describeAutomationWriteError(
      new ApiError('An identical definition already covers an overlapping window.', 409, {
        code: 'AUTOMATION_RULE_CONFLICT',
      }),
    );

    expect(refusal.isDuplicate).toBe(true);
    // Actionable, not a restatement: it names what goes wrong (both would run)
    // and what to change.
    expect(refusal.message).toBe(AUTOMATION_COMPOSER_COPY.duplicateRule);
  });

  it('should point an invalid-action refusal at the action row it names', () => {
    const refusal = describeAutomationWriteError(
      new ApiError('Step 2 is malformed.', 400, {
        code: 'AUTOMATION_ACTION_INVALID',
        params: { index: 1 },
      }),
    );

    expect(refusal.message).toBe(getMessages('errors').codes.AUTOMATION_ACTION_INVALID);
    expect(refusal.target).toBe('actions');
    expect(refusal.index).toBe(1);
  });

  it('should point an invalid-condition refusal at the condition row it names', () => {
    const refusal = describeAutomationWriteError(
      new ApiError('Condition 1 is malformed.', 400, {
        code: 'AUTOMATION_CONDITION_INVALID',
        params: { index: 0 },
      }),
    );

    expect(refusal.target).toBe('conditions');
    expect(refusal.index).toBe(0);
  });

  it('should name the illegal action from the body, not the message text', () => {
    const refusal = describeAutomationWriteError(
      new ApiError('some wording that may change', 400, {
        code: 'AUTOMATION_TRIGGER_ACTION_ILLEGAL',
        params: { trigger: 'return.received', action: 'dispatch-shipment', index: 0 },
      }),
    );

    expect(refusal.message).toContain('dispatch-shipment');
    expect(refusal.target).toBe('actions');
  });

  it('should treat a step-count refusal as rule-level, not row-level', () => {
    // It is about how many steps there are, so no single row caused it.
    const refusal = describeAutomationWriteError(
      new ApiError('Between 1 and 3 steps.', 400, {
        code: 'AUTOMATION_STEP_COUNT_INVALID',
        params: { count: 4, min: 1, max: 3 },
      }),
    );

    expect(refusal.target).toBe('actions');
    expect(refusal.index).toBeNull();
  });

  it('should ignore an index that is not a usable row reference', () => {
    // `setError` on `actions.-1.carrierId` would silently do nothing.
    const refusal = describeAutomationWriteError(
      new ApiError('bad', 400, { code: 'AUTOMATION_ACTION_INVALID', params: { index: -1 } }),
    );

    expect(refusal.index).toBeNull();
  });

  it('should describe a refusal this build does not recognise through the shared copy', () => {
    // A refusal added backend-side must still reach the operator.
    const refusal = describeAutomationWriteError(
      new ApiError('Something new and specific went wrong.', 400, {
        code: 'AUTOMATION_RULE_NOT_FOUND',
      }),
    );

    expect(refusal.message).toBe(getMessages('errors').codes.AUTOMATION_RULE_NOT_FOUND);
    expect(refusal.target).toBeNull();
  });

  it('should degrade to a generic sentence for a non-API failure', () => {
    expect(describeAutomationWriteError(new Error('')).message).toBe(
      getMessages('errors').status.other,
    );
  });
});
