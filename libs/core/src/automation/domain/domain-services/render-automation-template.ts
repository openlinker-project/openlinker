/**
 * Automation Merge-Field Renderer (#2361, Wave-2 spec §5.3b)
 *
 * The closed list of merge fields an operator may drop into A4's subject
 * and body, and A5/A6's note. Pure — no I/O, no clock, no injected dependency.
 *
 * **Closed, because an open templating surface is a scripting language**, which
 * §6 refuses. Adding a tenth field is an edit here plus the composer's own list,
 * not a new expression syntax.
 *
 * **An unrecognised `{...}` renders VERBATIM, never blanked** (§5.3b). Blanking
 * silently produces an email that reads as broken; a visible `{ordr.reference}`
 * is a typo the operator can see and fix.
 *
 * **Single-brace `{order.reference}`, deliberately NOT `renderTemplate`'s
 * `{{token}}`** (`@openlinker/core/ai`). The two look interchangeable — both
 * leave unknown tokens alone — and are not: this syntax is what §5.3b specifies
 * and what the composer's help text shows an operator. Consolidating them would
 * silently change what every saved template renders, and would add an
 * `automation -> ai` sibling edge for a twelve-line function.
 *
 * @module libs/core/src/automation/domain/domain-services
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.3b
 */

/**
 * The values the nine fields render from. Every one is optional: the caller
 * assembles what it can, and an absent value renders the spec's stated fallback
 * rather than an empty string — *"not yet"* reads as a fact, `""` reads as a bug.
 */
export interface AutomationTemplateContext {
  readonly orderReference?: string;
  readonly orderTotal?: string;
  readonly orderPlacedAt?: string;
  readonly orderDispatchBy?: string;
  readonly holdReason?: string;
  readonly ruleName?: string;
}

/**
 * The merge fields this build can actually RESOLVE, in §5.3b's own order.
 * Exported so the composer offers exactly this list rather than restating it.
 *
 * **Deliberately six, not the spec's nine.** Three of §5.3b's fields have no
 * resolvable source in this slice, and offering a field that can never render
 * anything but its fallback is a promise the composer makes and the backend
 * cannot keep — the same "declare only what the destination DECLARES" rule the
 * bulk-wizard blocker seam states for its own mirrors. They return when the data
 * does:
 *
 * - **`{order.source}`** — §5.3b defines it as *the channel name* ("Allegro").
 *   Automation holds only a `sourceConnectionId`, and rendering that UUID would
 *   put an unreadable identifier in a buyer-facing email — worse than omitting
 *   the field, because it looks like a value rather than a gap. Needs a
 *   connection-name read.
 * - **`{buyer.name}`** — no name getter on the order snapshot, and it is
 *   PII-gated besides.
 * - **`{shipment.tracking}`** — the shipping context is not reached from here;
 *   A2 (buy the label) is itself unavailable in this slice.
 *
 * An operator who types one of the three still sees it rendered VERBATIM by the
 * rule below, which is the honest outcome: a visible `{buyer.name}` reads as
 * "this is not supported", where the fallback text `unknown` would read as a
 * fact about the buyer.
 */
export const AUTOMATION_MERGE_FIELDS = [
  'order.reference',
  'order.total',
  'order.placedAt',
  'order.dispatchBy',
  'hold.reason',
  'rule.name',
] as const;

export type AutomationMergeField = (typeof AUTOMATION_MERGE_FIELDS)[number];

/** Per-field fallback copy, verbatim from §5.3b where the spec states one. */
const FALLBACKS: Record<AutomationMergeField, string> = {
  'order.reference': 'unknown',
  'order.total': 'unknown',
  'order.placedAt': 'unknown',
  'order.dispatchBy': 'no deadline',
  'hold.reason': 'no hold',
  'rule.name': 'unknown',
};

function valueOf(
  field: AutomationMergeField,
  context: AutomationTemplateContext,
): string | undefined {
  switch (field) {
    case 'order.reference':
      return context.orderReference;
    case 'order.total':
      return context.orderTotal;
    case 'order.placedAt':
      return context.orderPlacedAt;
    case 'order.dispatchBy':
      return context.orderDispatchBy;
    case 'hold.reason':
      return context.holdReason;
    case 'rule.name':
      return context.ruleName;
  }
}

function isMergeField(token: string): token is AutomationMergeField {
  return (AUTOMATION_MERGE_FIELDS as readonly string[]).includes(token);
}

/**
 * Substitute the nine known fields; leave every other `{...}` exactly as typed.
 *
 * The pattern deliberately matches only `{` + non-brace run + `}` so a stray
 * unclosed brace is left alone rather than swallowing the rest of the body.
 */
export function renderAutomationTemplate(
  template: string,
  context: AutomationTemplateContext,
): string {
  return template.replace(/\{([^{}]*)\}/g, (whole, rawToken: string) => {
    const token = rawToken.trim();
    if (!isMergeField(token)) {
      return whole;
    }
    const value = valueOf(token, context);
    return value !== undefined && value !== '' ? value : FALLBACKS[token];
  });
}
