/**
 * Projection allowlist specs (#2406).
 *
 * This view reaches an operator's browser, and the context sits one hop from
 * `RoutingShipTo`, which carries buyer PII (ADR-062).
 *
 * @module libs/core/src/fulfillment/application/types
 */
import { FulfillmentWorkActionValues } from '../../../domain/types/fulfillment-work-action.types';
import type { FulfillmentWork } from '../../../domain/types/fulfillment-work.types';
import {
  isOperatorInvocableAction,
  OPERATOR_INVOCABLE_ACTIONS,
  type FulfillmentHoldView,
  type FulfillmentWorkLineView,
  type FulfillmentWorkView,
} from '../fulfillment-work-view.types';

/**
 * DISTRIBUTING `keyof`.
 *
 * A bare `keyof (A | B)` is the INTERSECTION of the two key sets, so an
 * `Extract<>` over a union reads `never` and the assertion is vacuous — green
 * forever, whatever either arm grows. `T extends unknown ? keyof T : never`
 * distributes and sees every arm's keys. (`routing-ship-to.types.spec.ts` and
 * `fulfillment-execution.types.spec.ts` both document this trap.)
 */
type KeysOf<T> = T extends unknown ? keyof T : never;

/**
 * Assert a type argument is exactly `never`.
 *
 * A CALLED generic rather than an unused `type _X = ...` alias: `noUnusedLocals`
 * rejects the alias form, and a suppressed assertion is not an assertion.
 */
function expectNever<T extends never>(_witness?: T): void {
  /* the constraint is the assertion; a non-`never` argument fails to compile */
}

describe('FulfillmentWorkView projection', () => {
  it('should carry no buyer-identifying key on the work, its lines or its holds', () => {
    type ForbiddenPii =
      | 'name'
      | 'firstName'
      | 'lastName'
      | 'email'
      | 'customerEmail'
      | 'phone'
      | 'address'
      | 'address1'
      | 'address2'
      | 'street'
      | 'city'
      | 'postcode'
      | 'postalCode'
      | 'countryIso2'
      | 'shipTo'
      | 'buyerTaxId'
      | 'customer';

    // Asserted ONE SHAPE PER CALL, deliberately: a `A | B | C` union of three
    // `Extract<>`s is `never | never | never`, which `no-redundant-type-constituents`
    // auto-`--fix`es down to a single arm — silently deleting two of the three
    // assertions and leaving a check that cannot fail. Three calls cannot be
    // collapsed that way.
    // Each fails to COMPILE if that shape grows a PII-shaped key.
    expectNever<Extract<KeysOf<FulfillmentWorkView>, ForbiddenPii>>();
    expectNever<Extract<KeysOf<FulfillmentWorkLineView>, ForbiddenPii>>();
    expectNever<Extract<KeysOf<FulfillmentHoldView>, ForbiddenPii>>();

    expect(true).toBe(true);
  });

  it('should withhold the internal-only fields the view deliberately drops', () => {
    // `dispatchRelayedAt` is relay hygiene (#2401); `placedByService` is an
    // internal actor. Both exist on the domain shapes and must not ride out.
    expectNever<Extract<KeysOf<FulfillmentWorkView>, 'dispatchRelayedAt'>>();
    expectNever<Extract<KeysOf<FulfillmentHoldView>, 'placedByService'>>();

    expect(true).toBe(true);
  });

  it('should keep supportedActions OFF the aggregate, as #2391 decided', () => {
    // The vocabulary leaf declined to put this field on `FulfillmentWork`
    // precisely so a client cannot recompute legality locally. If it ever
    // appears there, this stops compiling.
    type OnAggregate = Extract<KeysOf<FulfillmentWork>, 'supportedActions'>;
    expectNever<OnAggregate>();

    expect(true).toBe(true);
  });
});

describe('OPERATOR_INVOCABLE_ACTIONS', () => {
  it('should be a strict subset of the shipped action vocabulary', () => {
    for (const action of OPERATOR_INVOCABLE_ACTIONS) {
      expect(FulfillmentWorkActionValues).toContain(action);
    }
    expect(OPERATOR_INVOCABLE_ACTIONS.length).toBeLessThan(FulfillmentWorkActionValues.length);
  });

  it('should exclude the executor-dependent intents and every holder reply', () => {
    // `submit` / `request_cancellation` need a resolved FulfillmentExecutorPort
    // (#2409); the four replies are the holder's answers (#2399).
    for (const excluded of [
      'submit',
      'request_cancellation',
      'accept',
      'reject',
      'accept_cancellation',
      'reject_cancellation',
    ]) {
      expect(OPERATOR_INVOCABLE_ACTIONS as readonly string[]).not.toContain(excluded);
    }
  });

  it('should narrow an untrusted route parameter', () => {
    expect(isOperatorInvocableAction('close')).toBe(true);
    expect(isOperatorInvocableAction('submit')).toBe(false);
    expect(isOperatorInvocableAction('drop table')).toBe(false);
    expect(isOperatorInvocableAction(42)).toBe(false);
  });
});
