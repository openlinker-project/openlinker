/**
 * PrestaShop Extra Edit-Connection Section
 *
 * Plugin slot adapter (#1810, rebased from #1815) that renders the
 * connections feature's `PrestashopRateLimitReadout` below the structured
 * config block. Kept thin: all readout rendering and query logic lives in
 * the feature (mirrors `AllegroExtraSection`'s shape for
 * `AllegroSellerDefaultsSection`).
 *
 * Always mounted for a PrestaShop connection — the readout itself renders
 * the "not rate-limited" empty state when neither an explicit
 * `config.rateLimit` nor the adapter's manifest default is in effect, so
 * this slot doesn't need to inspect config shape to decide whether to render.
 *
 * @module plugins/prestashop/components
 */
import type { ReactElement } from 'react';

import { PrestashopRateLimitReadout } from '../../../features/connections';
import type { ExtraConfigSectionProps } from '../../../shared/plugins';

export function PrestashopExtraSection({ connection }: ExtraConfigSectionProps): ReactElement {
  return <PrestashopRateLimitReadout connectionId={connection.id} />;
}
