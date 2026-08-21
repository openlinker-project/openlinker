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

  // `null` while the contract is in flight: the editor renders a disabled
  // placeholder rather than authoring against a guess. The frontend holds no
  // default of its own - a local "conservative" literal here was Allegro's
  // grammar transcribed into `apps/web`, and it told the operator their
  // destination had declared no format for the length of every fetch.
  return <ContentPanel {...panelProps} format={formatQuery.data ?? null} />;
}
