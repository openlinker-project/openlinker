/**
 * Login Page Settings Tile
 *
 * The Settings entry for the login page editor (#4029). Admin-only; the
 * settings page gates it.
 *
 * @module features/login-page-settings/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useMessages } from '../../../shared/i18n';

export function LoginPageSettingsTile(): ReactElement {
  const copy = useMessages('login-page-settings');
  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
      </div>
      <p className="muted-text">{copy.tile}</p>
      <Link className="button button--secondary button--sm" to="/settings/login-page">
        {copy.title}
      </Link>
    </article>
  );
}
