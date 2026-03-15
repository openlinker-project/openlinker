import type { ReactElement } from 'react';
import { EmptyState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';

export function AllegroConnectCallbackPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="OAuth callback"
      title="Allegro callback checkpoint"
      description="This route reserves the browser return point for a future step-based integration onboarding flow."
      summary={
        <>
          <div className="toolbar__group">
            <span className="toolbar-chip">Reserved route</span>
            <span className="toolbar-chip">OAuth boundary</span>
          </div>
          <div className="toolbar__group">
            <span className="muted-text">The callback exists now so the app shell does not need to change when OAuth is implemented.</span>
          </div>
        </>
      }
    >
      <EmptyState
        eyebrow="Setup wizard"
        title="Flow placeholder"
        message="FE-001 defines the route boundary now so OAuth can be added later without changing the shell or page model."
      />
    </PageLayout>
  );
}
