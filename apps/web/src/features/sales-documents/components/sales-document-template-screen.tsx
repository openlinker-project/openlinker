/**
 * Sales-Document Starter Template — "Review & adopt" (#2170, mockup tab 02)
 *
 * Poland-only for this issue. Renders only when the country carries a
 * curated template (`useSalesDocumentTemplateQuery` resolves non-null) — a
 * country with no template is not a country that can't be configured, it's
 * just one nobody has pre-written suggestions for yet, so "Start from
 * scratch" always works and this screen simply doesn't render for anywhere
 * else. Adopting resolves one connection per slot (an operator pick, since
 * the template names a required CAPABILITY, not a connection) and writes
 * ordinary, fully-editable rows via the same create-rule path every other
 * rule takes.
 *
 * Rendered as a native `<details>` accordion, collapsed by default — an
 * operator opening a brand-new country's routing dialog should see the
 * empty rule ladder first, with the suggestion available but not forced
 * open on top of it.
 *
 * The connection picker per slot is deliberately capability-only (#3232) —
 * see `find-sales-document-connection-role-gap.ts` for why a role-less pick
 * still routes correctly, and for the pick-time warning that names the gap
 * instead of letting the operator discover it later on the
 * destination-warnings list.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useState, type ReactElement } from 'react';
import { useConnectionsQuery } from '../../connections';
import { selectInvoicingCandidates } from '../../invoicing';
import { selectFiscalizationCandidates } from '../../fiscalization';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { LoadingState } from '../../../shared/ui/feedback-state';
import { useSalesDocumentTemplateQuery } from '../hooks/use-sales-document-template-query';
import { useAdoptSalesDocumentTemplateMutation } from '../hooks/use-adopt-sales-document-template-mutation';
import {
  describeSalesDocumentConnectionRoleGap,
  findSalesDocumentConnectionRoleGapFromRows,
} from '../lib/find-sales-document-connection-role-gap';
import { deriveSalesDocumentRows } from '../lib/derive-sales-document-rows';
import { interpolate, renderRich, useMessages } from '../../../shared/i18n';

interface SalesDocumentTemplateScreenProps {
  country: string;
}

export function SalesDocumentTemplateScreen({
  country,
}: SalesDocumentTemplateScreenProps): ReactElement | null {
  const copy = useMessages('sales-documents').salesDocumentTemplateScreen;
  const templateQuery = useSalesDocumentTemplateQuery(country);
  const connectionsQuery = useConnectionsQuery();
  const adopt = useAdoptSalesDocumentTemplateMutation();
  const [dismissed, setDismissed] = useState(false);
  const [selections, setSelections] = useState<Record<string, string>>({});

  if (templateQuery.isLoading) {
    return <LoadingState title={copy.loading} message="" />;
  }

  const template = templateQuery.data ?? null;
  if (template === null || dismissed) {
    return null;
  }

  const connections = connectionsQuery.data ?? [];
  // Derived once here rather than inside the `.map()` below — the helper
  // itself would otherwise re-derive the whole connection list once per
  // template rule (O(rules × connections) per render).
  const salesDocumentRows = deriveSalesDocumentRows(connections);

  return (
    <details className="template-accordion">
      <summary className="template-accordion__summary">
        <span className="template-card__badge">{copy.badge}</span>
        <span className="template-accordion__hint">
          {interpolate(copy.hint, { country: template.country })}
        </span>
      </summary>
      <div className="template-card">
        <div className="template-card__head">
          <span className="template-card__source">
            {renderRich(
              copy.source,
              {
                link: (text) => (
                  <a href={template.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {text}
                  </a>
                ),
              },
              { source: template.sourceLabel },
            )}
          </span>
        </div>

        <div className="template-card__preview">
          {template.rules.map((rule) => {
            const capable =
              rule.requiredCapability === 'Invoicing'
                ? selectInvoicingCandidates(connections)
                : selectFiscalizationCandidates(connections);
            // #3232. Same deliberate divergence as the rule composer: this
            // picker stays capability-only (a template rule carries its own
            // `documentKind`, so nothing about dispatching it reads the
            // connection's role) — see
            // `find-sales-document-connection-role-gap.ts`. A role-less pick
            // is named here rather than discovered later on the
            // destination-warnings list.
            const roleGap = findSalesDocumentConnectionRoleGapFromRows(
              selections[rule.slot] ?? '',
              connections,
              salesDocumentRows,
            );
            return (
              <div key={rule.slot} className="rule-card">
                <div className="rule-card__flow">
                  <span className="rule-card__result">{rule.label}</span>
                </div>
                <div className="frame-grid frame-grid--2" style={{ marginTop: 'var(--space-2)' }}>
                  <Select
                    aria-label={interpolate(copy.connectionFor, { rule: rule.label })}
                    value={selections[rule.slot] ?? ''}
                    onChange={(event) =>
                      setSelections((prev) => ({ ...prev, [rule.slot]: event.target.value }))
                    }
                  >
                    <option value="">
                      {rule.requiredCapability === 'Invoicing'
                        ? copy.selectInvoicing
                        : copy.selectFiscalization}
                    </option>
                    {capable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
                {roleGap !== null ? (
                  <p
                    className="muted-text rule-card__role-gap"
                    data-testid={`template-role-gap-${rule.slot}`}
                  >
                    {describeSalesDocumentConnectionRoleGap(roleGap)}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        {template.rules.some((rule) => rule.usesBuyerHasTaxId) ? (
          <Alert tone="warning">
            {copy.taxIdWarning}
          </Alert>
        ) : null}

        <Alert tone="warning">{template.disclaimer}</Alert>

        {adopt.error ? <Alert tone="error">{adopt.error.message}</Alert> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button tone="secondary" className="button--sm" onClick={() => setDismissed(true)}>
            {copy.dismiss}
          </Button>
          <Button
            className="button--sm"
            disabled={
              adopt.isPending ||
              template.rules.some((rule) => !selections[rule.slot] || selections[rule.slot] === '')
            }
            onClick={() =>
              void adopt
                .mutateAsync({
                  country,
                  input: {
                    selections: template.rules.map((rule) => ({
                      slot: rule.slot,
                      connectionId: selections[rule.slot],
                    })),
                  },
                })
                .then(() => setDismissed(true))
            }
          >
            {adopt.isPending ? copy.adopting : copy.adopt}
          </Button>
        </div>
      </div>
    </details>
  );
}
