/**
 * Channel Content Panel
 *
 * `ContentPanel` for one channel connection, owning the per-connection
 * `DescriptionFormat` read (ADR-046).
 *
 * It exists purely so the hook has somewhere legal to live: `ContentEditor`
 * renders one panel per channel inside a `.map()`, and a hook cannot be called
 * in a loop. One component instance per channel gives one query per channel, and
 * Radix unmounts inactive tab content, so only the visible channel fetches.
 *
 * @module apps/web/src/features/content/components
 */
import type { ReactElement } from 'react';

import { CONSERVATIVE_FALLBACK_WHILE_LOADING } from './channel-content-panel.constants';
import { ContentPanel, type ContentPanelProps } from './content-panel';
import { useDescriptionFormatQuery } from '../../listings';

type ChannelContentPanelProps = Omit<ContentPanelProps, 'format'> & {
  connectionId: string;
};

export function ChannelContentPanel({
  connectionId,
  ...panelProps
}: ChannelContentPanelProps): ReactElement {
  const formatQuery = useDescriptionFormatQuery(connectionId);

  // While the contract is in flight the editor renders against the narrow
  // fallback rather than a permissive guess. Erring narrow is the safe
  // direction: a control that appears late is a smaller surprise than one that
  // lets an operator author a tag the destination then discards. The endpoint
  // never errors, so there is no failure branch to handle - see
  // DescriptionFormatReadService.
  const format = formatQuery.data ?? CONSERVATIVE_FALLBACK_WHILE_LOADING;

  return <ContentPanel {...panelProps} format={format} />;
}
