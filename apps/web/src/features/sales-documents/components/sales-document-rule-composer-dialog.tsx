/**
 * Sales-Document Rule Composer (#2170, mockup tab 02 "+ Add rule", redesigned
 * per review — spacing/hierarchy + warning-density findings)
 *
 * Document type stays EXACTLY two-valued — Invoice / Receipt — never a third
 * "Receipt with NIP" option (the independent-review correction the mockup's
 * own tab 02 documents). There is no "include the buyer's tax ID on the
 * receipt" toggle (#3182, epic #3173 tab 05): if the order carries a tax ID
 * it goes to the adapter unconditionally, so no property on the rule or the
 * routing decision was ever needed — the value travels with the order the
 * way the currency does. `Customer tax ID` survives purely as a condition
 * (`buyerHasTaxId` above).
 *
 * Always opened from `SalesDocumentRulesList`, which in turn only ever
 * renders inside `SalesDocumentCountryRoutingDialog` (#2188) - so this
 * dialog is always a nested dialog, never a top-level one. Its `DialogContent`
 * therefore carries the `--elevated` tier unconditionally (matching
 * `bulk-edit-modal.tsx` / `shop-category-picker-modal.tsx` / the discard-guard
 * `ConfirmDialog`), since the base overlay z-index (40) sits below any dialog
 * content (50) and would otherwise leave the routing dialog undimmed behind
 * this one.
 *
 * TWO REVIEW FINDINGS closed here, both about the SAME root cause: the form
 * had no visual grouping at all — every field, label, and full-width warning
 * `Alert` sat in one flat flex column with only a 2-column grid breaking up
 * pairs, so an operator could not tell "conditions" from "what this rule
 * does" from "when it applies" at a glance.
 *
 *  1. **Bordered `.rule-composer-section` cards** (the `.sales-document-tier`
 *     precedent from the routing dialog) now group Conditions / Document &
 *     destination / Effective window into three visually distinct blocks
 *     with consistent internal spacing, rather than one continuous column.
 *  2. **The buyerHasTaxId coverage warning is a tooltip-triggered glyph, not
 *     a full-width `Alert` per row.** A rule with 3 tax-ID conditions used to
 *     render the IDENTICAL multi-line warning box 3 times in a row - the
 *     same fact, repeated verbatim, dominating the whole dialog. A small
 *     `WarningGlyph` beside the row states "this needs a caveat" at a
 *     glance; the caveat itself is one hover/focus away via `Tooltip`,
 *     never duplicated as a wall of orange boxes. The fact represented is
 *     unchanged - only its density is.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useState, type ReactElement } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../../../shared/ui/dialog';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { Input } from '../../../shared/ui/input';
import { Alert } from '../../../shared/ui/alert';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../shared/ui/tooltip';
import { useConnectionsQuery } from '../../connections';
import { selectInvoicingCandidates } from '../../invoicing';
import { selectFiscalizationCandidates } from '../../fiscalization';
import { useCreateSalesDocumentRuleMutation } from '../hooks/use-create-sales-document-rule-mutation';
import type {
  CreateSalesDocumentRuleInput,
  SalesDocumentConditionInput,
} from '../api/sales-document-rules.types';
import type { SalesDocumentKind } from '../api/sales-documents.types';
import { describeSalesDocumentRuleDraft } from '../lib/describe-sales-document-rule-draft';
import { useSalesDocumentRuleOverlapQuery } from '../hooks/use-sales-document-rule-overlap-query';
import { useSalesDocumentRulesQuery } from '../hooks/use-sales-document-rules-query';
import {
  describeSalesDocumentOverlapClear,
  describeSalesDocumentOverlapConflict,
  describeSalesDocumentOverlapUndecided,
} from '../lib/describe-sales-document-overlap';

interface SalesDocumentRuleComposerDialogProps {
  country: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Reveal an existing rule in the list behind the dialog (#3190). Optional,
   * and the "Open that rule" affordance renders ONLY when it is supplied - a
   * control the surrounding page cannot serve is dead code that type-checks.
   */
  onOpenRule?: (ruleId: string) => void;
}

type ConditionKind = 'buyerHasTaxId' | 'orderCountry' | 'orderTotalGross';

interface ConditionDraft {
  kind: ConditionKind;
  boolValue: boolean;
  stringValue: string;
  op: 'gte' | 'lt';
  /**
   * Typed by the operator, kept as the STRING they typed (#3189). Never parsed
   * into a number on the way through: the value is persisted as a decimal
   * string and shown back verbatim, so rounding it here would change what the
   * rule says without telling anyone.
   */
  amount: string;
  currency: string;
}

function newConditionDraft(): ConditionDraft {
  return {
    kind: 'buyerHasTaxId',
    // `true`, not `false` (#3189). `buyerHasTaxId` reads `false` only for a
    // buyer positively asserted to have NO tax id, and no shipped order source
    // can produce that state - an absent or blank value is *unknown*, which
    // compares unequal to both. A draft defaulting to `false` therefore starts
    // every operator on a condition that cannot match a real order, which is
    // the same defect the dead `no-tax-id` starter rule had, one surface over.
    boolValue: true,
    stringValue: '',
    op: 'gte',
    amount: '',
    // No default currency. Guessing one would put a market's currency on a rule
    // the operator did not write it for, and a mismatched currency silently
    // never matches - the exact failure this composer exists to make visible.
    currency: '',
  };
}

function toConditionInput(draft: ConditionDraft): SalesDocumentConditionInput {
  if (draft.kind === 'buyerHasTaxId') {
    return { field: 'buyerHasTaxId', op: 'eq', boolValue: draft.boolValue };
  }
  if (draft.kind === 'orderCountry') {
    return { field: 'orderCountry', op: 'eq', stringValue: draft.stringValue };
  }
  return {
    field: 'orderTotalGross',
    op: draft.op,
    amount: draft.amount.trim(),
    currency: draft.currency.trim().toUpperCase(),
  };
}

/** A small triangle-in-circle glyph — the trigger for a per-row caveat tooltip, never a full-width banner. */
function WarningGlyph(): ReactElement {
  return (
    <svg
      className="rule-composer-warning-glyph"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        d="M8 1.5 14.8 13.5H1.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 6.2v3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.3" r="0.9" fill="currentColor" />
    </svg>
  );
}

function BuyerTaxIdCoverageWarning(): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="rule-composer-warning-trigger"
          aria-label="Coverage caveat for this condition"
        >
          <WarningGlyph />
        </button>
      </TooltipTrigger>
      <TooltipContent className="rule-composer-warning-tooltip" side="top">
        Only some sources report this today: a PrestaShop order carries a real tax-ID status
        (present, or explicitly none). An Allegro or WooCommerce order reports neither — this
        condition will never match those, and the order falls through to the next tier instead.
      </TooltipContent>
    </Tooltip>
  );
}

export function SalesDocumentRuleComposerDialog({
  country,
  open,
  onOpenChange,
  onOpenRule,
}: SalesDocumentRuleComposerDialogProps): ReactElement {
  const connectionsQuery = useConnectionsQuery();
  const createRule = useCreateSalesDocumentRuleMutation();

  const [conditions, setConditions] = useState<ConditionDraft[]>([newConditionDraft()]);
  const [documentKind, setDocumentKind] = useState<SalesDocumentKind>('invoice');
  const [connectionId, setConnectionId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState('');

  // #3190. The engine has no priorities: two matching rules HOLD the order
  // rather than one winning, and today that is discovered days later as a
  // hanging order. Asked here, while there is still somebody to tell.
  //
  // Only asked once the draft is answerable: a half-typed amount, or an
  // amount with no currency yet, describes no order set at all, so checking it
  // would produce a verdict about a rule the operator has not written.
  const conditionsAreAnswerable = conditions.every((condition) => {
    if (condition.kind === 'orderTotalGross') {
      return condition.amount.trim() !== '' && condition.currency.trim() !== '';
    }
    if (condition.kind === 'orderCountry') return condition.stringValue.trim() !== '';
    return true;
  });
  const overlapQuery = useSalesDocumentRuleOverlapQuery(
    {
      country,
      conditions: conditions.map(toConditionInput),
      effectiveFrom,
      effectiveTo: effectiveTo.trim().length > 0 ? effectiveTo : null,
    },
    open && conditionsAreAnswerable
  );
  // Rival copy names the operator's own rule text rather than an opaque id.
  // This read is the one the list behind the dialog already made, so it is a
  // cache hit rather than a second round trip.
  const rulesQuery = useSalesDocumentRulesQuery(country);
  const rivals = (rulesQuery.data ?? []).map((rule) => ({
    ruleId: rule.id,
    conditions: rule.conditions,
    documentKind: rule.documentKind,
  }));
  const verdict = overlapQuery.data;
  const conflicts = verdict?.overlapping ?? [];
  const undecided = verdict?.undecided ?? [];
  const clears = verdict?.disjoint ?? [];
  // Mutually exclusive by construction: a proven collision outranks a proven
  // non-collision, so the two banners can never both render.
  const hasConflict = conflicts.length > 0;

  const connections = connectionsQuery.data ?? [];
  const candidates =
    documentKind === 'invoice'
      ? selectInvoicingCandidates(connections)
      : selectFiscalizationCandidates(connections);

  function reset(): void {
    setConditions([newConditionDraft()]);
    setDocumentKind('invoice');
    setConnectionId('');
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setEffectiveTo('');
    createRule.reset();
  }

  async function handleSave(): Promise<void> {
    const input: CreateSalesDocumentRuleInput = {
      country,
      conditions: conditions.map(toConditionInput),
      documentKind,
      connectionId,
      effectiveFrom,
      effectiveTo: effectiveTo.trim().length > 0 ? effectiveTo : null,
      provenance: null,
    };
    try {
      await createRule.mutateAsync(input);
      reset();
      onOpenChange(false);
    } catch {
      // Error rendered from createRule.error below (conflict / capability mismatch).
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="dialog__content--elevated"
        overlayClassName="dialog__overlay--elevated"
        style={{ maxWidth: '32rem' }}
      >
        <DialogTitle>Add rule</DialogTitle>

        {createRule.error ? <Alert tone="error">{createRule.error.message}</Alert> : null}

        <section className="rule-composer-section">
          <header className="rule-composer-section__header">
            <p className="eyebrow">Conditions</p>
            <p className="muted-text">
              Every added condition must ALL be true for this rule to match (AND).
            </p>
          </header>

          <div className="rule-composer-conditions">
            {conditions.map((condition, index) => (
              <div key={index} className="rule-composer-condition-row">
                <Select
                  aria-label="Condition field"
                  value={condition.kind}
                  onChange={(event) => {
                    const kind = event.target.value as ConditionKind;
                    setConditions((prev) =>
                      prev.map((c, i) => (i === index ? { ...newConditionDraft(), kind } : c))
                    );
                  }}
                >
                  <option value="buyerHasTaxId">Buyer has a tax ID</option>
                  <option value="orderCountry">Order country is</option>
                  <option value="orderTotalGross">Order total (gross)</option>
                </Select>

                {condition.kind === 'buyerHasTaxId' ? (
                  <Select
                    aria-label="Buyer has a tax ID value"
                    value={String(condition.boolValue)}
                    onChange={(event) =>
                      setConditions((prev) =>
                        prev.map((c, i) =>
                          i === index ? { ...c, boolValue: event.target.value === 'true' } : c
                        )
                      )
                    }
                  >
                    <option value="true">yes</option>
                    <option value="false">no</option>
                  </Select>
                ) : null}

                {condition.kind === 'orderCountry' ? (
                  <Input
                    aria-label="Order country value"
                    value={condition.stringValue}
                    placeholder="e.g. PL"
                    onChange={(event) =>
                      setConditions((prev) =>
                        prev.map((c, i) =>
                          i === index ? { ...c, stringValue: event.target.value.toUpperCase() } : c
                        )
                      )
                    }
                  />
                ) : null}

                {condition.kind === 'orderTotalGross' ? (
                  <div className="rule-composer-condition-row__threshold">
                    <Select
                      aria-label="Order total comparison"
                      value={condition.op}
                      onChange={(event) =>
                        setConditions((prev) =>
                          prev.map((c, i) =>
                            i === index ? { ...c, op: event.target.value as 'gte' | 'lt' } : c
                          )
                        )
                      }
                    >
                      <option value="gte">≥</option>
                      <option value="lt">&lt;</option>
                    </Select>
                    <Input
                      aria-label="Order total amount"
                      inputMode="decimal"
                      placeholder="450.00"
                      value={condition.amount}
                      onChange={(event) =>
                        setConditions((prev) =>
                          prev.map((c, i) =>
                            i === index ? { ...c, amount: event.target.value } : c
                          )
                        )
                      }
                    />
                    <Input
                      aria-label="Order total currency"
                      placeholder="PLN"
                      maxLength={3}
                      value={condition.currency}
                      onChange={(event) =>
                        setConditions((prev) =>
                          prev.map((c, i) =>
                            i === index ? { ...c, currency: event.target.value.toUpperCase() } : c
                          )
                        )
                      }
                    />
                  </div>
                ) : null}

                {condition.kind === 'buyerHasTaxId' ? <BuyerTaxIdCoverageWarning /> : <span />}
              </div>
            ))}
          </div>

          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => setConditions((prev) => [...prev, newConditionDraft()])}
          >
            + Add condition
          </Button>
          <p className="muted-text rule-composer-section__footnote">
            The underlying <span className="mono-text">field</span> is one closed, cross-country
            vocabulary — never a country-specific string.
          </p>
        </section>

        <section className="rule-composer-section">
          <header className="rule-composer-section__header">
            <p className="eyebrow">Document &amp; destination</p>
          </header>
          <div className="frame-grid frame-grid--2">
            <div>
              <label className="eyebrow" htmlFor="sd-rule-doctype" style={{ marginBottom: 2 }}>
                Document type
              </label>
              <Select
                id="sd-rule-doctype"
                value={documentKind}
                onChange={(event) => {
                  setDocumentKind(event.target.value as SalesDocumentKind);
                  setConnectionId('');
                }}
              >
                <option value="invoice">Invoice</option>
                <option value="fiscal-receipt">Receipt</option>
              </Select>
            </div>
            <div>
              <label className="eyebrow" htmlFor="sd-rule-connection" style={{ marginBottom: 2 }}>
                Integration
              </label>
              <Select
                id="sd-rule-connection"
                value={connectionId}
                onChange={(event) => setConnectionId(event.target.value)}
              >
                <option value="">Select a connection…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </section>

        <section className="rule-composer-section">
          <header className="rule-composer-section__header">
            <p className="eyebrow">Effective window</p>
          </header>
          <div className="frame-grid frame-grid--2">
            <div>
              <label className="eyebrow" htmlFor="sd-rule-from" style={{ marginBottom: 2 }}>
                Effective from
              </label>
              <Input
                id="sd-rule-from"
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </div>
            <div>
              <label className="eyebrow" htmlFor="sd-rule-to" style={{ marginBottom: 2 }}>
                Effective to <span className="text-muted">(optional)</span>
              </label>
              <Input
                id="sd-rule-to"
                type="date"
                value={effectiveTo}
                onChange={(event) => setEffectiveTo(event.target.value)}
              />
            </div>
          </div>
        </section>

        {/*
          The whole rule in one sentence (#3189). The composer collects it
          across three sections and nothing showed the assembled result, so a
          rule with an unset currency or a window opening tomorrow could be
          saved and only discovered when orders started falling through. It
          fills no gap in - an unchosen value says so.

          Deliberately NOT a fourth `.rule-composer-section`: the mockup frames
          it as its own accent block beside the three steps ("the accent stays
          where it should be rare - on the save button and the readback
          frame"), and the section count is asserted, so a fourth card would
          both misread the design and break that assertion.
        */}
        <div className="rule-composer-readback">
          <p className="eyebrow rule-composer-readback__eyebrow">This rule says</p>
          <p data-testid="rule-readback" className="rule-composer-readback__sentence">
            {describeSalesDocumentRuleDraft({
              conditions: conditions.map(toConditionInput),
              documentKind,
              connectionName: candidates.find((c) => c.id === connectionId)?.name ?? null,
              effectiveFrom,
              effectiveTo,
            })}
          </p>
          {/*
            Stated once, here, rather than on every currency control: an amount
            is compared and never converted, so an order priced in another
            currency does not match and falls through to the next tier.
          */}
          <p className="muted-text rule-composer-readback__hint">
            Orders priced in another currency do not match this rule.
          </p>
        </div>

        {hasConflict ? (
          <div data-testid="rule-conflict">
            <Alert tone="error" title="This could match the same order as an existing rule">
              <p>
                {describeSalesDocumentOverlapConflict(
                  conflicts.map((hit) => hit.ruleId),
                  rivals
                )}
              </p>
              {onOpenRule !== undefined ? (
                <Button
                  tone="secondary"
                  className="button--sm"
                  data-testid="rule-conflict-open-existing"
                  onClick={() => {
                    onOpenRule(conflicts[0].ruleId);
                    onOpenChange(false);
                  }}
                >
                  Open that rule
                </Button>
              ) : null}
            </Alert>
          </div>
        ) : null}

        {/*
          The positive statement, and only when nothing collides - two rules in
          different currencies provably cannot both match, which an operator
          cannot otherwise tell from an absent warning.
        */}
        {!hasConflict && clears.length > 0 ? (
          <div data-testid="rule-no-conflict">
            <Alert tone="info">
              {clears.map((hit) => (
                <p key={hit.ruleId}>
                  {describeSalesDocumentOverlapClear(
                    hit.reason,
                    rivals.find((r) => r.ruleId === hit.ruleId),
                    hit.ruleId
                  )}
                </p>
              ))}
            </Alert>
          </div>
        ) : null}

        {/*
          The third outcome. Rendered beside either of the two above rather
          than instead of them: an undecided pair is not reassurance, and
          folding it into silence is the exact failure this check removes.
        */}
        {/*
          The FOURTH state, and the one an empty verdict silently impersonates:
          the check could not run at all. `verdict` is then `undefined` and all
          three arrays fall back to `[]`, which renders as no banner - i.e. as
          "no conflict", the single answer this check exists to make
          impossible. Absence and failure must not be the same pixel (the rule
          the returns surfaces already hold: an empty array is never a positive
          claim).

          It does NOT block the save, matching the undecided banner beside it:
          a failed check is not evidence of a collision, and the runtime still
          holds an ambiguous order either way. What it must not do is stay
          quiet.
        */}
        {overlapQuery.isError ? (
          <div data-testid="rule-overlap-unavailable">
            <Alert tone="warning" title="We could not run the overlap check">
              <p>
                This rule has not been compared against the others in this market. Saving is still
                allowed, and an order matched by two rules is held rather than given the wrong
                document.
              </p>
            </Alert>
          </div>
        ) : null}
        {undecided.length > 0 ? (
          <div data-testid="rule-overlap-undecided">
            <Alert tone="warning" title="We could not check every rule">
              {undecided.map((hit) => (
                <p key={hit.ruleId}>
                  {describeSalesDocumentOverlapUndecided(
                    hit.reason,
                    rivals.find((r) => r.ruleId === hit.ruleId),
                    hit.ruleId
                  )}
                </p>
              ))}
            </Alert>
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          {/*
            The testid swaps with the state, matching the mockup: a blocked
            save is a different thing to assert on than an available one, and
            an e2e that only ever saw `rule-save` could not tell them apart.
          */}
          <Button
            className="button--sm"
            data-testid={hasConflict ? 'rule-save-blocked' : 'rule-save'}
            disabled={createRule.isPending || connectionId === '' || hasConflict}
            onClick={() => void handleSave()}
          >
            {createRule.isPending ? 'Saving…' : 'Save rule'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
