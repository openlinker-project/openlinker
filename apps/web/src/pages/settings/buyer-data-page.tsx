/**
 * Buyer Data Settings Page (#4289)
 *
 * The general (default) rules for when an order leaves the list and when a
 * buyer's personal data is erased. They apply to every new connection and to
 * every connection without rules of its own; a connection can override them in
 * its edit. Off by default, and switched on only after a trial run has shown
 * what the rules would do - the page says both, and that erasing cannot be
 * undone. Admin only, like every write behind it.
 *
 * @module apps/web/src/pages/settings
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { describeApiError } from '../../shared/api/describe-api-error';
import { interpolate, useMessages } from '../../shared/i18n';
import { AccessGate } from '../../shared/ui/access-gate';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { AccessDeniedState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { StatusBadge } from '../../shared/ui/status-badge';
import { useToast } from '../../shared/ui/toast-provider';
import {
  BuyerDataImpact,
  BuyerDataRulesEditor,
  BuyerDataTrial,
  globalRulesFromSettings,
  readBuyerDataSettings,
  resolveBuyerDataRules,
  useBuyerDataImpactQuery,
  useBuyerDataSummary,
  useBuyerDataTrialMutation,
  validateBuyerDataRules,
  type BuyerDataRules,
} from '../../features/buyer-data';
import { useConnectionsQuery, type Connection } from '../../features/connections';
import {
  useOperationalSettingsQuery,
  useUpdateOperationalSettingsMutation,
} from '../../features/settings';

function takesOrders(connection: Connection): boolean {
  return connection.status !== 'archived' && connection.enabledCapabilities.includes('OrderSource');
}

function sameRules(a: BuyerDataRules, b: BuyerDataRules): boolean {
  return (
    a.enabled === b.enabled &&
    a.hideAfterDays === b.hideAfterDays &&
    a.eraseAfterDays === b.eraseAfterDays &&
    a.mode === b.mode
  );
}

function BuyerDataSettings({ saved }: { saved: BuyerDataRules }): ReactElement {
  const COPY = useMessages('buyer-data').page;
  const { showToast } = useToast();
  const summarise = useBuyerDataSummary();
  const connectionsQuery = useConnectionsQuery();
  const update = useUpdateOperationalSettingsMutation();
  const trial = useBuyerDataTrialMutation();
  const [draft, setDraft] = useState(saved);
  const [ranOnce, setRanOnce] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // A saved row that changed under the page is a fresh decision: adopt it.
  useEffect(() => {
    setDraft(saved);
    setRanOnce(false);
  }, [saved.enabled, saved.hideAfterDays, saved.eraseAfterDays, saved.mode]);

  const issues = validateBuyerDataRules(draft);
  const impact = useBuyerDataImpactQuery({
    hideAfterDays: draft.hideAfterDays,
    eraseAfterDays: draft.eraseAfterDays,
    mode: draft.mode,
  });
  const changed = !sameRules(draft, saved);
  const canEnable = issues.length === 0 && (ranOnce || saved.enabled);
  const connections = (connectionsQuery.data ?? []).filter(takesOrders);
  const ownCount = connections.filter((c) => readBuyerDataSettings(c.config) !== null).length;

  function persist(): void {
    update.mutate(
      {
        buyerDataRetentionEnabled: draft.enabled,
        buyerDataHideAfterDays: draft.hideAfterDays,
        buyerDataEraseAfterDays: draft.eraseAfterDays,
        buyerDataEraseMode: draft.mode,
      },
      {
        onSuccess: () => showToast({ description: COPY.saved, tone: 'success' }),
        onError: (error) =>
          showToast({
            title: COPY.saveFailed,
            description: describeApiError(error, 'buyer-data'),
            tone: 'error',
          }),
      }
    );
  }

  function save(): void {
    if (draft.enabled && !saved.enabled) {
      setConfirming(true);
      return;
    }
    persist();
  }

  return (
    <form
      className="form-card form-narrow"
      onSubmit={(event) => {
        event.preventDefault();
        if (issues.length === 0 && changed) save();
      }}
      data-testid="buyer-data-page"
    >
      <Alert tone="info" title={COPY.defaultsTitle}>
        {COPY.defaultsBody}
      </Alert>

      {saved.enabled ? (
        <Alert tone="success" title={COPY.onTitle}>
          {COPY.onBody}
        </Alert>
      ) : (
        <Alert tone="info" title={COPY.offTitle} data-testid="buyer-data-off-note">
          {COPY.offBody}
        </Alert>
      )}

      <BuyerDataRulesEditor name="general" rules={draft} onChange={setDraft} />

      <BuyerDataImpact
        rules={draft}
        preview={impact.data}
        isLoading={impact.isFetching}
        isError={impact.isError}
        isInvalid={issues.length > 0}
      />

      <BuyerDataTrial
        result={ranOnce ? trial.data : undefined}
        isPending={trial.isPending}
        isError={trial.isError}
        disabled={issues.length > 0}
        onRun={() =>
          trial.mutate(
            {
              hideAfterDays: draft.hideAfterDays,
              eraseAfterDays: draft.eraseAfterDays,
              mode: draft.mode,
            },
            { onSuccess: () => setRanOnce(true) }
          )
        }
      />

      <label className="rate-limit-section__toggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={!canEnable && !draft.enabled}
          data-testid="buyer-data-master-switch"
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
        />
        <span>{COPY.enabledLabel}</span>
      </label>
      {!canEnable && !draft.enabled ? (
        <p className="rate-limit-section__help">{COPY.enabledNeedsCheck}</p>
      ) : null}

      <section className="rate-limit-section">
        <h3 className="rate-limit-section__title">{COPY.connectionsTitle}</h3>
        {connections.length === 0 ? (
          <p className="rate-limit-section__help">{COPY.noConnections}</p>
        ) : (
          <>
            <p className="rate-limit-section__help">
              {interpolate(COPY.connectionsHelp, { own: ownCount, total: connections.length })}
            </p>
            <div className="data-table__container">
              <table className="data-table" data-testid="buyer-data-connections">
                <thead>
                  <tr>
                    <th scope="col">{COPY.columnConnection}</th>
                    <th scope="col">{COPY.columnRules}</th>
                    <th scope="col">{COPY.columnSource}</th>
                    <th scope="col">
                      <span className="sr-only">{COPY.edit}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((connection) => {
                    const override = readBuyerDataSettings(connection.config);
                    return (
                      <tr key={connection.id}>
                        <td>{connection.name}</td>
                        <td>{summarise(resolveBuyerDataRules(override, saved))}</td>
                        <td>
                          <StatusBadge tone={override === null ? 'neutral' : 'info'}>
                            {override === null ? COPY.inherit : COPY.own}
                          </StatusBadge>
                        </td>
                        <td>
                          <Link
                            className="button button--secondary button--sm"
                            to={`/connections/${encodeURIComponent(connection.id)}/edit`}
                          >
                            {COPY.edit}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <div className="form-actions">
        <Button
          type="submit"
          disabled={!changed || issues.length > 0 || update.isPending}
          data-testid="buyer-data-save"
        >
          {COPY.save}
        </Button>
        <Link className="button button--secondary" to="/settings">
          {COPY.cancel}
        </Link>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={COPY.enableDialogTitle}
        description={COPY.enableDialogBody}
        confirmLabel={COPY.enableDialogConfirm}
        onConfirm={() => {
          setConfirming(false);
          persist();
        }}
      />
    </form>
  );
}

export function BuyerDataPage(): ReactElement {
  const COPY = useMessages('buyer-data').page;
  const query = useOperationalSettingsQuery();

  return (
    <PageLayout
      backTo={{ to: '/settings', label: COPY.settings }}
      eyebrow={COPY.settings}
      title={COPY.title}
      description={COPY.description}
    >
      <AccessGate
        require="connections:write"
        fallback={<AccessDeniedState message={COPY.adminOnly} />}
      >
        {query.isPending ? (
          <LoadingState liveRegion="off" title={COPY.title} message={COPY.loading} />
        ) : query.isError ? (
          <Alert tone="error">{COPY.loadError}</Alert>
        ) : (
          <BuyerDataSettings saved={globalRulesFromSettings(query.data)} />
        )}
      </AccessGate>
    </PageLayout>
  );
}
