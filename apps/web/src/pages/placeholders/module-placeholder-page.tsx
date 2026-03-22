import type { ReactElement } from 'react';
import { EmptyState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';

interface ModulePlaceholderPageProps {
  description: string;
  eyebrow: string;
  moduleName: string;
  title: string;
}

export function ModulePlaceholderPage({
  description,
  eyebrow,
  moduleName,
  title,
}: ModulePlaceholderPageProps): ReactElement {
  return (
    <PageLayout
      eyebrow={eyebrow}
      title={title}
      description={description}
      summary={
        <>
          <div className="toolbar__group">
            <span className="toolbar-chip">Planned module</span>
            <span className="toolbar-chip">Route placeholder</span>
          </div>
          <div className="toolbar__group">
            <span className="muted-text">Visible in navigation so the shell and route model can evolve predictably.</span>
          </div>
        </>
      }
    >
      <EmptyState
        eyebrow="Coming next"
        title={`${moduleName} is planned`}
        message="This route is intentionally available now so future feature work can land without changing the shell structure or navigation contracts."
      />
    </PageLayout>
  );
}
