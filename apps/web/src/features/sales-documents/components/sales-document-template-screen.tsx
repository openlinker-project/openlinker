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

interface SalesDocumentTemplateScreenProps {
  country: string;
}

export function SalesDocumentTemplateScreen({
  country,
}: SalesDocumentTemplateScreenProps): ReactElement | null {
  const templateQuery = useSalesDocumentTemplateQuery(country);
  const connectionsQuery = useConnectionsQuery();
  const adopt = useAdoptSalesDocumentTemplateMutation();
  const [dismissed, setDismissed] = useState(false);
  const [selections, setSelections] = useState<Record<string, string>>({});

  if (templateQuery.isLoading) {
    return <LoadingState title="Checking for a starter template" message="" />;
  }

  const template = templateQuery.data ?? null;
  if (template === null || dismissed) {
    return null;
  }

  const connections = connectionsQuery.data ?? [];

  return (
    <details className="template-accordion">
      <summary className="template-accordion__summary">
        <span className="template-card__badge">Suggested starter template</span>
        <span className="template-accordion__hint">
          A ready-made rule set for {template.country} — click to review
        </span>
      </summary>
      <div className="template-card">
        <div className="template-card__head">
          <span className="template-card__source">
            Sourced from public guidance —{' '}
            <a href={template.sourceUrl} target="_blank" rel="noopener noreferrer">
              {template.sourceLabel}
            </a>
          </span>
        </div>

        <div className="template-card__preview">
          {template.rules.map((rule) => {
            const capable =
              rule.requiredCapability === 'Invoicing'
                ? selectInvoicingCandidates(connections)
                : selectFiscalizationCandidates(connections);
            return (
              <div key={rule.slot} className="rule-card">
                <div className="rule-card__flow">
                  <span className="rule-card__result">{rule.label}</span>
                </div>
                <div className="frame-grid frame-grid--2" style={{ marginTop: 'var(--space-2)' }}>
                  <Select
                    aria-label={`Connection for ${rule.label}`}
                    value={selections[rule.slot] ?? ''}
                    onChange={(event) =>
                      setSelections((prev) => ({ ...prev, [rule.slot]: event.target.value }))
                    }
                  >
                    <option value="">Select a {rule.requiredCapability} connection…</option>
                    {capable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            );
          })}
        </div>

        {template.rules.some((rule) => rule.usesBuyerHasTaxId) ? (
          <Alert tone="warning">
            Every rule above keys off whether the buyer has a tax ID — reported today only for
            PrestaShop orders. An order from a source that doesn&apos;t carry it (Allegro,
            WooCommerce) will never match any of these rules and falls through to whatever you set
            as the country default below.
          </Alert>
        ) : null}

        <Alert tone="warning">{template.disclaimer}</Alert>

        {adopt.error ? <Alert tone="error">{adopt.error.message}</Alert> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button tone="secondary" className="button--sm" onClick={() => setDismissed(true)}>
            Start from scratch instead
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
            {adopt.isPending ? 'Adopting…' : 'Review & adopt'}
          </Button>
        </div>
      </div>
    </details>
  );
}
