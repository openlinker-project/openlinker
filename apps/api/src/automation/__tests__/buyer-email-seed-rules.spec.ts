import {
  computeAutomationDefinitionHash,
  isAutomationAction,
  isLegalAutomationPair,
  type AutomationAction,
  type AutomationTrigger,
} from '@openlinker/core/automation';
import {
  BUYER_EMAIL_SEED_RULES,
  seedDefinitionHash,
} from '../../migrations/1937480000000-seed-buyer-email-automation-rules';

describe('SeedBuyerEmailAutomationRules (#3554)', () => {
  it('should seed one rule per buyer-email template', () => {
    expect(
      BUYER_EMAIL_SEED_RULES.map((rule) => rule.actions[0]?.buyerEmailTemplate).sort()
    ).toEqual(['document-issued', 'order-confirmed', 'return-received', 'shipped']);
  });

  it.each(BUYER_EMAIL_SEED_RULES.map((rule) => [rule.name, rule] as const))(
    'should seed a valid, legal rule whose hash matches the service hash: %s',
    (_name, rule) => {
      expect(rule.actions.every((action) => isAutomationAction(action))).toBe(true);
      expect(isLegalAutomationPair(rule.trigger, 'send-email')).toBe(true);
      expect(seedDefinitionHash(rule)).toBe(
        computeAutomationDefinitionHash({
          trigger: rule.trigger as AutomationTrigger,
          triggerConfig: {} as never,
          conditions: [],
          actions: rule.actions as unknown as AutomationAction[],
        })
      );
    }
  );
});
