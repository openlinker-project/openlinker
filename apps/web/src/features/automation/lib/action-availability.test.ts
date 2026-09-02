/**
 * Availability rule tests (#2364)
 *
 * @module apps/web/src/features/automation/lib
 */
import { describe, expect, it } from 'vitest';
import { describeAvailability, readRuleAvailability } from './action-availability';
import { AUTOMATION_ACTION_AVAILABILITY_VALUES } from '../api/automation.types';

describe('describeAvailability', () => {
  it('should map every declared availability value without throwing', () => {
    // The union is closed; if a fourth value is added backend-side and mirrored
    // here without updating the switch, this fails rather than rendering the
    // new value as whatever a fallback arm said.
    for (const value of AUTOMATION_ACTION_AVAILABILITY_VALUES) {
      expect(() => describeAvailability(value)).not.toThrow();
    }
  });

  it('should mark only `unavailable` as blocking', () => {
    expect(describeAvailability('available').blocking).toBe(false);
    // `partial` genuinely works in some firing processes, so calling it
    // blocking would be as wrong as calling it ready.
    expect(describeAvailability('partial').blocking).toBe(false);
    expect(describeAvailability('unavailable').blocking).toBe(true);
  });

  it('should escalate tone with severity', () => {
    expect(describeAvailability('available').tone).toBe('success');
    expect(describeAvailability('partial').tone).toBe('warning');
    expect(describeAvailability('unavailable').tone).toBe('error');
  });

  it('should throw when handed a value outside the union', () => {
    expect(() =>
      describeAvailability('sometimes' as Parameters<typeof describeAvailability>[0]),
    ).toThrow(/Unhandled automation action availability/);
  });
});

describe('readRuleAvailability', () => {
  const relay = { action: 'relay-status-to-source', availability: 'available', reason: null } as const;
  const email = {
    action: 'send-email',
    availability: 'partial',
    reason: 'Automation emails currently require the API process.',
  } as const;
  const label = {
    action: 'dispatch-shipment',
    availability: 'unavailable',
    reason: 'Buying a shipping label from an automation needs a recipient and parcel.',
  } as const;

  it('should report a rule as able to act when every step is available', () => {
    const verdict = readRuleAvailability([relay]);
    expect(verdict.cannotAct).toBe(false);
    expect(verdict.blocked).toHaveLength(0);
  });

  it('should report a rule as unable to act when any step is unavailable', () => {
    const verdict = readRuleAvailability([relay, label]);
    expect(verdict.cannotAct).toBe(true);
    expect(verdict.blocked.map((entry) => entry.action)).toEqual(['dispatch-shipment']);
  });

  it('should keep partial steps separate from blocked ones', () => {
    const verdict = readRuleAvailability([email, label]);
    expect(verdict.partial.map((entry) => entry.action)).toEqual(['send-email']);
    expect(verdict.blocked.map((entry) => entry.action)).toEqual(['dispatch-shipment']);
    expect(verdict.cannotAct).toBe(true);
  });

  it('should not report a rule as unable to act when its only caveat is partial', () => {
    // A partial-only rule really does work, in the API process. Blocking it
    // would tell the operator something false about a rule that fires.
    const verdict = readRuleAvailability([email]);
    expect(verdict.cannotAct).toBe(false);
    expect(verdict.partial).toHaveLength(1);
  });

  it('should report an empty step list as able to act', () => {
    expect(readRuleAvailability([]).cannotAct).toBe(false);
  });
});
