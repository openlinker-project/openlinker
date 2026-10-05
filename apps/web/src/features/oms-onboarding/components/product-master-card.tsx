/**
 * Product master card (#3457)
 *
 * One connection the wizard will read products and stock from. The platform
 * name comes from the plugin registry, so a new platform renders its own name
 * without this card knowing it exists.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';

import { usePlatform } from '../../../shared/plugins';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { Connection } from '../../connections';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';

export function ProductMasterCard({ connection }: { readonly connection: Connection }): ReactElement {
  const platform = usePlatform(connection.platformType);

  return (
    <div className="oms-onboarding__card" data-testid="product-master-card">
      <div className="oms-onboarding__card-main">
        <span className="oms-onboarding__card-name">{connection.name}</span>
        {platform !== undefined ? (
          <span className="oms-onboarding__card-sub">{platform.displayName}</span>
        ) : null}
        <span className="oms-onboarding__badges">
          <StatusBadge tone="success" compact>
            ✓ {COPY.step1.capabilityProducts}
          </StatusBadge>
          <StatusBadge tone="success" compact>
            ✓ {COPY.step1.capabilityStock}
          </StatusBadge>
        </span>
      </div>
      <StatusBadge tone="info">{COPY.step1.masterBadge}</StatusBadge>
    </div>
  );
}
