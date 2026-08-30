import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FULFILLMENT_REQUEST_ALLOWED_KEYS,
  FULFILLMENT_REQUEST_FORBIDDEN_KEYS,
  FULFILLMENT_REQUEST_LINE_ALLOWED_KEYS,
  FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS,
  type AcceptedFulfillmentRequest,
  type FulfillmentProgressSnapshot,
  type FulfillmentRequest,
  type FulfillmentRequestLine,
  type FulfillmentRequestResult,
  type RejectedFulfillmentRequest,
} from './fulfillment-execution.types';
import { FulfillmentRequestStatusValues } from './fulfillment-request-status.types';

/**
 * `keyof (A | B)` resolves to the INTERSECTION of the arms' keys, so a bare `keyof` over a
 * discriminated union yields only `status` and an assertion built on it would read `never`
 * whether or not an arm carried a forbidden field — vacuous, and green forever. This
 * distributes so every arm's keys are actually examined (the #2393 `RoutingShipTo` rule).
 */
type KeysOf<T> = T extends unknown ? keyof T : never;

/**
 * The allowlist guard proper.
 *
 * `Exclude` over the declared keys is what makes "the projection handed to a plugin carries
 * nothing its allowlist does not name" TRUE: ANY unlisted field is a `tsc` error, not just
 * one whose name someone thought to enumerate. The `Extract` checks below are a readability
 * aid naming what this exists to keep out; on their own they would pass for a `street` or a
 * `company` nobody listed.
 */
type UnallowedRequestKeys = Exclude<
  keyof FulfillmentRequest,
  (typeof FULFILLMENT_REQUEST_ALLOWED_KEYS)[number]
>;
const _noUnallowedRequestKeys: UnallowedRequestKeys extends never ? true : never = true;

type UnallowedRequestLineKeys = Exclude<
  keyof FulfillmentRequestLine,
  (typeof FULFILLMENT_REQUEST_LINE_ALLOWED_KEYS)[number]
>;
const _noUnallowedRequestLineKeys: UnallowedRequestLineKeys extends never ? true : never = true;

/**
 * Names the forbidden fields explicitly, on top of the allowlist above.
 *
 * DERIVED from the exported constant rather than hand-inlined: a subset spelled here would
 * silently stop covering a name added to `FULFILLMENT_REQUEST_FORBIDDEN_KEYS`, leaving two
 * lists that disagree about what is forbidden. The `Exclude` allowlist above catches such a
 * field anyway — this is drift hygiene, not the hole.
 */
type ForbiddenRequestKeys = Extract<
  keyof FulfillmentRequest,
  (typeof FULFILLMENT_REQUEST_FORBIDDEN_KEYS)[number]
>;
const _noForbiddenRequestKeys: ForbiddenRequestKeys extends never ? true : never = true;

type ForbiddenRequestLineKeys = Extract<
  keyof FulfillmentRequestLine,
  (typeof FULFILLMENT_REQUEST_FORBIDDEN_KEYS)[number]
>;
const _noForbiddenRequestLineKeys: ForbiddenRequestLineKeys extends never ? true : never = true;

/**
 * The assertion AC 2 actually needs.
 *
 * `blocking` must be NON-OPTIONAL. A round-trip of the field through an object literal would
 * assert that TypeScript works and would pass identically if the field were deleted; the
 * change that matters is someone writing `blocking?: boolean`, which reads `undefined` — a
 * falsy value — so the rejecter is not excluded and the re-source loop the field exists to
 * terminate runs forever. This fails at `tsc` on exactly that edit.
 */
type BlockingIsOptional = undefined extends RejectedFulfillmentRequest['blocking'] ? true : false;
const _blockingIsRequired: BlockingIsOptional extends false ? true : never = true;

/**
 * No arm of the result may carry a buyer-identifying field either — a rejection's `detail` is
 * vendor prose, not a place to hand back what the request refused to send.
 */
type ForbiddenResultKeys = Extract<KeysOf<FulfillmentRequestResult>, 'name' | 'email' | 'phone'>;
const _noForbiddenResultKeys: ForbiddenResultKeys extends never ? true : never = true;

/**
 * The RESULT allowlist guard, per arm.
 *
 * The request is an outbound PII projection; this is about PERSISTENCE — #2399 stamps
 * `FulfillmentWork.requestStatus` from this result, so an unreviewed field a plugin returns is
 * a field core may write (the #2327 `rawPayload` class). A bare `Exclude<keyof
 * FulfillmentRequestResult, ...>` would be VACUOUS: `keyof` over a union is the intersection,
 * so it would see only `status` and stay green whatever either arm grew. `KeysOf<T>` above
 * distributes; each arm is excluded against its own list.
 */
type UnallowedAcceptedKeys = Exclude<
  keyof AcceptedFulfillmentRequest,
  (typeof FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS.accepted)[number]
>;
const _noUnallowedAcceptedKeys: UnallowedAcceptedKeys extends never ? true : never = true;

type UnallowedRejectedKeys = Exclude<
  keyof RejectedFulfillmentRequest,
  (typeof FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS.rejected)[number]
>;
const _noUnallowedRejectedKeys: UnallowedRejectedKeys extends never ? true : never = true;

/**
 * And no arm may carry a forbidden buyer-identifying field, derived from the same constant the
 * request side uses so the two cannot disagree about what is forbidden.
 */
type ForbiddenResultKeysDerived = Extract<
  KeysOf<FulfillmentRequestResult>,
  (typeof FULFILLMENT_REQUEST_FORBIDDEN_KEYS)[number]
>;
const _noForbiddenResultKeysDerived: ForbiddenResultKeysDerived extends never ? true : never = true;

/**
 * The progress snapshot must carry NO negotiation status.
 *
 * #2399 owns the accept handshake and stamps `FulfillmentWork.requestStatus`; a second,
 * poll-derived answer to "did they take it" would be a rival authority over the same column,
 * and the two would disagree the first time a poll raced the handshake. A runtime
 * `Object.keys` assertion cannot carry this — the fixture it reads is written by this spec,
 * so adding the field to the interface would leave it green.
 */
type NegotiationKeysOnSnapshot = Extract<
  keyof FulfillmentProgressSnapshot,
  'status' | 'requestStatus' | 'accepted' | 'rejected'
>;
const _noNegotiationKeysOnSnapshot: NegotiationKeysOnSnapshot extends never ? true : never = true;

describe('fulfillment-execution.types', () => {
  const line: FulfillmentRequestLine = {
    workLineId: 'line-1',
    productVariantId: 'ol_variant_abc',
    quantity: 2,
  };

  const request: FulfillmentRequest = {
    work: { workId: 'ol_work_abc', connectionId: 'conn-1' },
    orderId: 'ol_order_abc',
    lines: [line],
    shipTo: { mode: 'plain', countryIso2: 'PL', postalCode: '00-001', city: 'Warszawa' },
    deliveryMethod: 'courier',
    idempotencyKey: 'work:ol_work_abc:1',
  };

  /**
   * Typed fixtures, kept at describe scope because the ANNOTATION is the check: each stops
   * compiling if its arm drops a field or changes a type. They are deliberately not
   * re-asserted field-by-field at runtime — that would test object literals, not the shapes.
   */
  const accepted: AcceptedFulfillmentRequest = {
    status: 'accepted',
    externalWorkId: 'WMS-42',
    acceptedAt: new Date('2026-08-30T10:00:00.000Z'),
  };

  const rejected: RejectedFulfillmentRequest = {
    status: 'rejected',
    reason: 'temporarily-out-of-capacity',
    blocking: false,
    detail: 'retry after the evening wave',
  };

  const snapshot: FulfillmentProgressSnapshot = {
    work: { workId: 'ol_work_abc', connectionId: 'conn-1' },
    externalWorkId: 'WMS-42',
    lines: [{ workLineId: 'line-1', fulfilledQuantity: 3, cancelledQuantity: 0 }],
    observedAt: null,
  };

  it('should keep the compile-time guards referenced', () => {
    expect(_noUnallowedRequestKeys).toBe(true);
    expect(_noUnallowedRequestLineKeys).toBe(true);
    expect(_noForbiddenRequestKeys).toBe(true);
    expect(_noForbiddenRequestLineKeys).toBe(true);
    expect(_blockingIsRequired).toBe(true);
    expect(_noForbiddenResultKeys).toBe(true);
    expect(_noNegotiationKeysOnSnapshot).toBe(true);
    expect(_noUnallowedAcceptedKeys).toBe(true);
    expect(_noUnallowedRejectedKeys).toBe(true);
    expect(_noForbiddenResultKeysDerived).toBe(true);
  });

  it('should keep the typed fixtures referenced so their annotations are checked', () => {
    // The fixtures exist for their type annotations; this keeps them from being unused
    // (TS6133 under noUnusedLocals) without asserting anything the test itself constructed.
    expect([accepted, rejected, snapshot]).toHaveLength(3);
  });

  describe('the allowlist projection', () => {
    it('should carry exactly the allowlisted top-level keys', () => {
      expect(Object.keys(request).sort()).toEqual([...FULFILLMENT_REQUEST_ALLOWED_KEYS].sort());
    });

    it('should carry exactly the allowlisted line keys', () => {
      expect(Object.keys(line).sort()).toEqual([...FULFILLMENT_REQUEST_LINE_ALLOWED_KEYS].sort());
    });

    it('should never list a forbidden buyer-identifying key as allowed', () => {
      for (const forbidden of FULFILLMENT_REQUEST_FORBIDDEN_KEYS) {
        expect(FULFILLMENT_REQUEST_ALLOWED_KEYS).not.toContain(forbidden);
        expect(FULFILLMENT_REQUEST_LINE_ALLOWED_KEYS).not.toContain(forbidden);
      }
    });

    /**
     * Scoped to the two REQUEST-carrying interfaces rather than the whole file: `name` is a
     * forbidden key on a request and would be a perfectly legitimate one elsewhere, and a
     * file-wide scan is how a guard gets weakened to make it pass (the #2393 precedent).
     */
    it('should not declare a forbidden key on FulfillmentRequest or FulfillmentRequestLine', () => {
      const source = readFileSync(join(__dirname, 'fulfillment-execution.types.ts'), 'utf8');
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');

      const blocks = ['FulfillmentRequest', 'FulfillmentRequestLine'].map((name) => {
        const match = withoutComments.match(
          new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`),
        );
        expect(match).not.toBeNull();
        return match?.[1] ?? '';
      });

      for (const block of blocks) {
        for (const forbidden of FULFILLMENT_REQUEST_FORBIDDEN_KEYS) {
          expect(block).not.toContain(`readonly ${forbidden}:`);
          expect(block).not.toContain(`readonly ${forbidden}?:`);
        }
      }
    });
  });

  describe('the result arms', () => {
    /**
     * The one load-bearing runtime assertion in this block.
     *
     * #2399 stamps `FulfillmentWork.requestStatus` straight from this result, so the shared
     * spelling is a correspondence rather than a coincidence — this compares the arms against
     * the REAL `FulfillmentRequestStatusValues` array, so renaming either side breaks here
     * rather than silently producing a status the work row cannot hold.
     *
     * Deliberately NOT accompanied by round-trips of `acceptedAt` / `blocking` through an
     * object literal: those would assert that TypeScript works and would survive the field
     * being deleted and re-added. `_blockingIsRequired` above is what pins `blocking`, and
     * the fixtures' own type annotations are what pin the rest — an arm that stopped
     * accepting these values would fail to compile.
     */
    it('should spell its two statuses exactly as the negotiation axis does', () => {
      expect(FulfillmentRequestStatusValues).toContain(accepted.status);
      expect(FulfillmentRequestStatusValues).toContain(rejected.status);
    });

    it('should carry exactly the allowlisted keys on each arm', () => {
      expect(Object.keys(accepted).sort()).toEqual(
        [...FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS.accepted].sort(),
      );
      expect(Object.keys(rejected).sort()).toEqual(
        [...FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS.rejected].sort(),
      );
    });

    it('should never list a forbidden buyer-identifying key as allowed on either arm', () => {
      for (const forbidden of FULFILLMENT_REQUEST_FORBIDDEN_KEYS) {
        expect(FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS.accepted).not.toContain(forbidden);
        expect(FULFILLMENT_REQUEST_RESULT_ALLOWED_KEYS.rejected).not.toContain(forbidden);
      }
    });
  });
});
