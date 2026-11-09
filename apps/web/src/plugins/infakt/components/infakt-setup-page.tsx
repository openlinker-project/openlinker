/**
 * Infakt Setup Page
 *
 * Page wrapper for the guided inFakt connection wizard.
 */
import type { ReactElement } from 'react';
import { InfaktSetupForm } from './infakt-setup-form';
import { PageLayout } from '../../../shared/ui/page-layout';
import { useInfaktMessages } from '../messages';

export function InfaktSetupPage(): ReactElement {
  const copy = useInfaktMessages().infaktSetupPage;
  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">{copy.chips.apiKey}</span>
          <span className="toolbar-chip">{copy.chips.guided}</span>
        </div>
      }
    >
      <InfaktSetupForm />
    </PageLayout>
  );
}
