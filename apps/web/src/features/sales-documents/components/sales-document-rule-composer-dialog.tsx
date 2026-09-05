/**
 * Sales-Document Rule Composer (#2170, mockup tab 02 "+ Add rule", redesigned
 * per review — spacing/hierarchy + warning-density findings)
 *
 * Document type stays EXACTLY two-valued — Invoice / Receipt — never a third
 * "Receipt with NIP" option (the independent-review correction the mockup's
 * own tab 02 documents): "include the buyer's tax ID on the receipt" is a
 * checkbox on the Receipt outcome, shown disabled with a caveat, since
 * eparagony.pl's `RegisterTransactionCommand` carries no `buyerTaxId` field
 * yet. The checkbox therefore submits NOTHING today — it exists so the
 * composer's shape doesn't need to change once that adapter gap closes.
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
import { useSalesDocumentThresholdsQuery } from '../hooks/use-sales-document-thresholds-query';
import type {
  CreateSalesDocumentRuleInput,
  SalesDocumentConditionInput,
} from '../api/sales-document-rules.types';
import type { SalesDocumentKind } from '../api/sales-documents.types';

interface SalesDocumentRuleComposerDialogProps {
  country: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ConditionKind = 'buyerHasTaxId' | 'orderCountry' | 'orderTotalGross';

interface ConditionDraft {
  kind: ConditionKind;
  boolValue: boolean;
  stringValue: string;
  op: 'gte' | 'lt';
  thresholdRef: string;
}

function newConditionDraft(): ConditionDraft {
  return { kind: 'buyerHasTaxId', boolValue: false, stringValue: '', op: 'gte', thresholdRef: '' };
}

function toConditionInput(draft: ConditionDraft): SalesDocumentConditionInput {
  if (draft.kind === 'buyerHasTaxId') {
    return { field: 'buyerHasTaxId', op: 'eq', boolValue: draft.boolValue };
  }
  if (draft.kind === 'orderCountry') {
    return { field: 'orderCountry', op: 'eq', stringValue: draft.stringValue };
  }
  return { field: 'orderTotalGross', op: draft.op, thresholdRef: draft.thresholdRef };
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
}: SalesDocumentRuleComposerDialogProps): ReactElement {
  const connectionsQuery = useConnectionsQuery();
  const thresholdsQuery = useSalesDocumentThresholdsQuery();
  const createRule = useCreateSalesDocumentRuleMutation();

  const [conditions, setConditions] = useState<ConditionDraft[]>([newConditionDraft()]);
  const [documentKind, setDocumentKind] = useState<SalesDocumentKind>('invoice');
  const [connectionId, setConnectionId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState('');

  const connections = connectionsQuery.data ?? [];
  const thresholds = thresholdsQuery.data ?? [];
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
                      prev.map((c, i) => (i === index ? { ...newConditionDraft(), kind } : c)),
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
                          i === index ? { ...c, boolValue: event.target.value === 'true' } : c,
                        ),
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
                          i === index
                            ? { ...c, stringValue: event.target.value.toUpperCase() }
                            : c,
                        ),
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
                            i === index ? { ...c, op: event.target.value as 'gte' | 'lt' } : c,
                          ),
                        )
                      }
                    >
                      <option value="gte">≥</option>
                      <option value="lt">&lt;</option>
                    </Select>
                    <Select
                      aria-label="Threshold"
                      value={condition.thresholdRef}
                      onChange={(event) =>
                        setConditions((prev) =>
                          prev.map((c, i) =>
                            i === index ? { ...c, thresholdRef: event.target.value } : c,
                          ),
                        )
                      }
                    >
                      <option value="">Select a threshold…</option>
                      {thresholds.map((t) => (
                        <option key={t.ref} value={t.ref}>
                          {t.ref} ({t.amount} {t.currency})
                        </option>
                      ))}
                    </Select>
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

          {documentKind === 'fiscal-receipt' ? (
            <div className="ack-row rule-composer-section__footnote-row">
              <input type="checkbox" id="sd-rule-taxid-toggle" disabled />
              <label htmlFor="sd-rule-taxid-toggle">
                Include the buyer&apos;s tax ID on the receipt, where the destination supports it
                <span className="muted-text" style={{ display: 'block', marginTop: 2 }}>
                  A property of the Receipt outcome, not a separate document type. Not workable
                  today — eparagony.pl&apos;s adapter has no tax-id field yet.
                </span>
              </label>
            </div>
          ) : null}
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
          <Button
            className="button--sm"
            disabled={createRule.isPending || connectionId === ''}
            onClick={() => void handleSave()}
          >
            {createRule.isPending ? 'Saving…' : 'Save rule'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
