/**
 * What's new page (#4147, ADR-085)
 *
 * Setup steps of the installed release and the full English changelog. Open to
 * every role that may read release state; a role without access, or an
 * installation with the feature off, is shown nothing of the setup block's
 * actions because the hooks resolve to empty.
 *
 * @module apps/web/src/pages/release-center
 */
import type { ReactElement } from 'react';
import { WhatsNewContent } from '../../features/release-center';
import { useMessages } from '../../shared/i18n';
import { PageLayout } from '../../shared/ui/page-layout';

export function WhatsNewPage(): ReactElement {
  const copy = useMessages('release-center').whatsNew;
  return (
    <PageLayout eyebrow={copy.eyebrow} title={copy.title}>
      <WhatsNewContent />
    </PageLayout>
  );
}
