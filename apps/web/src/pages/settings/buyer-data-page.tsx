/**
 * Buyer Data Settings Page (#4289)
 *
 * The retention studio: set when an order leaves the lists (reversible) and
 * when a buyer's personal data is erased (not), on a strip of the shop's own
 * orders by age, and watch what the choice does to the data. "Defaults" apply
 * to every connection that has no rules of its own; each order-taking
 * connection has a tab where it can follow the defaults (linked) or break away
 * with its own cut-offs (grabbing a handle unlinks it).
 *
 * Nothing is saved until "Save"; a switch can only be turned on once the plan
 * for what is on screen has been calculated, and turning it on asks again with
 * the counts. Admin only, like every write behind it.
 *
 * @module apps/web/src/pages/settings
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { describeApiError } from '../../shared/api/describe-api-error';
import { interpolate, useMessages } from '../../shared/i18n';
import { AccessGate } from '../../shared/ui/access-gate';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { Infotip } from '../../shared/ui/infotip';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { AccessDeniedState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { StatusBadge } from '../../shared/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../shared/ui/tabs';
import { useToast } from '../../shared/ui/toast-provider';
import {
  RetentionScope,
  globalRulesFromSettings,
  nextBuyerDataOverride,
  overrideFromRules,
  readBuyerDataSettings,
  resolveBuyerDataRules,
  useBuyerDataScopesPlan,
  useShortPeriod,
  withoutOwnSwitch,
  validateBuyerDataRules,
  withBuyerDataSettings,
  type BuyerDataOverride,
  type BuyerDataPreview,
  type BuyerDataRules,
} from '../../features/buyer-data';
import {
  useConnectionsQuery,
  useUpdateConnectionMutation,
  type Connection,
} from '../../features/connections';
import {
  useOperationalSettingsQuery,
  useUpdateOperationalSettingsMutation,
} from '../../features/settings';

const DEFAULTS_TAB = 'defaults';

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

function sameOverride(a: BuyerDataOverride | null, b: BuyerDataOverride | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.enabled === b.enabled &&
    a.hideAfterDays === b.hideAfterDays &&
    a.eraseAfterDays === b.eraseAfterDays &&
    a.mode === b.mode
  );
}

function ChainIcon({ linked }: { linked: boolean }): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="scope-chain__icon" aria-hidden="true">
      {linked ? (
        <path
          d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1M3 3l1.2 1.2M13 13l-1.2-1.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function BuyerDataSettings({ saved }: { saved: BuyerDataRules }): ReactElement {
  const COPY = useMessages('buyer-data').page;
  const scopeCopy = useMessages('buyer-data').scope;
  const { showToast } = useToast();
  const shortPeriod = useShortPeriod();
  const connectionsQuery = useConnectionsQuery();
  const update = useUpdateOperationalSettingsMutation();
  const updateConnection = useUpdateConnectionMutation();
  const [draft, setDraft] = useState(saved);
  /** Connections edited on this page; absent = as saved. `null` = follow the defaults. */
  const [connDrafts, setConnDrafts] = useState<Record<string, BuyerDataOverride | null>>({});
  const [tab, setTab] = useState(DEFAULTS_TAB);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const plans = useRef<Record<string, BuyerDataPreview | undefined>>({});

  // A saved row that changed under the page is a fresh decision: adopt it.
  useEffect(() => {
    setDraft(saved);
  }, [saved.enabled, saved.hideAfterDays, saved.eraseAfterDays, saved.mode]);

  const connections = (connectionsQuery.data ?? [])
    .filter(takesOrders)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const savedOverride = (c: Connection): BuyerDataOverride | null =>
    readBuyerDataSettings(c.config);
  const overrideOf = (c: Connection): BuyerDataOverride | null =>
    c.id in connDrafts ? connDrafts[c.id] ?? null : savedOverride(c);

  const dirtyConnections = connections.filter(
    (c) => c.id in connDrafts && !sameOverride(connDrafts[c.id] ?? null, savedOverride(c))
  );
  const changed = !sameRules(draft, saved) || dirtyConnections.length > 0;
  // Who the Defaults tab speaks for: the connections that have no rules of their own.
  const followerKey = connections
    .filter((c) => overrideOf(c) === null)
    .map((c) => c.id)
    .join(',');
  const followerIds = useMemo(
    () => (followerKey === '' ? [] : followerKey.split(',')),
    [followerKey]
  );
  const ownCount = connections.filter((c) => overrideOf(c) !== null).length;
  const issues = [
    ...validateBuyerDataRules(draft),
    ...connections.flatMap((c) => {
      const o = overrideOf(c);
      return o === null ? [] : validateBuyerDataRules(resolveBuyerDataRules(o, draft));
    }),
  ];

  const comparison = (
    <section className="scope-compare" aria-labelledby="scope-compare-title">
      <h3 id="scope-compare-title" className="rate-limit-section__title">
        {COPY.connectionsTitle}
      </h3>
      {connections.length === 0 ? (
        <p className="rate-limit-section__help">{COPY.noConnections}</p>
      ) : (
        <>
          <p className="rate-limit-section__help">
            {interpolate(COPY.connectionsHelp, { own: ownCount, total: connections.length })}
          </p>
          <div className="data-table__container">
            <table className="data-table scope-compare__table" data-testid="buyer-data-connections">
              <thead>
                <tr>
                  <th scope="col">{COPY.columnConnection}</th>
                  <th scope="col">{COPY.columnHide}</th>
                  <th scope="col">{COPY.columnErase}</th>
                  <th scope="col">{COPY.columnSource}</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => {
                  const override = overrideOf(c);
                  const r = resolveBuyerDataRules(override, draft);
                  return (
                    <tr
                      key={c.id}
                      className={tab === c.id ? 'scope-compare__row--active' : undefined}
                    >
                      <td>
                        <button
                          type="button"
                          className="scope-compare__open"
                          onClick={() => setTab(c.id)}
                        >
                          {c.name}
                        </button>
                      </td>
                      <td data-label={COPY.columnHide}>{shortPeriod(r.hideAfterDays)}</td>
                      <td data-label={COPY.columnErase}>{shortPeriod(r.eraseAfterDays)}</td>
                      <td data-label={COPY.columnSource}>
                        <StatusBadge tone={override === null ? 'neutral' : 'info'}>
                          {override === null ? COPY.inherit : COPY.own}
                        </StatusBadge>
                        {override?.enabled === false && draft.enabled ? (
                          <StatusBadge tone="warning">{scopeCopy.offChip}</StatusBadge>
                        ) : null}
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
  );

  function setConnection(connection: Connection, next: BuyerDataOverride | null): void {
    setConnDrafts((current) => {
      const copy = { ...current };
      if (sameOverride(next, savedOverride(connection))) delete copy[connection.id];
      else copy[connection.id] = next;
      return copy;
    });
  }

  /**
   * Connections that start being swept with this save (their EFFECTIVE switch
   * goes from off to on - a connection with its own rules follows the general
   * switch, so turning that on reaches it too) and the ones that stay off
   * because the operator switched them off for that connection.
   */
  const startingNow = connections.filter(
    (c) =>
      resolveBuyerDataRules(overrideOf(c), draft).enabled &&
      !resolveBuyerDataRules(savedOverride(c), saved).enabled
  );
  const staysOff = connections.filter(
    (c) => overrideOf(c)?.enabled === false && draft.enabled && !saved.enabled
  );
  const needsConfirm = (draft.enabled && !saved.enabled) || startingNow.length > 0;
  const scopePlans = useBuyerDataScopesPlan(
    startingNow.map((c) => {
      const r = resolveBuyerDataRules(overrideOf(c), draft);
      return {
        connectionId: c.id,
        hideAfterDays: r.hideAfterDays,
        eraseAfterDays: r.eraseAfterDays,
        mode: r.mode,
      };
    }),
    { enabled: confirming }
  );

  async function persist(): Promise<void> {
    setSaving(true);
    try {
      if (!sameRules(draft, saved)) {
        await update.mutateAsync({
          buyerDataRetentionEnabled: draft.enabled,
          buyerDataHideAfterDays: draft.hideAfterDays,
          buyerDataEraseAfterDays: draft.eraseAfterDays,
          buyerDataEraseMode: draft.mode,
        });
      }
      for (const c of dirtyConnections) {
        await updateConnection.mutateAsync({
          connectionId: c.id,
          input: { config: withBuyerDataSettings(c.config, connDrafts[c.id] ?? null) },
        });
      }
      setConnDrafts({});
      showToast({ description: COPY.saved, tone: 'success' });
    } catch (error) {
      showToast({
        title: COPY.saveFailed,
        description: describeApiError(error, 'buyer-data'),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  function save(): void {
    if (needsConfirm) {
      setConfirming(true);
      return;
    }
    void persist();
  }

  const dialogCounts = startingNow.reduce(
    (sum, c) => ({
      toHide: sum.toHide + (scopePlans[c.id]?.toHide ?? 0),
      toErase: sum.toErase + (scopePlans[c.id]?.toErase ?? 0),
    }),
    { toHide: 0, toErase: 0 }
  );

  // Who follows the defaults decides what the Defaults tab counts: until the
  // connections are known an unscoped plan would count the wrong orders.
  if (connectionsQuery.isPending) {
    return <LoadingState liveRegion="off" title={COPY.title} message={COPY.loading} />;
  }

  return (
    <form
      className="buyer-data-page"
      onSubmit={(event) => {
        event.preventDefault();
        if (issues.length === 0 && changed) save();
      }}
      data-testid="buyer-data-page"
    >
      <Tabs value={tab} onValueChange={setTab} className="scope-tabs">
        <TabsList aria-label={scopeCopy.tabsLabel}>
          <TabsTrigger value={DEFAULTS_TAB}>{scopeCopy.defaultsTab}</TabsTrigger>
          {connections.map((c) => {
            const own = overrideOf(c) !== null;
            return (
              <TabsTrigger key={c.id} value={c.id}>
                {c.name}
                {own ? (
                  <span className="scope-tabs__dot" aria-label={scopeCopy.ownChip} />
                ) : (
                  <span className="scope-tabs__dot scope-tabs__dot--linked" aria-hidden="true" />
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value={DEFAULTS_TAB}>
          <p className="scope-tabs__lead">{scopeCopy.defaultsLead}</p>
          <RetentionScope
            name="general"
            rules={draft}
            savedEnabled={saved.enabled}
            followerIds={connections.length > 0 ? followerIds : undefined}
            planFollowers={
              connections.length > 0
                ? {
                    template: scopeCopy.plansFollowers,
                    connections: connections.filter((c) => overrideOf(c) === null),
                  }
                : undefined
            }
            onChange={setDraft}
            footer={comparison}
            onPlan={(preview) => {
              plans.current[DEFAULTS_TAB] = preview;
            }}
          />
        </TabsContent>

        {connections.map((c) => {
          const override = overrideOf(c);
          const own = override !== null;
          const effective = resolveBuyerDataRules(override, draft);
          return (
            <TabsContent key={c.id} value={c.id}>
              <div
                className={`scope-chain${own ? ' scope-chain--own' : ''}`}
                data-testid="scope-chain"
              >
                <ChainIcon linked={!own} />
                <div className="scope-chain__text">
                  {own ? (
                    <>
                      <StatusBadge tone="info">{scopeCopy.ownChip}</StatusBadge>
                      <span>{scopeCopy.ownLead}</span>
                    </>
                  ) : (
                    <>
                      <StatusBadge tone="neutral">{scopeCopy.linkedChip}</StatusBadge>
                      <span>{scopeCopy.linkedLead}</span>
                    </>
                  )}
                </div>
                {own ? (
                  <Button
                    type="button"
                    tone="secondary"
                    className="button--sm"
                    data-testid="scope-relink"
                    onClick={() => setConnection(c, null)}
                  >
                    {scopeCopy.relink}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    tone="secondary"
                    className="button--sm"
                    data-testid="scope-unlink"
                    onClick={() => setConnection(c, overrideFromRules(effective))}
                  >
                    {scopeCopy.unlink}
                  </Button>
                )}
              </div>
              {own ? (
                override.enabled === false && draft.enabled ? (
                  <p className="retention-scope__hint" data-testid="scope-disabled-here">
                    <StatusBadge tone="warning">{scopeCopy.offChip}</StatusBadge>{' '}
                    {scopeCopy.disabledHere}{' '}
                    <Button
                      type="button"
                      tone="secondary"
                      className="button--sm"
                      data-testid="scope-enable-here"
                      onClick={() => setConnection(c, withoutOwnSwitch(override))}
                    >
                      {scopeCopy.enableHere}
                    </Button>
                  </p>
                ) : (
                  <p className="retention-scope__hint" data-testid="scope-follows-switch">
                    {interpolate(scopeCopy.ownFollows, {
                      state: effective.enabled ? scopeCopy.stateOn : scopeCopy.stateOff,
                    })}
                  </p>
                )
              ) : (
                <p className="retention-scope__hint">
                  {interpolate(scopeCopy.linkedSwitch, {
                    state: draft.enabled ? scopeCopy.stateOn : scopeCopy.stateOff,
                  })}
                </p>
              )}
              <RetentionScope
                name={`conn-${c.id}`}
                connectionId={c.id}
                rules={effective}
                savedEnabled={resolveBuyerDataRules(savedOverride(c), saved).enabled}
                ghost={!own}
                showSwitch={own}
                footer={comparison}
                // A grab on a linked scope makes the shown values its own; they keep
                // following the general switch unless the operator moves it here.
                onChange={(next) =>
                  setConnection(c, nextBuyerDataOverride(override, effective, next, draft.enabled))
                }
                onPlan={(preview) => {
                  plans.current[c.id] = preview;
                }}
              />
            </TabsContent>
          );
        })}
      </Tabs>

      <div className="studio-actions" data-testid="buyer-data-actions">
        <div className="studio-actions__inner">
          <Button
            type="submit"
            disabled={!changed || issues.length > 0 || saving}
            data-testid="buyer-data-save"
          >
            {COPY.save}
          </Button>
          <Link className="button button--secondary" to="/settings">
            {COPY.cancel}
          </Link>
          {changed ? (
            <span className="studio-actions__draft" role="status">
              <i className="studio-actions__dot" aria-hidden="true" />
              {COPY.draftHint}
            </span>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={COPY.enableDialogTitle}
        tone="danger"
        description={interpolate(COPY.enableDialogBody, {
          toHide: dialogCounts.toHide,
          toErase: dialogCounts.toErase,
        })}
        body={
          <div data-testid="enable-dialog-connections">
            {startingNow.length > 0 ? (
              <ul className="buyer-data-points">
                {startingNow.map((c) => {
                  const plan = scopePlans[c.id];
                  return (
                    <li key={c.id}>
                      {plan === undefined
                        ? interpolate(COPY.enableDialogPending, { name: c.name })
                        : interpolate(COPY.enableDialogRow, {
                            name: c.name,
                            toHide: plan.toHide,
                            toErase: plan.toErase,
                          })}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {staysOff.length > 0 ? (
              <p className="rate-limit-section__help" data-testid="enable-dialog-stays-off">
                {interpolate(COPY.enableDialogStaysOff, {
                  names: staysOff.map((c) => c.name).join(', '),
                })}
              </p>
            ) : null}
          </div>
        }
        confirmLabel={COPY.enableDialogConfirm}
        onConfirm={() => {
          setConfirming(false);
          void persist();
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
      description={
        <>
          {COPY.description}{' '}
          <Infotip
            ariaLabel={COPY.defaultsTitle}
            definitions={[
              {
                term: COPY.defaultsTitle,
                text: (
                  <ul className="buyer-data-points">
                    <li>{COPY.defaultsPoint1}</li>
                    <li>{COPY.defaultsPoint2}</li>
                    <li data-testid="buyer-data-untouched">{COPY.untouched}</li>
                  </ul>
                ),
              },
            ]}
          />
        </>
      }
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
