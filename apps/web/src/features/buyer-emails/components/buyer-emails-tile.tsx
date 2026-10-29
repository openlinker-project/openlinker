/**
 * Buyer Emails Settings Tile (#3555)
 *
 * The `SettingsPage` entry point for `/settings/buyer-emails`, a link-out card
 * like `OrderTagsSettingsTile`. Admin only: every write behind the page
 * (connection config, automation rules, test send) is `@Roles('admin')`.
 *
 * @module apps/web/src/features/buyer-emails/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { BUYER_EMAILS_COPY } from '../lib/buyer-emails.copy';

const COPY = BUYER_EMAILS_COPY.tile;

export function BuyerEmailsTile(): ReactElement {
  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{COPY.eyebrow}</p>
          <h3 className="section-title">{COPY.title}</h3>
        </div>
      </div>
      <p className="muted-text">{COPY.description}</p>
      <Link className="button button--secondary button--sm" to="/settings/buyer-emails">
        {COPY.link}
      </Link>
    </article>
  );
}
