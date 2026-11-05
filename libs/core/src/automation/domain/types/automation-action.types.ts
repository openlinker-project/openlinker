/**
 * Automation Action Vocabulary (#2358, Wave-2 spec §5.3 + §5.3b)
 *
 * The six v1 actions and the exact shape of each one's parameters. Closed, and
 * versioned with the code: an action is admissible only if it invokes an
 * operation OpenLinker ALREADY ships end-to-end, with its own idempotency and
 * failure handling solved (spec §5.3's admission rule).
 *
 * **The per-action config is typed, deliberately.** A flat
 * `{ action: string; config: Record<string, unknown> }` would make
 * `isAutomationAction` vacuous — every malformed action would persist as
 * "valid" and crash the executor at run time, on the money path. Typing the
 * config is what makes the narrower mean something. The executors themselves
 * are #2361's; only the SHAPE is here.
 *
 * **`AUTOMATION_ACTION_IS_IRREVERSIBLE` lives here because irreversibility is a
 * property OF THE ACTION**, not of the gate that consumes it. #2362 reads this
 * map; it must not restate it. Spec §5.5 divergence 3: reversible actions all
 * fire when several rules match, irreversible ones obey the #2047 at-most-one
 * rule exactly — two emails are recoverable, two labels are not.
 *
 * **`place-hold` / `release-hold` name a `HoldReason` but invoke nothing here.**
 * The `order_holds` write is body A (#2338/#2339) wired by #2361; this file
 * compiles with zero dependency on that code.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.3, §5.3b
 */
import type { HoldReason} from '@openlinker/core/order-lifecycle';
import { isHoldReason } from '@openlinker/core/order-lifecycle';
import { isBuyerEmailTemplate, type BuyerEmailTemplate } from '@openlinker/core/identifier-mapping';

/**
 * The six v1 actions, in the spec's own A1–A6 order.
 *
 * - `issue-sales-document`    — A1, ADR-041 routing + the #2047 one-document guard.
 * - `dispatch-shipment`       — A2, `ShipmentDispatchService` (ADR-012).
 * - `relay-status-to-source`  — A3, the `OrderStatusWriteback` relay (ADR-027).
 * - `send-email`              — A4, the existing `MailerPort`.
 * - `place-hold`              — A5, `order_holds` (Wave 2).
 * - `release-hold`            — A6, `order_holds.releasedAt` (Wave 2).
 */
export const AutomationActionValues = [
  'issue-sales-document',
  'dispatch-shipment',
  'relay-status-to-source',
  'send-email',
  'place-hold',
  'release-hold',
  'add-gift',
] as const;

export type AutomationActionKind = (typeof AutomationActionValues)[number];

/** Coerce an untrusted value to the action union. No default. */
export function isAutomationActionKind(value: unknown): value is AutomationActionKind {
  return typeof value === 'string' && (AutomationActionValues as readonly string[]).includes(value);
}

/**
 * Whether an action cannot be undone once it has run (spec §5.5 divergence 3).
 *
 * A1 creates a fiscal document; A2 spends money and hands a parcel to a
 * carrier. Everything else is recoverable or harmless to repeat. **#2362's
 * at-most-one gate reads this map** rather than restating the split.
 */
export const AUTOMATION_ACTION_IS_IRREVERSIBLE = {
  'issue-sales-document': true,
  'dispatch-shipment': true,
  'relay-status-to-source': false,
  'send-email': false,
  'place-hold': false,
  'release-hold': false,
  // Adding a gift line is reversible until the parcel is closed (gifts spec 4.5).
  'add-gift': false,
} as const satisfies Record<AutomationActionKind, boolean>;

/** Whether this action must obey the #2047 at-most-one rule. */
export function isIrreversibleAction(action: AutomationActionKind): boolean {
  return AUTOMATION_ACTION_IS_IRREVERSIBLE[action];
}

/**
 * The §5.5 cap: "max 3 steps, run in order, stop on first failure". Unbounded
 * chaining is a scripting language with extra clicks. A rule with zero steps
 * does nothing and is equally refused — see `AutomationStepCountError`.
 */
export const AUTOMATION_ACTION_MAX_STEPS = 3;
export const AUTOMATION_ACTION_MIN_STEPS = 1;

/** A4's recipient — the buyer, or a fixed address the operator typed. */
export type AutomationEmailRecipient =
  | { readonly kind: 'buyer' }
  | { readonly kind: 'address'; readonly address: string };

/**
 * One step in a rule's ordered `actions` array. Discriminated on `action`;
 * each member carries exactly the parameters spec §5.3b declares for it.
 *
 * A1 and A3 take NO parameters, and that is deliberate rather than unfinished:
 * ADR-041 routing already owns document-kind selection (a second place to
 * choose it is a second answer that can disagree with the first), and the relay
 * sends what OL knows rather than an operator-picked status vocabulary.
 */
/**
 * How a sales document shows a gift (gifts spec section 8.2). Kept beside the
 * action rather than imported from `orders`, which already depends on this
 * context; a spec asserts the two lists are the same.
 */
export const AutomationGiftDocumentFormValues = [
  'technical-cent',
  'priced-in',
  'show-zero',
  'omit',
] as const;
export type AutomationGiftDocumentForm = (typeof AutomationGiftDocumentFormValues)[number];

/**
 * "For every unit bought" mode of a gift rule (gifts spec 4.1): the gift quantity
 * is `quantity x min(floor(units of the product / per), maxPerOrder)`.
 */
export interface AutomationGiftPerUnit {
  /** Internal product id whose units are counted. */
  readonly productId: string;
  /** Units of that product per gift batch; 1 is "every unit". */
  readonly per: number;
  /** Ceiling of gift batches in one order; `null` = none. */
  readonly maxPerOrder: number | null;
}

/**
 * Add a gift line (#3938). **Evaluated inline at ingestion**, not dispatched: the
 * gift has to exist before reservation and routing, which the dispatch seam runs
 * after. The options are part of the rule's identity (they enter the definition
 * hash); the mutable state - units given, pause - is not, and lives in
 * `automation_gift_rule_state`.
 */
export interface AutomationGiftAction {
  readonly action: 'add-gift';
  /** Internal product + variant of the gift line. */
  readonly productId: string;
  readonly variantId: string;
  /** Units per batch. */
  readonly quantity: number;
  readonly perUnit: AutomationGiftPerUnit | null;
  /** Unit cap for the whole rule; reaching it pauses the rule. `null` = no cap. */
  readonly unitCap: number | null;
  /** Skip when the gift product is already in the order (R5). */
  readonly skipIfPresent: boolean;
  /** A matching rule with this on stops the rules below it (R3). */
  readonly doNotCombine: boolean;
  /** Max gift units per resolved customer across all orders (R7); `null` = off. */
  readonly customerLimit: number | null;
  /** Per-gift document form; absent = "as in settings". */
  readonly documentForm?: AutomationGiftDocumentForm;
}

export type AutomationAction =
  | { readonly action: 'issue-sales-document' }
  | {
      readonly action: 'dispatch-shipment';
      readonly carrierId: string;
      readonly serviceId: string | null;
      readonly packagePresetId: string | null;
      readonly cashOnDelivery: boolean;
    }
  | { readonly action: 'relay-status-to-source' }
  | {
      readonly action: 'send-email';
      readonly recipient: AutomationEmailRecipient;
      readonly subject: string;
      readonly body: string;
      /**
       * Marks the step as one of the per-connection buyer emails (#3554). When
       * set, the send goes through the order connection's `config.buyerEmails`
       * opt-in and is recorded on the order timeline; it requires the `buyer`
       * recipient, since the opt-in is about emailing the buyer. Absent keeps
       * the plain A4 behaviour, byte-identical to before.
       */
      readonly buyerEmailTemplate?: BuyerEmailTemplate;
    }
  | { readonly action: 'place-hold'; readonly reason: HoldReason; readonly note: string }
  | {
      readonly action: 'release-hold';
      /** `null` = "any hold" (spec §5.3b A6's default). */
      readonly holdReason: HoldReason | null;
      readonly note: string;
    }
  | AutomationGiftAction;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isEmailRecipient(value: unknown): value is AutomationEmailRecipient {
  if (!isRecord(value)) return false;
  if (value.kind === 'buyer') return true;
  return value.kind === 'address' && isNonEmptyString(value.address);
}

/**
 * Narrow an untrusted value (a JSONB column read back from the repository) to
 * one well-formed `AutomationAction`. Returns `false` on any shape mismatch and
 * never throws — same contract as `isAutomationCondition`.
 */
export function isAutomationAction(value: unknown): value is AutomationAction {
  if (!isRecord(value)) return false;

  switch (value.action) {
    case 'issue-sales-document':
    case 'relay-status-to-source':
      return true;
    case 'dispatch-shipment':
      return (
        isNonEmptyString(value.carrierId) &&
        (value.serviceId === null || isNonEmptyString(value.serviceId)) &&
        (value.packagePresetId === null || isNonEmptyString(value.packagePresetId)) &&
        typeof value.cashOnDelivery === 'boolean'
      );
    case 'send-email':
      return (
        isEmailRecipient(value.recipient) &&
        typeof value.subject === 'string' &&
        isNonEmptyString(value.body) &&
        (value.buyerEmailTemplate === undefined ||
          (isBuyerEmailTemplate(value.buyerEmailTemplate) &&
            value.recipient.kind === 'buyer'))
      );
    case 'place-hold':
      return isHoldReason(value.reason) && typeof value.note === 'string';
    case 'release-hold':
      return (
        (value.holdReason === null || isHoldReason(value.holdReason)) &&
        // A6's note is REQUIRED — it mirrors the manual release (spec §5.3b).
        isNonEmptyString(value.note)
      );
    case 'add-gift':
      return isAutomationGiftAction(value);
    default:
      return false;
  }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Narrow an untyped value into a well-formed {@link AutomationGiftAction}. */
export function isAutomationGiftAction(value: unknown): value is AutomationGiftAction {
  if (!isRecord(value) || value.action !== 'add-gift') return false;
  if (!isNonEmptyString(value.productId) || !isNonEmptyString(value.variantId)) return false;
  if (!isPositiveInt(value.quantity)) return false;
  if (value.perUnit !== null) {
    if (!isRecord(value.perUnit)) return false;
    if (!isNonEmptyString(value.perUnit.productId) || !isPositiveInt(value.perUnit.per)) {
      return false;
    }
    if (value.perUnit.maxPerOrder !== null && !isPositiveInt(value.perUnit.maxPerOrder)) {
      return false;
    }
  }
  if (value.unitCap !== null && !isPositiveInt(value.unitCap)) return false;
  if (value.customerLimit !== null && !isPositiveInt(value.customerLimit)) return false;
  if (typeof value.skipIfPresent !== 'boolean' || typeof value.doNotCombine !== 'boolean') {
    return false;
  }
  return (
    value.documentForm === undefined ||
    (AutomationGiftDocumentFormValues as readonly unknown[]).includes(value.documentForm)
  );
}
