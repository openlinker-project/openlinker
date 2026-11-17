import type { ReactElement, ReactNode } from 'react';
import { env } from '../../shared/config/env';
import { isOmsRoutingUiEnabled } from '../../shared/config/oms-routing-ui';
import { useSession } from '../../shared/auth/use-session';
import { CurrencySettingsTile } from '../../features/currency-settings/components/currency-settings-tile';
import { MailerSettingsTile } from '../../features/mailer-settings/components/mailer-settings-tile';
import { PosthogSettingsTile } from '../../features/posthog-settings/components/posthog-settings-tile';
import { McpTokensTile } from '../../features/mcp-tokens/components/mcp-tokens-tile';
import { SalesDocumentsTile } from '../../features/sales-documents';
import { WhoDecidesTile } from '../../features/fulfillment-authority';
import { SourcingRulesTile } from '../../features/oms';
import { SyncPacingTile } from '../../features/settings';
import { InventoryLocationsTile } from '../../features/inventory';
import { OrderTagsSettingsTile } from '../../features/orders/components/order-tags-settings-tile';
import { BuyerEmailsTile } from '../../features/buyer-emails';
import { LoginPageSettingsTile } from '../../features/login-page-settings';
import { SettingsPageFrame } from '../../shared/ui/settings-page-frame';
import type { SettingsPageSection } from '../../shared/ui/settings-page-template';
import { useMessages } from '../../shared/i18n';

/**
 * The settings hub. Areas are grouped by what an operator is trying to do, not
 * by who built them; a group with no tile the current role may open is left out
 * instead of rendering an empty heading.
 */
export function SettingsPage(): ReactElement {
  const { isReady, session } = useSession();
  const copy = useMessages('settings').settingsPage;
  const isAdmin = isReady && session.status === 'authenticated' && session.user?.role === 'admin';
  // #3634 - both OMS routing tiles are withheld unless the build opts in.
  const omsRoutingUi = isOmsRoutingUiEnabled();
  const tpl = useMessages('settings').template;

  const group = (
    id: string,
    meta: { short: string; title: string; hint: string },
    tiles: ReactNode[],
  ): SettingsPageSection[] => {
    const visible = tiles.filter(Boolean);
    if (visible.length === 0) return [];
    return [
      {
        id,
        label: meta.short,
        title: meta.title,
        hint: meta.hint,
        children: <div className="settings-hub__grid">{visible}</div>,
      },
    ];
  };

  const sections: SettingsPageSection[] = [
    {
      id: 'environment',
      label: tpl.settingsEnv.short,
      title: tpl.settingsEnv.title,
      hint: tpl.settingsEnv.hint,
      children: (
        <>
          {isReady && session.status === 'authenticated' && session.user !== null ? (
            <dl className="settings-hub__facts">
              <div>
                <dt>{copy.environment.environment}</dt>
                <dd className="mono-text">{env.VITE_APP_ENV}</dd>
              </div>
              <div>
                <dt>{copy.environment.apiBaseUrl}</dt>
                <dd className="mono-text">{env.VITE_API_BASE_URL}</dd>
              </div>
              <div>
                <dt>{copy.account.username}</dt>
                <dd>{session.user.username}</dd>
              </div>
              <div>
                <dt>{copy.account.email}</dt>
                <dd>{session.user.email ?? '—'}</dd>
              </div>
              <div>
                <dt>{copy.account.role}</dt>
                <dd>{session.user.role}</dd>
              </div>
            </dl>
          ) : (
            <>
              <dl className="settings-hub__facts">
                <div>
                  <dt>{copy.environment.environment}</dt>
                  <dd className="mono-text">{env.VITE_APP_ENV}</dd>
                </div>
                <div>
                  <dt>{copy.environment.apiBaseUrl}</dt>
                  <dd className="mono-text">{env.VITE_API_BASE_URL}</dd>
                </div>
              </dl>
              {!isReady ? (
                <p className="muted-text" aria-live="polite">
                  {copy.account.loading}
                </p>
              ) : (
                <p className="muted-text">{copy.account.anonymous}</p>
              )}
            </>
          )}
          {isReady && session.status === 'authenticated' && !isAdmin ? (
            <p className="settings-hub__note">{copy.adminNote}</p>
          ) : null}
        </>
      ),
    },
    ...group('data', tpl.settingsGroups.data, [
      isAdmin ? <SyncPacingTile key="sync" /> : null,
      isAdmin ? <CurrencySettingsTile key="currency" /> : null,
      omsRoutingUi ? <InventoryLocationsTile key="locations" /> : null,
      omsRoutingUi && isAdmin ? <SourcingRulesTile key="sourcing" /> : null,
    ]),
    ...group('orders', tpl.settingsGroups.orders, [
      isAdmin ? <SalesDocumentsTile key="documents" /> : null,
      // Deliberately NOT admin-gated - see `WhoDecidesTile`'s docblock.
      <WhoDecidesTile key="who" />,
      isAdmin ? <OrderTagsSettingsTile key="tags" /> : null,
      isAdmin ? <BuyerEmailsTile key="emails" /> : null,
      isAdmin ? <MailerSettingsTile key="mailer" /> : null,
    ]),
    ...group('access', tpl.settingsGroups.access, [
      isAdmin ? <McpTokensTile key="mcp" /> : null,
      isAdmin ? <LoginPageSettingsTile key="login" /> : null,
      isAdmin ? <PosthogSettingsTile key="posthog" /> : null,
    ]),
    {
      id: 'soon',
      label: tpl.settingsSoon.short,
      title: tpl.settingsSoon.title,
      hint: tpl.settingsSoon.hint,
      children: (
        <ul className="settings-hub__planned">
          {[copy.notifications, copy.organization, copy.preferences].map((item) => (
            <li key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      ),
    },
  ];

  return (
    <SettingsPageFrame
      wide
      title={copy.title}
      short={tpl.settingsHome.short}
      description={copy.description}
      sections={sections}
    />
  );
}
