/**
 * New Connection Page
 *
 * Step 1 of the connection setup flow: platform picker. Each platform
 * links to its own guided wizard at `/connections/new/{platform}`; an
 * advanced escape-hatch route is also exposed.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { PlatformPicker } from '../../features/connections/components/platform-picker';
import { PageLayout } from '../../shared/ui/page-layout';

export function NewConnectionPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Add a connection"
      description="Pick the platform you want to connect. Each platform has a guided setup flow — no raw adapter keys or config JSON required."
      actions={
        <Link className="button button--secondary" to="/connections">
          Back to integrations
        </Link>
      }
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">Guided setup</span>
          <span className="toolbar-chip">Per-platform wizards</span>
        </div>
      }
    >
      <PlatformPicker />
    </PageLayout>
  );
}
