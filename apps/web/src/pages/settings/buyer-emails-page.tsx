/**
 * Buyer Emails Settings Page (#3555, mockup M21 `list` / `list-loading`)
 *
 * Pick a connection that takes orders, turn its buyer emails on or off, and
 * see each template's state; "Edit" opens the template editor. Off by default
 * (D6) - the page says so, and that the channel already notifies its buyers.
 * A marketplace connection is offered only the transactional templates, with a
 * sentence saying why "Order confirmed" is missing. Admin only, like every
 * write behind it: gated on `connections:write`, which only an administrator
 * holds, through `AccessGate` so the session-hydration window is handled once.
 *
 * @module apps/web/src/pages/settings
 */
import { useId, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { describeApiError } from '../../shared/api/describe-api-error';
import { PageLayout } from '../../shared/ui/page-layout';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Select } from '../../shared/ui/select';
import { AccessDeniedState, EmptyState, LoadingState } from '../../shared/ui/feedback-state';
import { AccessGate } from '../../shared/ui/access-gate';
import { StatusBadge } from '../../shared/ui/status-badge';
import { useToast } from '../../shared/ui/toast-provider';
import { useConnectionsQuery, type Connection } from '../../features/connections';
import { useMessages } from '../../shared/i18n';
import {
  channelKindOf,
  readBuyerEmailsSettings,
  templateCopy,
  templatesFor,
  useBuyerEmailRules,
  useSetBuyerEmailsEnabledMutation,
  type BuyerEmailTemplate,
} from '../../features/buyer-emails';

/** Buyer emails are about orders, so only a connection orders come from is offered. */
function takesOrders(connection: Connection): boolean {
  return connection.status !== 'archived' && connection.enabledCapabilities.includes('OrderSource');
}

function ConnectionSettings({
  connection,
  isRuleMissing,
}: {
  connection: Connection;
  /** True only once the rules are read and this template has none; never on a failed read. */
  isRuleMissing: (template: BuyerEmailTemplate) => boolean;
}): ReactElement {
  const COPY = useMessages('buyer-emails').page;
  const { showToast } = useToast();
  const update = useSetBuyerEmailsEnabledMutation();
  const switchId = useId();
  const settings = readBuyerEmailsSettings(connection.config);
  const kind = channelKindOf(connection.enabledCapabilities);

  function toggleMaster(enabled: boolean): void {
    update.mutate(
      { connectionId: connection.id, enabled },
      {
        onSuccess: () => showToast({ description: COPY.saved, tone: 'success' }),
        onError: (error) => showToast({ description: describeApiError(error, 'buyer-emails'), tone: 'error' }),
      },
    );
  }

  return (
    <div data-mk-state="list" data-testid="buyer-emails-list">
      <section className="panel panel--dense">
        <label className="buyer-emails-switch" htmlFor={switchId}>
          <input
            id={switchId}
            type="checkbox"
            checked={settings.enabled}
            disabled={update.isPending}
            onChange={(event) => toggleMaster(event.target.checked)}
            data-testid="buyer-emails-master-switch"
          />
          <span>{COPY.masterLabel}</span>
        </label>
        <p className="muted-text" data-testid="buyer-emails-off-note">
          {COPY.offNote}
        </p>
      </section>

      {kind === 'marketplace' ? (
        <Alert tone="info" data-testid="buyer-emails-marketplace-note">
          {COPY.marketplaceNote}
        </Alert>
      ) : null}

      <div className="data-table__container">
        <table className="data-table buyer-emails-table" data-testid="buyer-emails-table">
          <thead>
            <tr>
              <th scope="col">{COPY.templateHeader}</th>
              <th scope="col">{COPY.statusHeader}</th>
              <th scope="col" className="data-table__cell--hide-below-768">
                {COPY.senderHeader}
              </th>
              <th scope="col" className="data-table__cell--right">
                <span className="sr-only">{COPY.edit}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {templatesFor(kind).map((template) => {
              const templateSettings = settings.templates[template];
              const on = templateSettings?.enabled === true;
              return (
                <tr key={template} data-testid="buyer-email-template-row" data-template={template}>
                  <td>
                    <strong>{templateCopy(template).label}</strong>
                    <p className="muted-text">{templateCopy(template).description}</p>
                  </td>
                  <td>
                    {isRuleMissing(template) ? (
                      <StatusBadge tone="warning">{COPY.statusNoRule}</StatusBadge>
                    ) : on && settings.enabled ? (
                      <StatusBadge tone="success">{COPY.statusOn}</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">
                        {on ? COPY.statusInactiveBecauseMaster : COPY.statusOff}
                      </StatusBadge>
                    )}
                  </td>
                  <td className="data-table__cell--hide-below-768">
                    <span className="mono-text">
                      {templateSettings?.fromAddress ?? COPY.defaultSender}
                    </span>
                  </td>
                  <td className="data-table__cell--right">
                    <Link
                      className="button button--secondary button--sm"
                      to={`/settings/buyer-emails/${encodeURIComponent(connection.id)}/${template}`}
                      data-testid="buyer-email-template-edit"
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
    </div>
  );
}

export function BuyerEmailsPage(): ReactElement {
  const COPY = useMessages('buyer-emails').page;
  const [searchParams, setSearchParams] = useSearchParams();
  const connectionsQuery = useConnectionsQuery();
  // A template with no seeded rule never sends, so the list must not call it "On".
  const rules = useBuyerEmailRules();
  const isRuleMissing = (template: BuyerEmailTemplate): boolean =>
    !rules.isLoading && !rules.isError && rules.rules[template] === null;
  const connections = (connectionsQuery.data ?? []).filter(takesOrders);
  const selectedId = searchParams.get('connection') ?? connections[0]?.id ?? '';
  const selected = connections.find((connection) => connection.id === selectedId) ?? null;

  return (
    <PageLayout
      backTo={{ to: '/settings', label: COPY.settings }}
      eyebrow={COPY.settings}
      title={COPY.title}
      description={COPY.description}
    >
      <AccessGate require="connections:write" fallback={<AccessDeniedState message={COPY.adminOnly} />}>
        {connectionsQuery.isLoading ? (
          <div data-mk-state="list-loading" data-testid="buyer-emails-loading">
            <LoadingState liveRegion="off" title={COPY.title} message={COPY.loadingConnections} />
          </div>
        ) : connectionsQuery.isError ? (
          <Alert tone="error">{COPY.loadError}</Alert>
        ) : connections.length === 0 ? (
          <EmptyState liveRegion="off" title={COPY.title} message={COPY.noConnections} />
        ) : (
          <>
            <FormField label={COPY.connectionLabel} name="buyer-emails-connection">
              <Select
                value={selectedId}
                onChange={(event) => setSearchParams({ connection: event.target.value })}
                data-testid="buyer-emails-connection-select"
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </Select>
            </FormField>
            {selected ? <ConnectionSettings key={selected.id} connection={selected} isRuleMissing={isRuleMissing} /> : null}
          </>
        )}
      </AccessGate>
    </PageLayout>
  );
}
