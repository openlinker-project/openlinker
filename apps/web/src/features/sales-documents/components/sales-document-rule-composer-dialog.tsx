/**
 * Sales-Document Rule Composer (#2170, mockup tab 02 "+ Add rule")
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
 * @module apps/web/src/features/sales-documents/components
 */
import { useState, type ReactElement } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../../../shared/ui/dialog';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { Input } from '../../../shared/ui/input';
import { Alert } from '../../../shared/ui/alert';
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
        style={{ maxWidth: '30rem' }}
      >
        <DialogTitle>Add rule</DialogTitle>

        {createRule.error ? <Alert tone="error">{createRule.error.message}</Alert> : null}

        <div>
          <label className="eyebrow" style={{ marginBottom: 2 }}>
            Conditions
          </label>
          {conditions.map((condition, index) => (
            <div key={index} className="frame-grid frame-grid--2" style={{ marginBottom: 'var(--space-2)' }}>
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
              {condition.kind === 'buyerHasTaxId' ? (
                <div style={{ gridColumn: '1 / -1' }}>
                  <Alert tone="warning">
                    This condition cannot match yet: OpenLinker doesn&apos;t know a buyer&apos;s
                    tax-ID status for any order today, so a rule using it will never fire until that
                    data is available.
                  </Alert>
                </div>
              ) : null}

              {condition.kind === 'orderCountry' ? (
                <Input
                  aria-label="Order country value"
                  value={condition.stringValue}
                  placeholder="e.g. PL"
                  onChange={(event) =>
                    setConditions((prev) =>
                      prev.map((c, i) =>
                        i === index ? { ...c, stringValue: event.target.value.toUpperCase() } : c,
                      ),
                    )
                  }
                />
              ) : null}

              {condition.kind === 'orderTotalGross' ? (
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
            </div>
          ))}
          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => setConditions((prev) => [...prev, newConditionDraft()])}
          >
            + Add condition
          </Button>
          <p className="muted-text" style={{ marginTop: 'var(--space-2)' }}>
            Every added condition must ALL be true for this rule to match (AND). The underlying{' '}
            <span className="mono-text">field</span> is one closed, cross-country vocabulary — never a
            country-specific string.
          </p>
        </div>

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
          <div className="ack-row" style={{ background: 'var(--bg-surface-muted)' }}>
            <input type="checkbox" id="sd-rule-taxid-toggle" disabled />
            <label htmlFor="sd-rule-taxid-toggle">
              Include the buyer&apos;s tax ID on the receipt, where the destination supports it
              <span className="muted-text" style={{ display: 'block', marginTop: 2 }}>
                A property of the Receipt outcome, not a separate document type. Not workable today —
                eparagony.pl&apos;s adapter has no tax-id field yet.
              </span>
            </label>
          </div>
        ) : null}

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
