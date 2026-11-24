/**
 * Capability Name
 *
 * What a capability checkbox is called: a plain operator label first and the
 * code name as small secondary text. The code name stays because support
 * requests, the API and the docs all use it, but an operator choosing what a
 * connection does should not have to decode `OrderProcessorManager` first.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import type { CoreCapability } from '../api/connections.types';

interface CapabilityNameProps {
  capability: CoreCapability;
}

export function CapabilityName({ capability }: CapabilityNameProps): ReactElement {
  const labels = useMessages('connections').capabilityLabel;
  return (
    <>
      <span className="capability-list__name">{labels[capability]}</span>
      <span className="capability-list__code mono-text">{capability}</span>
    </>
  );
}
