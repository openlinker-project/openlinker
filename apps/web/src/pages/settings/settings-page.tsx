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
import { ReleaseCenterRow, SyncPacingTile } from '../../features/settings';
import { InventoryLocationsTile } from '../../features/inventory';
import { OrderTagsSettingsTile } from '../../features/orders/components/order-tags-settings-tile';
import { BuyerEmailsTile } from '../../features/buyer-emails';
import { LoginPageSettingsTile } from '../../features/login-page-settings';
import { SettingsPageFrame } from '../../shared/ui/settings-page-frame';
import { SettingsIndexList } from '../../shared/ui/settings-index-row';
import { SettingsFactsBar } from '../../shared/ui/settings-facts-bar';
import { APP_VERSION } from '../../shared/config/app-version';
import type { SettingsPageSection } from '../../shared/ui/settings-page-template';
import { interpolate, useMessages } from '../../shared/i18n';

/**
 * The settings hub (#4154): a scannable index. Rows are grouped by what an
 * operator is trying to do, each with its current value and one action. A row
 * the signed-in role may not open stays listed and locked, so nobody has to
 * guess whether an area exists; only a group with nothing in it is left out.
 */
export function SettingsPage(): ReactElement {
  const { isReady, session } = useSession();
  const copy = useMessages('settings').settingsPage;
  const tpl = useMessages('settings').template;
  const user = isReady && session.status === 'authenticated' ? session.user : null;
  const locked = user?.role !== 'admin';
  // #3634 - both OMS routing rows are withheld unless the build opts in.
  const omsRoutingUi = isOmsRoutingUiEnabled();

  const group = (
    id: string,
    meta: { short: string; title: string; hint: string },
    rows: ReactNode[],
    footer?: ReactNode,
  ): SettingsPageSection => {
    const visible = rows.filter(Boolean);
    return {
      id,
      label: meta.short,
      title: meta.title,
      hint: meta.hint,
      badge: <span className="settings-index__count">{visible.length}</span>,
      children: (
        <>
          <SettingsIndexList pending={!isReady}>{visible}</SettingsIndexList>
          {footer}
        </>
      ),
    };
  };

  const sections: SettingsPageSection[] = [
    {
      id: 'environment',
      label: tpl.settingsEnv.short,
      title: tpl.settingsEnv.title,
      hint: tpl.settingsEnv.hint,
      children: (
        <SettingsFactsBar
          facts={[
            {
              id: 'env',
              label: copy.environment.environment,
              value: (
                <span className="settings-chip" data-tone={env.VITE_APP_ENV === 'production' ? 'success' : 'info'}>
                  {env.VITE_APP_ENV}
                </span>
              ),
            },
            ...(APP_VERSION ? [{ id: 'version', label: copy.environment.version, value: `v${APP_VERSION}` }] : []),
            user
              ? {
                  id: 'account',
                  label: copy.account.signedInAs,
                  value: user.username,
                  note: user.email ?? undefined,
                }
              : {
                  id: 'account',
                  label: copy.account.title,
                  value: isReady ? copy.account.anonymous : copy.account.loading,
                },
            ...(user
              ? [
                  {
                    id: 'role',
                    label: copy.account.role,
                    value: <span className="settings-chip">{user.role}</span>,
                  },
                ]
              : []),
            { id: 'api', label: copy.environment.apiBaseUrl, value: env.VITE_API_BASE_URL, mono: true, wide: true },
          ]}
        />
      ),
    },
    group('data', tpl.settingsGroups.data, [
      <SyncPacingTile key="sync" locked={locked} />,
      <CurrencySettingsTile key="currency" locked={locked} />,
      omsRoutingUi ? <InventoryLocationsTile key="locations" locked={locked} /> : null,
      omsRoutingUi ? <SourcingRulesTile key="sourcing" locked={locked} /> : null,
    ]),
    group('orders', tpl.settingsGroups.orders, [
      <SalesDocumentsTile key="documents" locked={locked} />,
      // Deliberately NOT locked for a read-only role - see `WhoDecidesTile`'s docblock.
      <WhoDecidesTile key="who" />,
      <OrderTagsSettingsTile key="tags" locked={locked} />,
      <BuyerEmailsTile key="emails" locked={locked} />,
      <MailerSettingsTile key="mailer" locked={locked} />,
    ]),
    group(
      'access',
      tpl.settingsGroups.access,
      [
        <McpTokensTile key="mcp" locked={locked} />,
        <ReleaseCenterRow key="release" locked={locked} />,
        <LoginPageSettingsTile key="login" locked={locked} />,
        <PosthogSettingsTile key="posthog" locked={locked} />,
      ],
      <p className="settings-index__soon">
        {interpolate(copy.plannedLine, {
          items: [copy.notifications.title, copy.organization.title, copy.preferences.title]
            .map((item) => item.toLowerCase())
            .join(', '),
        })}
      </p>,
    ),
  ];

  return (
    <SettingsPageFrame
      wide
      plain
      title={copy.title}
      short={tpl.settingsHome.short}
      description={copy.description}
      sections={sections}
    />
  );
}
