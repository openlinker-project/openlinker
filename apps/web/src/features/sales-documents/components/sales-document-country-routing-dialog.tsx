/**
 * Sales-Document Country Routing Dialog (#2188, acknowledgment + reset #2189)
 *
 * Per-country routing configuration, relocated out of the flat page layout
 * (#2170's interim state) and into a Radix `Dialog` opened from a row in the
 * country index (#2187). The body composes, UNCHANGED, the two already-shipped
 * components — `SalesDocumentRulesList` (rule cards + "+ Add rule", which
 * already opens `SalesDocumentRuleComposerDialog` and surfaces the real server
 * 409 conflict) and `SalesDocumentCountryDefaults` (Invoice/Receipt default
 * pickers). Neither component's own logic is touched here — this dialog only
 * decides WHERE they render and what surrounds them.
 *
 * Fallback ladder, rendered as numbered tiers:
 *
 *   1. Rules            — `SalesDocumentRulesList`
 *   2. Country default   — `SalesDocumentCountryDefaults` (+ a dual-default
 *                          warning `Alert` when both Invoice and Receipt
 *                          defaults are set — an open resolution question,
 *                          not something to silently accept)
 *   3. Falls through to ★ Rest of world — a cross-link that opens ★ Rest of
 *      world's OWN dialog (`onNavigate`, carrying `cameFrom` so that dialog
 *      can render a "← Back to {country}" affordance)
 *   4. Unresolved (terminal)
 *
 * ★ Rest of world is the catch-all itself, so its OWN dialog renders only
 * tiers 1, 2, and the terminal tier renumbered to 3 — it never references
 * itself via tier 3's cross-link, and the two document-listed cases
 * (isRestOfWorld / not) are the only two shapes this component ever renders:
 * exactly 3 tiers or exactly 4, always sequentially numbered, never a
 * duplicate number. (A prior design-review round of the source mockup shipped
 * a real bug here — two tiers both labeled "Tier 2" — which is why the tier
 * list below is built as a single array and numbered by array index, not by a
 * hand-maintained literal per tier.)
 *
 * #2189 adds two things on top, both scoped to THIS dialog:
 *
 *   - An acknowledgment banner, rendered ONLY when the country carries zero
 *     rules and zero country defaults (loading excluded, to avoid a flash of
 *     the banner before the real counts arrive). It offers "Mark as no sales
 *     document" (`PUT .../acknowledgment`) or, once acknowledged, flips to an
 *     "Acknowledged — {timestamp}" state with an "Undo" (`DELETE
 *     .../acknowledgment`) action. No client-side clear-on-configure logic
 *     exists here on purpose — the backend (#2186) already clears the
 *     acknowledgment the moment a real rule or default is created, so the
 *     banner's own empty-state gate is what makes it disappear.
 *   - A destructive "Reset country" footer action, disabled when there is
 *     nothing to reset. It opens `ConfirmDialog` (never a second bespoke
 *     modal) naming exactly what will be deleted, then sequentially composes
 *     the existing per-id `deleteRule` / `deleteCountryDefault` mutations plus
 *     the acknowledgment clear — no new backend endpoint.
 *
 * Acknowledgment state has no per-country GET of its own; this dialog reads
 * it off `useSalesDocumentCountriesQuery()` (the same #2186 list read the
 * country index uses) and finds its own row, rather than adding a redundant
 * read endpoint for a single boolean-ish field.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { useSalesDocumentRulesQuery } from '../hooks/use-sales-document-rules-query';
import { useSalesDocumentCountryDefaultsQuery } from '../hooks/use-sales-document-country-defaults-query';
import { useSalesDocumentCountriesQuery } from '../hooks/use-sales-document-countries-query';
import { useAcknowledgeSalesDocumentCountryMutation } from '../hooks/use-acknowledge-sales-document-country-mutation';
import { useClearSalesDocumentCountryAcknowledgmentMutation } from '../hooks/use-clear-sales-document-country-acknowledgment-mutation';
import { useDeleteSalesDocumentRuleMutation } from '../hooks/use-delete-sales-document-rule-mutation';
import { useDeleteSalesDocumentCountryDefaultMutation } from '../hooks/use-delete-sales-document-country-default-mutation';
import { SalesDocumentRulesList } from './sales-document-rules-list';
import { SalesDocumentCountryDefaults } from './sales-document-country-defaults';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import { SALES_DOCUMENT_REST_OF_WORLD_COUNTRY } from '../api/sales-document-rules.types';
import { describeSalesDocumentCountryReset } from '../lib/describe-sales-document-country-reset';

export interface SalesDocumentCountryRoutingDialogProps {
  open: boolean;
  /** ISO 3166-1 alpha-2 code, or `SALES_DOCUMENT_REST_OF_WORLD_COUNTRY` ('*'). */
  country: string;
  /**
   * The country this dialog was opened FROM via the tier-3 cross-link, or
   * `null` when opened directly from the country index. Only ever set for
   * ★ Rest of world's own dialog — drives the "← Back to {country}"
   * affordance.
   */
  cameFrom: string | null;
  onOpenChange: (open: boolean) => void;
  /**
   * Switch the dialog to a different country while it stays open — used by
   * both the tier-3 cross-link (`onNavigate('*', country)`) and the back
   * affordance (`onNavigate(cameFrom, null)`).
   */
  onNavigate: (country: string, cameFrom: string | null) => void;
}

interface RoutingTier {
  key: string;
  title: string;
  content: ReactNode;
}

function countryDisplayName(country: string): string {
  return country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY ? '★ Rest of world' : country;
}

export function SalesDocumentCountryRoutingDialog({
  open,
  country,
  cameFrom,
  onOpenChange,
  onNavigate,
}: SalesDocumentCountryRoutingDialogProps): ReactElement {
  const isRestOfWorld = country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY;
  const queryClient = useQueryClient();
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);

  const rulesQuery = useSalesDocumentRulesQuery(country);
  const defaultsQuery = useSalesDocumentCountryDefaultsQuery(country);
  const countriesQuery = useSalesDocumentCountriesQuery();

  const acknowledgeMutation = useAcknowledgeSalesDocumentCountryMutation();
  const clearAcknowledgmentMutation = useClearSalesDocumentCountryAcknowledgmentMutation();
  const deleteRuleMutation = useDeleteSalesDocumentRuleMutation();
  const deleteCountryDefaultMutation = useDeleteSalesDocumentCountryDefaultMutation();

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const rules = rulesQuery.data ?? [];
  const defaults = defaultsQuery.data ?? [];
  const hasInvoiceDefault = defaults.some((d) => d.documentKind === 'invoice');
  const hasReceiptDefault = defaults.some((d) => d.documentKind === 'fiscal-receipt');
  const hasDualDefault = hasInvoiceDefault && hasReceiptDefault;

  const isSummaryLoading =
    rulesQuery.isLoading || defaultsQuery.isLoading || countriesQuery.isLoading;
  const acknowledgedAt =
    countriesQuery.data?.find((summary) => summary.country === country)?.acknowledgedNoDocumentAt ??
    null;
  const isEmptyCountry = !isSummaryLoading && rules.length === 0 && defaults.length === 0;
  const hasNothingToReset = rules.length === 0 && defaults.length === 0 && acknowledgedAt === null;

  const displayName = countryDisplayName(country);

  async function handleConfirmReset(): Promise<void> {
    setResetError(null);
    setIsResetting(true);
    try {
      for (const rule of rules) {
        await deleteRuleMutation.mutateAsync(rule.id);
      }
      for (const countryDefault of defaults) {
        await deleteCountryDefaultMutation.mutateAsync(countryDefault.id);
      }
      if (acknowledgedAt !== null) {
        await clearAcknowledgmentMutation.mutateAsync(country);
      }
      await queryClient.invalidateQueries({ queryKey: salesDocumentRulesQueryKeys.all });
      setConfirmResetOpen(false);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'Failed to reset country');
    } finally {
      setIsResetting(false);
    }
  }

  const tiers: RoutingTier[] = [
    {
      key: 'rules',
      title: 'Rules',
      content: <SalesDocumentRulesList country={country} />,
    },
    {
      key: 'country-default',
      title: 'Country default',
      content: (
        <>
          <SalesDocumentCountryDefaults country={country} />
          {hasDualDefault ? (
            <Alert tone="warning" title="Both an Invoice and a Receipt default are set">
              A default only applies when no rule above matched. With two defaults set for{' '}
              {displayName}, that step is disabled entirely — an order that matches no rule is
              held rather than taking either default. Remove one of the two to restore a working
              fallback.
            </Alert>
          ) : (hasInvoiceDefault || hasReceiptDefault) ? (
            <p className="muted-text">
              This default applies only when no rule above matches this order. Setting a default
              for the other document kind too disables this fallback — one default, not two, keeps
              it working.
            </p>
          ) : null}
        </>
      ),
    },
  ];

  if (!isRestOfWorld) {
    tiers.push({
      key: 'rest-of-world',
      title: 'Falls through to ★ Rest of world',
      content: (
        <div>
          <p className="muted-text">
            An order billed to {displayName} that matches no rule above and has no country default
            here falls through to <span className="mono-text">★ Rest of world</span>
            &apos;s own rules and defaults.
          </p>
          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => onNavigate(SALES_DOCUMENT_REST_OF_WORLD_COUNTRY, country)}
          >
            Open ★ Rest of world&apos;s routing →
          </Button>
        </div>
      ),
    });
  }

  tiers.push({
    key: 'unresolved',
    title: 'Unresolved',
    content: (
      <p className="muted-text">
        {isRestOfWorld
          ? 'If nothing above matches, the order has no configured fallback left and is reported unresolved.'
          : `If ★ Rest of world also has no matching rule or default, the order is reported unresolved.`}
      </p>
    ),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className="dialog__content--wide">
          {cameFrom ? (
            <Button
              tone="ghost"
              className="button--sm sales-document-country-routing-dialog__back"
              onClick={() => onNavigate(cameFrom, null)}
            >
              ← Back to {cameFrom}
            </Button>
          ) : null}

          <DialogTitle>Sales-document routing · {displayName}</DialogTitle>
          <p className="muted-text sales-document-country-routing-dialog__save-note">
            Every control here saves as you change it — there is nothing to submit.
          </p>

          <div className="sales-document-country-routing-dialog__body">
            {isEmptyCountry ? (
              acknowledgedAt !== null ? (
                <Alert
                  tone="success"
                  title="No sales document, by design"
                  action={
                    <ReadOnlyLock
                      active={write.demoReadOnly}
                      message={DEMO_READ_ONLY_ACTION_MESSAGE}
                    >
                      <Button
                        tone="secondary"
                        className="button--sm"
                        disabled={!write.canWrite || clearAcknowledgmentMutation.isPending}
                        onClick={() => void clearAcknowledgmentMutation.mutateAsync(country)}
                      >
                        Undo
                      </Button>
                    </ReadOnlyLock>
                  }
                >
                  Acknowledged - <TimeDisplay iso={acknowledgedAt} />.
                </Alert>
              ) : (
                <Alert
                  tone="info"
                  title="Nothing configured for this country yet"
                  action={
                    <ReadOnlyLock
                      active={write.demoReadOnly}
                      message={DEMO_READ_ONLY_ACTION_MESSAGE}
                    >
                      <Button
                        tone="secondary"
                        className="button--sm"
                        disabled={!write.canWrite || acknowledgeMutation.isPending}
                        onClick={() => void acknowledgeMutation.mutateAsync(country)}
                      >
                        Mark as no sales document
                      </Button>
                    </ReadOnlyLock>
                  }
                >
                  If {displayName} intentionally has no invoicing or fiscalization integration
                  configured, acknowledge it so operators can tell that apart from a market nobody
                  has looked at yet.
                </Alert>
              )
            ) : null}
            {acknowledgeMutation.error ? (
              <Alert tone="error">{acknowledgeMutation.error.message}</Alert>
            ) : null}
            {clearAcknowledgmentMutation.error ? (
              <Alert tone="error">{clearAcknowledgmentMutation.error.message}</Alert>
            ) : null}

            {tiers.map((tier, index) => (
              <section key={tier.key} className="page-section">
                <h3 className="detail-section__title">
                  Tier {index + 1} · {tier.title}
                </h3>
                {tier.content}
              </section>
            ))}

            {resetError ? <Alert tone="error">{resetError}</Alert> : null}

            <div className="sales-document-country-routing-dialog__danger-zone">
              <p className="muted-text">
                Resetting deletes every rule and default configured for {displayName} here in
                OpenLinker. It does not touch anything at the provider — no invoice or receipt
                already issued is affected.
              </p>
              <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                <Button
                  tone="danger"
                  disabled={!write.canWrite || isSummaryLoading || hasNothingToReset || isResetting}
                  onClick={() => setConfirmResetOpen(true)}
                >
                  Reset country
                </Button>
              </ReadOnlyLock>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button tone="primary">Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        className="dialog__content--elevated"
        overlayClassName="dialog__overlay--elevated"
        tone="danger"
        title={`Reset ${displayName}?`}
        description={describeSalesDocumentCountryReset(displayName, {
          ruleCount: rules.length,
          hasInvoiceDefault,
          hasReceiptDefault,
          acknowledged: acknowledgedAt !== null,
        })}
        confirmLabel="Yes, reset"
        isConfirming={isResetting}
        onConfirm={() => void handleConfirmReset()}
      />
    </>
  );
}
