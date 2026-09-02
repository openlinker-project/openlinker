/**
 * Sales-Document Rules List (#2170, mockup tab 02 "Rules for {country}")
 *
 * Read top-to-bottom as independent conditions — order carries no meaning
 * (there is no `priority` field, deliberately: see `SalesDocumentRuleConflictException`).
 * Each rule renders its own provenance tag when adopted from a starter
 * template, and its own effective-date range.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useState, type ReactElement } from 'react';
import { useConnectionsQuery } from '../../connections';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { LoadingState, ErrorState } from '../../../shared/ui/feedback-state';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { useSalesDocumentRulesQuery } from '../hooks/use-sales-document-rules-query';
import { useDeleteSalesDocumentRuleMutation } from '../hooks/use-delete-sales-document-rule-mutation';
import { SalesDocumentRuleComposerDialog } from './sales-document-rule-composer-dialog';
import { describeSalesDocumentCondition } from '../lib/describe-sales-document-condition';
import {
  countRulesUsingBuyerTaxId,
  describeBuyerTaxIdRuleCount,
  usesBuyerTaxIdCondition,
} from '../lib/describe-sales-document-tax-id-coverage';
import type { SalesDocumentRule } from '../api/sales-document-rules.types';

interface SalesDocumentRulesListProps {
  country: string;
}

function ruleResultLabel(rule: SalesDocumentRule): string {
  return rule.documentKind === 'invoice' ? 'Invoice' : 'Receipt';
}

export function SalesDocumentRulesList({ country }: SalesDocumentRulesListProps): ReactElement {
  const rulesQuery = useSalesDocumentRulesQuery(country);
  const connectionsQuery = useConnectionsQuery();
  const deleteRule = useDeleteSalesDocumentRuleMutation();
  const [composerOpen, setComposerOpen] = useState(false);
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);

  if (rulesQuery.isLoading || connectionsQuery.isLoading) {
    return <LoadingState title="Loading rules" message="Fetching rules for this country…" />;
  }
  if (rulesQuery.error || connectionsQuery.error) {
    return (
      <ErrorState
        title="Unable to load rules"
        message={(rulesQuery.error ?? connectionsQuery.error)?.message ?? 'Unknown error'}
      />
    );
  }

  const rules = rulesQuery.data ?? [];
  const connections = connectionsQuery.data ?? [];
  const taxIdRuleCount = countRulesUsingBuyerTaxId(rules);

  return (
    <div className="page-section">
      <div className="detail-section__title-row">
        <p className="eyebrow" style={{ marginBottom: 2 }}>
          Rules for {country === '*' ? '★ Rest of world' : country}
        </p>
        <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
          <Button className="button--sm" disabled={!write.canWrite} onClick={() => setComposerOpen(true)}>
            + Add rule
          </Button>
        </ReadOnlyLock>
      </div>
      <p className="muted-text">
        Exactly one rule must match an order. Rules have no order of priority — if two match, the
        order is held instead of one winning.
      </p>

      {taxIdRuleCount > 0 ? (
        <Alert tone="warning" title={describeBuyerTaxIdRuleCount(taxIdRuleCount)}>
          A buyer-tax-ID condition matches only an order whose source actually recorded that
          fact. PrestaShop always reports it; Allegro and Erli report it only when the buyer
          requested a VAT invoice; WooCommerce reports it only if the store runs a supported
          VAT-number plugin. An order whose source didn&apos;t assert a tax ID never matches this
          rule.
        </Alert>
      ) : null}

      {rules.map((rule) => {
        const connectionName = connections.find((c) => c.id === rule.connectionId)?.name ?? rule.connectionId;
        const isDeletingThisRule = deleteRule.isPending && deleteRule.variables === rule.id;
        const deleteFailedForThisRule =
          deleteRule.isError && deleteRule.variables === rule.id ? deleteRule.error : null;
        return (
          <div key={rule.id} className="rule-card">
            <div className="rule-card__flow">
              {rule.conditions.map((condition, index) => (
                <span key={index} className="condition-chip">
                  {describeSalesDocumentCondition(condition)}
                </span>
              ))}
              <span className="rule-card__arrow" aria-hidden="true">
                →
              </span>
              <span className="rule-card__result">
                {ruleResultLabel(rule)} · {connectionName}
              </span>
            </div>
            <div className="rule-card__meta">
              {rule.provenance ? <span className="provenance-tag">from: {rule.provenance}</span> : null}
              {usesBuyerTaxIdCondition(rule) ? (
                <span
                  className="provenance-tag"
                  title="Matches only when the order's source recorded a buyer tax ID — always for PrestaShop, conditionally for Allegro, Erli, and WooCommerce"
                >
                  tax-ID-aware sources only
                </span>
              ) : null}
              <span className="rule-card__dates">
                {rule.effectiveTo ? `ends ${rule.effectiveTo}` : 'no end date'}
              </span>
              <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                <Button
                  tone="secondary"
                  className="button--sm"
                  disabled={!write.canWrite || isDeletingThisRule}
                  onClick={() => deleteRule.mutate(rule.id)}
                >
                  {isDeletingThisRule ? 'Deleting…' : 'Delete'}
                </Button>
              </ReadOnlyLock>
            </div>
            {deleteFailedForThisRule ? (
              <Alert tone="error">{deleteFailedForThisRule.message}</Alert>
            ) : null}
          </div>
        );
      })}

      {rules.length === 0 ? <p className="muted-text">No rules yet for this country.</p> : null}

      <SalesDocumentRuleComposerDialog country={country} open={composerOpen} onOpenChange={setComposerOpen} />
    </div>
  );
}
