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
 * OVERLAP GATE (#3190, and its review): the save is inert unless the check has
 * ANSWERED about the draft on screen. That is one sentence and it was the
 * whole defect - the first version derived its gate from `overlapQuery.data`
 * alone, so any keystroke changed the query key, reset `data` to `undefined`,
 * emptied all three verdict arrays and re-rendered the button as enabled with
 * no banner. A colliding rule saved on the common path, no network fault
 * required. The states are named in `use-sales-document-rule-overlap-query.ts`
 * and every one of them that is not an answer withholds the save, except
 * `unavailable` - a failed check is not evidence of a collision.
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
import { useDryRunSalesDocumentRuleMutation } from '../hooks/use-dry-run-sales-document-rule-mutation';
import type {
  CreateSalesDocumentRuleInput,
  SalesDocumentConditionInput,
} from '../api/sales-document-rules.types';
import type { ConcreteDocumentKind } from '../api/sales-documents.types';
import { describeSalesDocumentRuleDraft } from '../lib/describe-sales-document-rule-draft';
import { useSalesDocumentRuleOverlapQuery } from '../hooks/use-sales-document-rule-overlap-query';
import { useSalesDocumentRulesQuery } from '../hooks/use-sales-document-rules-query';
import {
  SALES_DOCUMENT_OVERLAP_CONSEQUENCE,
  describeSalesDocumentOverlapClear,
  describeSalesDocumentOverlapConflictRival,
  describeSalesDocumentOverlapUndecided,
} from '../lib/describe-sales-document-overlap';
import { describeSalesDocumentDryRunResult } from '../lib/describe-sales-document-dry-run-result';

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

/**
 * The server's OWN shapes, mirrored (#3190 review, the reported-is-enforced
 * discipline of #2229).
 *
 * `apps/web` cannot import `@openlinker/core` (#591), so these are copies of
 * `isDecimalAmountString` / `isCurrencyCode`
 * (`libs/core/src/sales-documents/domain/types/sales-document-condition.types.ts`),
 * which `SalesDocumentConditionDto.toDomain` throws a 400 on. Testing
 * non-emptiness instead - what this gate did before - meant that typing `PLN`
 * one character at a time sent `"P"` then `"PL"`, each a 400, and with the
 * production client's `retry: false` the first failure painted a banner saying
 * the check could not RUN. That is a false statement about infrastructure when
 * the real cause is an unfinished field.
 *
 * Deliberately no `check-*-mirror.mjs`: these are the two shapes the DTO's own
 * 400 message quotes back verbatim, so a drift surfaces as that message rather
 * than as silence - and a mirror STRICTER than the gate would refuse a draft
 * the server accepts, which is the failure #2240 records.
 */
const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d+)?$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** Would the server accept this condition, or 400 it? */
function conditionIsWellFormed(draft: ConditionDraft): boolean {
  if (draft.kind === 'orderTotalGross') {
    return (
      DECIMAL_AMOUNT_PATTERN.test(draft.amount.trim()) &&
      CURRENCY_CODE_PATTERN.test(draft.currency.trim().toUpperCase())
    );
  }
  if (draft.kind === 'orderCountry') return draft.stringValue.trim() !== '';
  return true;
}

/**
 * Two amount conditions in different currencies (#3190 review).
 *
 * `detect-sales-document-rule-overlap.ts` says in as many words that refusing
 * this "belongs in the composer", and nothing did it: `+ Add condition`
 * appended with no duplicate-field guard, so an operator could author a rule
 * the server accepts and that matches NO order at all - the detector answering
 * `multi-currency-rule` once per rival, a sentence that reads as though the
 * rival were at fault.
 */
function draftHasMixedCurrencies(conditions: readonly ConditionDraft[]): boolean {
  const currencies = new Set(
    conditions
      .filter((c) => c.kind === 'orderTotalGross')
      .map((c) => c.currency.trim().toUpperCase())
      .filter((currency) => currency !== '')
  );
  return currencies.size > 1;
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
    // Trimmed, for parity with the amount branch below (#3190 review). A
    // whitespace-only value passed the server's old non-empty check, was then
    // normalised to `''`, and the rule repository's own `toDomain` filtered the
    // condition out on read - leaving a rule with no conditions, which matches
    // EVERY order in the market. The server refuses it now; this stops the
    // browser being the thing that sends it.
    return { field: 'orderCountry', op: 'eq', stringValue: draft.stringValue.trim() };
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
  const dryRun = useDryRunSalesDocumentRuleMutation();

  const [conditions, setConditions] = useState<ConditionDraft[]>([newConditionDraft()]);
  const [documentKind, setDocumentKind] = useState<ConcreteDocumentKind>('invoice');
  const [connectionId, setConnectionId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState('');

  // #3190. The engine has no priorities: two matching rules HOLD the order
  // rather than one winning, and today that is discovered days later as a
  // hanging order. Asked here, while there is still somebody to tell.
  //
  // Only asked once the draft is a rule the server would accept AND one that
  // could match an order at all: a half-typed amount describes no order set,
  // and an amount bounded in two currencies matches nothing whatever the
  // rivals say, so either would produce a verdict about a rule the operator
  // has not written.
  const draftIsWellFormed = conditions.every(conditionIsWellFormed);
  const mixedCurrencies = draftHasMixedCurrencies(conditions);
  const draftIsCheckable = draftIsWellFormed && !mixedCurrencies;
  const overlap = useSalesDocumentRuleOverlapQuery(
    {
      country,
      conditions: conditions.map(toConditionInput),
      effectiveFrom,
      effectiveTo: effectiveTo.trim().length > 0 ? effectiveTo : null,
    },
    open && draftIsCheckable
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
  const { verdict, state: overlapState } = overlap;
  const conflicts = verdict?.overlapping ?? [];
  const undecided = verdict?.undecided ?? [];
  const clears = verdict?.disjoint ?? [];
  // Mutually exclusive by construction: a proven collision outranks a proven
  // non-collision, so the two banners can never both render.
  //
  // The asymmetry with `overlapState` is the point, and it is one rule: a
  // WARNING drawn from the last verdict stays on screen while the next check
  // runs, and REASSURANCE does not. A conflict banner that blinks out on every
  // keystroke is the hole this feature was shipped with; a "these cannot
  // collide" banner left standing over a draft that has since changed is a
  // claim nothing has checked.
  const checkAnswered = overlapState === 'known';
  const overlapBlocksSave = checkAnswered && conflicts.length > 0;
  // `unavailable` deliberately does NOT block - a failed check is not evidence
  // of a collision, and the runtime holds an ambiguous order either way. Every
  // other non-answer does, because on those the draft simply has not been
  // checked yet and an enabled save is the defect, not the feature.
  const overlapWithholdsSave =
    overlapState === 'incomplete' || overlapState === 'settling' || overlapState === 'pending';
  const recheckInFlight = overlapState === 'settling' || overlapState === 'pending';

  // "Test with a sample order" — never persists anything; the sample fields
  // are local to this dialog and default to the market this composer is
  // already scoped to, since testing a rule against an order in a country it
  // could not be scoped under is a configuration mistake the composer should
  // not invite by defaulting elsewhere.
  const [sampleOrderOpen, setSampleOrderOpen] = useState(false);
  const [sampleCountry, setSampleCountry] = useState(country);
  const [sampleAmount, setSampleAmount] = useState('');
  const [sampleCurrency, setSampleCurrency] = useState('');
  const [sampleBuyerHasTaxId, setSampleBuyerHasTaxId] = useState<'unknown' | 'yes' | 'no'>('unknown');
  // Defaults to gross-priced ('inclusive') — the common case, and the only
  // value an `orderTotalGross` condition can ever match against (see
  // checkAmountConditionDataProblem). Leaving this unset silently held every
  // amount-threshold rule as "net-priced, cannot compare" regardless of the
  // typed amount, making the flagship PL threshold rule untestable here.
  const [sampleTaxTreatment, setSampleTaxTreatment] = useState<'inclusive' | 'exclusive'>(
    'inclusive',
  );

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
    setSampleOrderOpen(false);
    setSampleCountry(country);
    setSampleAmount('');
    setSampleCurrency('');
    setSampleBuyerHasTaxId('unknown');
    setSampleTaxTreatment('inclusive');
    dryRun.reset();
  }

  function handleDryRun(): void {
    const totalGross = Number.parseFloat(sampleAmount);
    // Guarded by the button's own `disabled` below — a malformed sample can
    // never reach the request.
    if (!Number.isFinite(totalGross) || sampleCurrency.trim().length === 0) return;
    dryRun.mutate({
      country,
      conditions: conditions.map(toConditionInput),
      documentKind,
      connectionId,
      sampleOrder: {
        country: sampleCountry.trim().toUpperCase(),
        totalGross,
        currency: sampleCurrency.trim().toUpperCase(),
        taxTreatment: sampleTaxTreatment,
        buyerHasTaxId: sampleBuyerHasTaxId === 'unknown' ? undefined : sampleBuyerHasTaxId === 'yes',
      },
    });
  }

  /**
   * The one sentence explaining a withheld save, or `null` when the save is
   * available or the reason is already a banner.
   *
   * A conflict is NOT named here - it has its own error `Alert` naming the
   * rival - and neither is a missing connection, which the `Integration` select
   * states by sitting on its placeholder.
   */
  const saveWithheldReason: string | null = mixedCurrencies
    ? 'This rule bounds the order total in more than one currency, so it would never match an order. Use one currency.'
    : !draftIsWellFormed
      ? 'Finish every condition before saving - an amount needs a number and a three-letter currency, and a country needs a code.'
      : recheckInFlight
        ? 'Checking this draft against the other rules in this market…'
        : null;

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

          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <Button
              tone="secondary"
              className="button--sm"
              onClick={() => setConditions((prev) => [...prev, newConditionDraft()])}
            >
              + Add condition
            </Button>
            <Button
              tone="secondary"
              className="button--sm"
              data-testid="rule-test-sample-order"
              onClick={() => setSampleOrderOpen((prev) => !prev)}
            >
              Test with a sample order
            </Button>
          </div>
          <p className="muted-text rule-composer-section__footnote">
            The underlying <span className="mono-text">field</span> is one closed, cross-country
            vocabulary — never a country-specific string.
          </p>

          {sampleOrderOpen ? (
            <div className="rule-composer-dry-run" data-testid="rule-test-sample-order-panel">
              <p className="eyebrow" style={{ marginBottom: 6 }}>
                Sample order
              </p>
              <div className="frame-grid frame-grid--2">
                <Input
                  aria-label="Sample order delivery country"
                  placeholder="e.g. PL"
                  value={sampleCountry}
                  onChange={(event) => setSampleCountry(event.target.value.toUpperCase())}
                />
                <Select
                  aria-label="Sample order buyer has a tax ID"
                  value={sampleBuyerHasTaxId}
                  onChange={(event) =>
                    setSampleBuyerHasTaxId(event.target.value as 'unknown' | 'yes' | 'no')
                  }
                >
                  <option value="unknown">Buyer tax ID: unknown</option>
                  <option value="yes">Buyer tax ID: present</option>
                  <option value="no">Buyer tax ID: none</option>
                </Select>
                <Input
                  aria-label="Sample order total amount"
                  inputMode="decimal"
                  placeholder="450.00"
                  value={sampleAmount}
                  onChange={(event) => setSampleAmount(event.target.value)}
                />
                <Input
                  aria-label="Sample order currency"
                  placeholder="PLN"
                  maxLength={3}
                  value={sampleCurrency}
                  onChange={(event) => setSampleCurrency(event.target.value.toUpperCase())}
                />
                <Select
                  aria-label="Sample order pricing"
                  value={sampleTaxTreatment}
                  onChange={(event) =>
                    setSampleTaxTreatment(event.target.value as 'inclusive' | 'exclusive')
                  }
                >
                  <option value="inclusive">Gross-priced (VAT included)</option>
                  <option value="exclusive">Net-priced (VAT excluded)</option>
                </Select>
              </div>
              <p className="muted-text" style={{ marginTop: 'var(--space-1)' }}>
                An amount-threshold condition can only be compared against a gross-priced order —
                pick net-priced to see how the rule holds an order it cannot evaluate.
              </p>

              <div className="row" style={{ marginTop: 'var(--space-2)' }}>
                <Button
                  className="button--sm"
                  data-testid="rule-run-sample-order-test"
                  disabled={
                    dryRun.isPending ||
                    connectionId === '' ||
                    sampleAmount.trim().length === 0 ||
                    sampleCurrency.trim().length === 0 ||
                    sampleCountry.trim().length === 0
                  }
                  onClick={handleDryRun}
                >
                  {dryRun.isPending ? 'Testing…' : 'Run test'}
                </Button>
              </div>

              {dryRun.error ? (
                <Alert tone="error" data-testid="rule-test-sample-order-error">
                  {dryRun.error.message}
                </Alert>
              ) : null}

              {dryRun.data ? (
                <p data-testid="rule-test-sample-order-result" className="muted-text" style={{ marginTop: 'var(--space-2)' }}>
                  {describeSalesDocumentDryRunResult(dryRun.data, (id) =>
                    candidates.find((c) => c.id === id)?.name ?? null,
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
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
                  setDocumentKind(event.target.value as ConcreteDocumentKind);
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

        {conflicts.length > 0 ? (
          <div data-testid="rule-conflict">
            <Alert tone="error" title="This could match the same order as an existing rule">
              {/*
                One row per rival, each with its OWN reveal control. A single
                sentence naming three rivals beside a button that opened only
                the first was a claim the control could not honour.
              */}
              <ul className="rule-conflict-list">
                {conflicts.map((hit) => (
                  <li key={hit.ruleId} className="rule-conflict-list__item">
                    <span>
                      {describeSalesDocumentOverlapConflictRival(
                        rivals.find((r) => r.ruleId === hit.ruleId),
                        hit.ruleId
                      )}
                    </span>
                    {onOpenRule !== undefined ? (
                      <Button
                        tone="secondary"
                        className="button--sm"
                        data-testid="rule-conflict-open-existing"
                        onClick={() => {
                          onOpenRule(hit.ruleId);
                          onOpenChange(false);
                        }}
                      >
                        Show that rule
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p>{SALES_DOCUMENT_OVERLAP_CONSEQUENCE}</p>
            </Alert>
          </div>
        ) : null}

        {/*
          The positive statement, and only when nothing collides - two rules in
          different currencies provably cannot both match, which an operator
          cannot otherwise tell from an absent warning.
        */}
        {checkAnswered && !overlapBlocksSave && clears.length > 0 ? (
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
        {overlapState === 'unavailable' ? (
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

        {/*
          Why the save is inert, when the reason is not a banner (#3190
          review). A disabled button with no sentence beside it is the same
          dead end as a missing check: the operator can see they cannot save
          and not what to do about it.
        */}
        {saveWithheldReason !== null ? (
          <p className="muted-text" data-testid="rule-save-hint">
            {saveWithheldReason}
          </p>
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
            Two values, not five - the other reasons a save is withheld are
            carried by `data-overlap-state` and the hint above, so a selector
            written against the shipped vocabulary keeps working.
          */}
          <Button
            className="button--sm"
            data-testid={overlapBlocksSave ? 'rule-save-blocked' : 'rule-save'}
            data-overlap-state={overlapState}
            disabled={
              createRule.isPending || connectionId === '' || overlapWithholdsSave || overlapBlocksSave
            }
            onClick={() => void handleSave()}
          >
            {createRule.isPending ? 'Saving…' : recheckInFlight ? 'Checking…' : 'Save rule'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
