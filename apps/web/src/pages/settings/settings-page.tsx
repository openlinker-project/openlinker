import type { ReactElement } from 'react';
import { env } from '../../shared/config/env';
import { useSession } from '../../shared/auth/use-session';
import { PageLayout } from '../../shared/ui/page-layout';

export function SettingsPage(): ReactElement {
  const { isReady, session } = useSession();

  return (
    <PageLayout
      eyebrow="Settings"
      title="Settings"
      description="Platform configuration, session context, and upcoming operator preferences."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">Environment</span>
          <span className="toolbar-chip">Account</span>
          <span className="toolbar-chip">Upcoming</span>
        </div>
      }
    >
      <div className="workspace-grid">
        {/* ── Environment ──────────────────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Runtime</p>
              <h3 className="section-title">Environment</h3>
            </div>
            <span className="panel__meta">Build-time config</span>
          </div>
          <dl className="definition-list">
            <div>
              <dt>Environment</dt>
              <dd className="mono-text">{env.VITE_APP_ENV}</dd>
            </div>
            <div>
              <dt>API base URL</dt>
              <dd className="mono-text">{env.VITE_API_BASE_URL}</dd>
            </div>
          </dl>
        </article>

        {/* ── Account ──────────────────────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Session</p>
              <h3 className="section-title">Account</h3>
            </div>
            <span className="panel__meta">Read-only</span>
          </div>

          {!isReady && (
            <p className="muted-text" aria-live="polite">
              Loading session…
            </p>
          )}

          {isReady && session.status === 'anonymous' && (
            <p className="muted-text">No active session.</p>
          )}

          {isReady && session.status === 'authenticated' && session.user !== null && (
            <dl className="definition-list">
              <div>
                <dt>Username</dt>
                <dd>{session.user.username}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{session.user.email ?? '—'}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{session.user.role}</dd>
              </div>
            </dl>
          )}
        </article>

        {/* ── Notifications (planned) ───────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Alerts</p>
              <h3 className="section-title">Notifications</h3>
            </div>
            <span className="panel__meta">Coming soon</span>
          </div>
          <p className="muted-text panel-copy">
            Sync failure alerts, manual-review triggers, and threshold notifications will be configurable here.
          </p>
        </article>

        {/* ── Organization (planned) ───────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Workspace</p>
              <h3 className="section-title">Organization</h3>
            </div>
            <span className="panel__meta">Coming soon</span>
          </div>
          <p className="muted-text panel-copy">
            Team members, roles, and workspace-level settings will be managed here.
          </p>
        </article>

        {/* ── Preferences (planned) ─────────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Display</p>
              <h3 className="section-title">Preferences</h3>
            </div>
            <span className="panel__meta">Coming soon</span>
          </div>
          <p className="muted-text panel-copy">
            Timezone, date format, and display density options will be available here.
          </p>
        </article>
      </div>
    </PageLayout>
  );
}
