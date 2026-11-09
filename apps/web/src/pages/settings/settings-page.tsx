import type { ReactElement } from 'react';
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
import { PageLayout } from '../../shared/ui/page-layout';
import { useMessages } from '../../shared/i18n';

export function SettingsPage(): ReactElement {
  const { isReady, session } = useSession();
  const copy = useMessages('settings').settingsPage;
  const isAdmin = isReady && session.status === 'authenticated' && session.user?.role === 'admin';
  // #3634 - both OMS routing tiles are withheld unless the build opts in.
  const omsRoutingUi = isOmsRoutingUiEnabled();
  const loginPageCopy = useMessages('login-page-settings');

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">{copy.chips.environment}</span>
          <span className="toolbar-chip">{copy.chips.account}</span>
          {isAdmin ? <span className="toolbar-chip">{copy.chips.currency}</span> : null}
          {isAdmin ? <span className="toolbar-chip">{copy.chips.mailer}</span> : null}
          {isAdmin ? <span className="toolbar-chip">{copy.chips.posthog}</span> : null}
          {isAdmin ? <span className="toolbar-chip">{copy.chips.mcpTokens}</span> : null}
          {isAdmin ? <span className="toolbar-chip">{copy.chips.salesDocuments}</span> : null}
          {/* Ungated, unlike its admin-gated neighbours - see `WhoDecidesTile`'s docblock. */}
          <span className="toolbar-chip">{copy.chips.whoDecides}</span>
          {omsRoutingUi && isAdmin ? <span className="toolbar-chip">{copy.chips.sourcingRules}</span> : null}
          {isAdmin ? <span className="toolbar-chip">{copy.chips.syncPacing}</span> : null}
          {isAdmin ? <span className="toolbar-chip">{copy.chips.orderTags}</span> : null}
          {isAdmin ? <span className="toolbar-chip">{copy.chips.buyerEmails}</span> : null}
          {isAdmin ? <span className="toolbar-chip">{loginPageCopy.title}</span> : null}
          {/* Role-ungated — see `InventoryLocationsTile`'s docblock. */}
          {omsRoutingUi ? <span className="toolbar-chip">{copy.chips.inventoryLocations}</span> : null}
          <span className="toolbar-chip">{copy.chips.upcoming}</span>
        </div>
      }
    >
      <div className="workspace-grid">
        {/* ── Environment ──────────────────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{copy.environment.eyebrow}</p>
              <h3 className="section-title">{copy.environment.title}</h3>
            </div>
            <span className="panel__meta">{copy.environment.meta}</span>
          </div>
          <dl className="definition-list">
            <div>
              <dt>{copy.environment.environment}</dt>
              <dd className="mono-text">{env.VITE_APP_ENV}</dd>
            </div>
            <div>
              <dt>{copy.environment.apiBaseUrl}</dt>
              <dd className="mono-text">{env.VITE_API_BASE_URL}</dd>
            </div>
          </dl>
        </article>

        {/* ── Account ──────────────────────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{copy.account.eyebrow}</p>
              <h3 className="section-title">{copy.account.title}</h3>
            </div>
            <span className="panel__meta">{copy.account.meta}</span>
          </div>

          {!isReady && (
            <p className="muted-text" aria-live="polite">
              {copy.account.loading}
            </p>
          )}

          {isReady && session.status === 'anonymous' && (
            <p className="muted-text">{copy.account.anonymous}</p>
          )}

          {isReady && session.status === 'authenticated' && session.user !== null && (
            <dl className="definition-list">
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
          )}
        </article>

        {/* ── Currency (admin-only) ─────────────────────────────────── */}
        {isAdmin ? <CurrencySettingsTile /> : null}

        {/* ── Mailer (admin-only) ──────────────────────────────────── */}
        {isAdmin ? <MailerSettingsTile /> : null}

        {/* ── PostHog analytics (admin-only) ──────────────────────── */}
        {isAdmin ? <PosthogSettingsTile /> : null}

        {/* ── MCP tokens (admin-only) ──────────────────────────────── */}
        {isAdmin ? <McpTokensTile /> : null}

        {/* ── Sales documents (admin-only, #2159) ───────────────────── */}
        {isAdmin ? <SalesDocumentsTile /> : null}
        {/* Deliberately NOT admin-gated — see `WhoDecidesTile`'s docblock. */}
        <WhoDecidesTile />

        {/* ── Sourcing rules (admin-only, #3060) ────────────────────── */}
        {omsRoutingUi && isAdmin ? <SourcingRulesTile /> : null}

        {/* ── Sync pacing (admin-only, #2653) ───────────────────────── */}
        {isAdmin ? <SyncPacingTile /> : null}

        {/* ── Order tags (admin-only, #3532/#3533, D34) ─────────────── */}
        {isAdmin ? <OrderTagsSettingsTile /> : null}
        {isAdmin ? <BuyerEmailsTile /> : null}

        {/* ── Login page (admin-only, #4029) ──────────────────────── */}
        {isAdmin ? <LoginPageSettingsTile /> : null}

        {/* Deliberately NOT admin-gated — see `InventoryLocationsTile`'s docblock. */}
        {omsRoutingUi ? <InventoryLocationsTile /> : null}

        {/* ── Notifications (planned) ───────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{copy.notifications.eyebrow}</p>
              <h3 className="section-title">{copy.notifications.title}</h3>
            </div>
            <span className="panel__meta">{copy.comingSoon}</span>
          </div>
          <p className="muted-text panel-copy">
            {copy.notifications.body}
          </p>
        </article>

        {/* ── Organization (planned) ───────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{copy.organization.eyebrow}</p>
              <h3 className="section-title">{copy.organization.title}</h3>
            </div>
            <span className="panel__meta">{copy.comingSoon}</span>
          </div>
          <p className="muted-text panel-copy">
            {copy.organization.body}
          </p>
        </article>

        {/* ── Preferences (planned) ─────────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{copy.preferences.eyebrow}</p>
              <h3 className="section-title">{copy.preferences.title}</h3>
            </div>
            <span className="panel__meta">{copy.comingSoon}</span>
          </div>
          <p className="muted-text panel-copy">
            {copy.preferences.body}
          </p>
        </article>
      </div>
    </PageLayout>
  );
}
