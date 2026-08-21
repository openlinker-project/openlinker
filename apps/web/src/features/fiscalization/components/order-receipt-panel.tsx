/**
 * Order Receipt Panel (#1909)
 *
 * The fiscalization surface on the order detail page. Mirrors
 * `OrderInvoicePanel`'s structure — status header, connection picker while
 * nothing is registered, a KV block once something is, an inline alert for
 * failure states — but the fiscal-safety rules diverge from invoicing exactly
 * where ADR-042 says they must:
 *
 *   - v1 registers ONLY on an explicit "Register receipt" click. There is no
 *     auto-register and no primary-connection concept: OpenLinker never
 *     decides whether an order requires a receipt (ADR-042 dec. 9).
 *   - `in-doubt` NEVER offers a retry or a provider switch — only "Look it up"
 *     (the reconcile endpoint, a lookup by business coordinates, never a
 *     resend) and an acknowledgement that the operator has checked elsewhere.
 *   - `rejected` is the only failure that may register again, because it is
 *     the only one where the provider definitely created nothing.
 *   - both `documentReference` and `signingIdentity` render with fixed labels,
 *     independently, and a missing one reads as "Not reported" rather than
 *     collapsing into a single field — §3 ust. 4 requires both for the PL
 *     correction register.
 *   - a `registered` record with an empty artefact list is a SUCCESS, not an
 *     incomplete result.
 *
 * @module apps/web/src/features/fiscalization/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from '../../../shared/i18n';
import { useToast } from '../../../shared/ui/toast-provider';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { KeyValueList, type KeyValueItem } from '../../../shared/ui/key-value-list';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useConnectionsQuery } from '../../connections';

import { useOrderFiscalRegistrationsQuery } from '../hooks/use-order-fiscal-registrations-query';
import { useRegisterFiscalReceiptMutation } from '../hooks/use-register-fiscal-receipt-mutation';
import { useReconcileFiscalRegistrationMutation } from '../hooks/use-reconcile-fiscal-registration-mutation';
import { selectFiscalizationCandidates } from '../lib/resolve-fiscalization-connection';
import {
  canRetryFiscalReceipt,
  deriveFiscalReceiptDisplayStatus,
  resolveFiscalFailureCopy,
} from '../lib/derive-fiscal-receipt-display';
import { FiscalReceiptStatusBadge } from './fiscal-receipt-status-badge';
import { FiscalArtefactList } from './fiscal-artefact-list';
import type { FiscalRegistrationRecord } from '../api/fiscalization.types';

interface OrderReceiptPanelProps {
  orderId: string;
  /**
   * How many order lines carry no tax rate (#2255 / #2252).
   *
   * A fiscal receipt is refused for the same reason an invoice is, and it is
   * the FIRST reason where refusing the MANUAL path is right too: registering
   * anyway means a device stamping a tax letter nobody confirmed onto a receipt
   * that reaches the buyer and the daily report and cannot be recalled.
   *
   * Passed in rather than re-derived here, because the panel reads the
   * registration, not the order.
   */
  rateLessLineCount?: number;
}

function buildRegisteredFieldItems(
  record: FiscalRegistrationRecord,
  t: (key: string, fallback: string) => string,
): KeyValueItem[] {
  const notReported = <span className="text-muted">{t('fiscalReceipt.field.notReported', 'Not reported')}</span>;

  const items: KeyValueItem[] = [
    {
      id: 'documentReference',
      label: t('fiscalReceipt.field.documentReference', 'Receipt no.'),
      value: record.documentReference ?? notReported,
      mono: Boolean(record.documentReference),
    },
    {
      id: 'signingIdentity',
      label: t('fiscalReceipt.field.signingIdentity', 'Signing identity'),
      value: record.signingIdentity ?? notReported,
      mono: Boolean(record.signingIdentity),
    },
    {
      id: 'registeredAt',
      label: t('fiscalReceipt.field.registeredAt', 'Registered'),
      value: record.registeredAt ? (
        <TimeDisplay iso={record.registeredAt} format="datetime" className="mono-text" />
      ) : (
        <span className="text-muted">—</span>
      ),
    },
  ];

  if (record.regimeExtras) {
    for (const [key, value] of Object.entries(record.regimeExtras)) {
      items.push({ id: `extra-${key}`, label: key, value, mono: true });
    }
  }

  return items;
}

export function OrderReceiptPanel({
  orderId,
  rateLessLineCount = 0,
}: OrderReceiptPanelProps): ReactElement | null {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const connectionsQuery = useConnectionsQuery();

  const registrationsQuery = useOrderFiscalRegistrationsQuery(orderId);
  const registerMutation = useRegisterFiscalReceiptMutation();
  const reconcileMutation = useReconcileFiscalRegistrationMutation();

  const allConnections = connectionsQuery.data ?? [];
  const candidates = useMemo(() => selectFiscalizationCandidates(allConnections), [allConnections]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');

  // No capability at all: the panel has nothing to offer and nothing to show
  // (there can be no record without a connection that ever had the capability).
  if (!connectionsQuery.isLoading && candidates.length === 0) {
    return null;
  }

  // Newest record only — the panel shows the most recent attempt; a record on
  // a second connection is unusual (nothing in v1 prevents trying a different
  // connection after a rejection) but not this surface's concern to reconcile.
  const record = (registrationsQuery.data ?? [])[0] ?? null;
  const displayStatus = deriveFiscalReceiptDisplayStatus(record);
  const settled = !registrationsQuery.isError && !registrationsQuery.isLoading;

  const defaultConnectionId = candidates[0]?.id ?? '';

  const handleRegister = (connectionId: string): void => {
    if (!connectionId) return;
    registerMutation.mutate(
      { connectionId, orderId },
      {
        onError: () => {
          showToast({
            tone: 'error',
            title: t('fiscalReceipt.action.registerFailed', 'Could not register receipt'),
            description: t(
              'fiscalReceipt.action.registerFailedBody',
              'The request could not be sent. Nothing was registered.',
            ),
          });
        },
      },
    );
  };

  const handleReconcile = (): void => {
    if (!record) return;
    reconcileMutation.mutate(
      { id: record.id, orderId },
      {
        onSuccess: (result) => {
          if (result.outcome === 'resolved') {
            showToast({
              tone: 'success',
              title: t('fiscalReceipt.reconcile.resolved', 'Registration confirmed'),
              description: t(
                'fiscalReceipt.reconcile.resolvedBody',
                'The provider confirmed this sale was registered.',
              ),
            });
          } else if (result.outcome === 'not-found') {
            showToast({
              tone: 'info',
              title: t('fiscalReceipt.reconcile.notFound', 'Still not found'),
              description: t(
                'fiscalReceipt.reconcile.notFoundBody',
                'The provider has no matching registration yet. This will keep checking.',
              ),
            });
          } else {
            showToast({
              tone: 'info',
              title: t('fiscalReceipt.reconcile.unsupported', 'Cannot be looked up automatically'),
              description: t(
                'fiscalReceipt.reconcile.unsupportedBody',
                'This provider cannot be queried by OpenLinker. Check its own panel directly.',
              ),
            });
          }
        },
      },
    );
  };

  return (
    <section className="detail-section order-receipt-panel">
      <header className="order-receipt-panel__header">
        <h3 className="detail-section__title">{t('fiscalReceipt.panel.title', 'Fiscal receipt')}</h3>
        <FiscalReceiptStatusBadge status={displayStatus} />
      </header>

      {registrationsQuery.isError ? (
        <Alert tone="error">
          {t('fiscalReceipt.query.error', 'Could not load the receipt status.')}{' '}
          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => void registrationsQuery.refetch()}
          >
            {t('fiscalReceipt.query.retry', 'Retry')}
          </Button>
        </Alert>
      ) : null}

      {!registrationsQuery.isError && registrationsQuery.isLoading ? (
        <div className="order-receipt-panel__skeleton" aria-hidden="true" />
      ) : null}

      {/* #2255 / #2252 — the same rule as the invoice, on the receipt path. The
          per-connection tax letter is NOT used to fill the gap: a receipt
          carrying an unconfirmed rate reaches the buyer and the daily report and
          cannot be recalled, so the accepted cost is late registration. */}
      {settled && displayStatus === 'not-registered' && rateLessLineCount > 0 ? (
        <Alert tone="error">
          <strong>
            {rateLessLineCount === 1
              ? t('fiscalReceipt.blockNoRateTitleOne', 'Not registered: 1 line has no tax rate.')
              : `${t('fiscalReceipt.blockNoRateTitlePrefix', 'Not registered:')} ${String(rateLessLineCount)} ${t('fiscalReceipt.blockNoRateTitleSuffix', 'lines have no tax rate.')}`}
          </strong>{' '}
          {t(
            'fiscalReceipt.blockNoRateBody',
            "Add the rate in the shop's catalogue and re-sync the product. The connection's tax letter is not used to fill the gap.",
          )}
        </Alert>
      ) : null}

      {/* ── not-registered: connection pick (when >1) + manual register ── */}
      {settled && displayStatus === 'not-registered' ? (
        <div className="order-receipt-panel__actions">
          <p className="panel-copy">
            {t(
              'fiscalReceipt.notRegistered.body',
              'No receipt has been registered for this order. Whether this sale needs one is your call, not OpenLinker\'s.',
            )}
          </p>
          {candidates.length > 1 ? (
            <div className="form-field">
              <label className="form-field__label" htmlFor="fiscal-connection">
                {t('fiscalReceipt.panel.registerOnLabel', 'Register on')}
              </label>
              <Select
                id="fiscal-connection"
                value={selectedConnectionId || defaultConnectionId}
                onChange={(event) => setSelectedConnectionId(event.target.value)}
              >
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <Button
            tone="primary"
            disabled={registerMutation.isPending || rateLessLineCount > 0}
            onClick={() => handleRegister(selectedConnectionId || defaultConnectionId)}
          >
            {t('fiscalReceipt.action.register', 'Register receipt')}
          </Button>
          {/* The reason sits ON the control. A disabled button with the
              explanation only in an alert above reads as a bug. */}
          {rateLessLineCount > 0 ? (
            <span className="text-muted" style={{ fontSize: '0.82rem' }}>
              {rateLessLineCount === 1
                ? t('fiscalReceipt.refusedOne', 'no tax rate on 1 line')
                : `${t('fiscalReceipt.refusedPrefix', 'no tax rate on')} ${String(rateLessLineCount)} ${t('fiscalReceipt.refusedSuffix', 'lines')}`}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* ── registering: a live in-flight attempt holds the lease - wait, no action ── */}
      {settled && displayStatus === 'registering' ? (
        <>
          <div className="order-receipt-panel__skeleton" aria-hidden="true" />
          <p className="order-receipt-panel__notice">
            {t(
              'fiscalReceipt.registering.body',
              'Sent to the provider. This refreshes automatically when it responds.',
            )}
          </p>
        </>
      ) : null}

      {/* ── pending: the row exists but was NEVER actually sent (I6) - the
          adapter call never got claimed, most likely a connection misconfig.
          Distinct copy from `registering`, and an action so this is not a
          dead end: `register` resumes a claimless `pending` row exactly like
          a fresh attempt. ── */}
      {settled && displayStatus === 'pending' && record ? (
        <>
          <p className="order-receipt-panel__notice">
            {t(
              'fiscalReceipt.pending.body',
              'Queued, but not yet sent to the provider. Nothing was registered.',
            )}
          </p>
          <div className="order-receipt-panel__actions">
            <Button
              tone="secondary"
              disabled={registerMutation.isPending}
              onClick={() => handleRegister(record.connectionId)}
            >
              {t('fiscalReceipt.action.register', 'Register receipt')}
            </Button>
          </div>
        </>
      ) : null}

      {/* ── registered: KV block + artefacts (empty list is a SUCCESS) ── */}
      {settled && displayStatus === 'registered' && record ? (
        <div className="order-receipt-panel__body">
          <KeyValueList items={buildRegisteredFieldItems(record, t)} />
          {record.artefacts && record.artefacts.length > 0 ? (
            <FiscalArtefactList artefacts={record.artefacts} />
          ) : (
            <Alert tone="success">
              {t(
                'fiscalReceipt.registered.noArtefact',
                'Registered, with nothing to hand over. This provider reports the registration only.',
              )}
            </Alert>
          )}
        </div>
      ) : null}

      {/* ── rejected: retryable failure ── */}
      {settled && displayStatus === 'rejected' && record ? (
        <>
          <div className="order-receipt-panel__body">
            <Alert tone="error">{resolveFiscalFailureCopy(record, t)}</Alert>
          </div>
          <div className="order-receipt-panel__actions">
            <Button
              tone="secondary"
              disabled={registerMutation.isPending || !canRetryFiscalReceipt(record)}
              onClick={() => handleRegister(record.connectionId)}
            >
              {t('fiscalReceipt.action.retry', 'Register receipt')}
            </Button>
          </div>
        </>
      ) : null}

      {/* ── in-doubt: NO retry, NO provider switch — only Look it up ── */}
      {settled && displayStatus === 'in-doubt' && record ? (
        <>
          <div className="order-receipt-panel__body">
            <Alert tone="warning" title={t('fiscalReceipt.inDoubt.title', 'This sale may already be registered')}>
              {resolveFiscalFailureCopy(record, t)}{' '}
              {t(
                'fiscalReceipt.inDoubt.noRetry',
                'Registering again could produce a second fiscal receipt, so OpenLinker will not do that on its own.',
              )}
            </Alert>
          </div>
          <div className="order-receipt-panel__actions">
            <Button
              tone="secondary"
              disabled={reconcileMutation.isPending}
              onClick={handleReconcile}
            >
              {t('fiscalReceipt.action.lookUp', 'Look it up')}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
