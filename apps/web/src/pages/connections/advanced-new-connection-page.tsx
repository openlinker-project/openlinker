/**
 * Advanced New Connection Page
 *
 * Escape-hatch page exposing the raw connection form (platform dropdown,
 * credentials reference, adapter key, config JSON). Used when a guided
 * wizard does not yet exist for a platform or when direct control is
 * needed.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { CreateConnectionForm } from '../../features/connections/components/create-connection-form';
import { PageLayout } from '../../shared/ui/page-layout';
import { renderRich, useMessages } from '../../shared/i18n';

export function AdvancedNewConnectionPage(): ReactElement {
  const copy = useMessages('connections');
  const page = copy.advancedNewConnectionPage;
  return (
    <PageLayout
      eyebrow={copy.setup.eyebrow}
      title={page.title}
      description={page.description}
      actions={
        <Link className="button button--secondary" to="/connections/new">
          {copy.setup.back}
        </Link>
      }
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">{page.rawFormChip}</span>
          <span className="toolbar-chip">{page.escapeHatchChip}</span>
        </div>
      }
    >
      <div className="advanced-banner" role="note">
        <div>
          <p className="advanced-banner__title">{page.bannerTitle}</p>
          <p>
            {renderRich(page.bannerBody, {
              link: (text) => <Link to="/connections/new">{text}</Link>,
            })}
          </p>
        </div>
      </div>
      <CreateConnectionForm />
    </PageLayout>
  );
}
