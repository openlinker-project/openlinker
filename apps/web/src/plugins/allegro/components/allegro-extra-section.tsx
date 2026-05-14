/**
 * Allegro Extra Edit-Connection Section
 *
 * Plugin slot adapter that wraps the existing `AllegroSellerDefaultsSection`
 * with the registry-shaped prop signature. Kept thin: all GPSR / location
 * / responsible-producer rendering still lives in the feature module —
 * this is only the plugin-contract surface.
 *
 * @module plugins/allegro/components
 */
import type { ReactElement } from 'react';
import { AllegroSellerDefaultsSection } from '../../../features/connections';
import type { ExtraConfigSectionProps } from '../../../shared/plugins';

export function AllegroExtraSection({
  connection,
  form,
  configIsParseable,
  syncSellerDefaultsToJson,
}: ExtraConfigSectionProps): ReactElement {
  return (
    <AllegroSellerDefaultsSection
      connectionId={connection.id}
      form={form}
      onChange={syncSellerDefaultsToJson}
      disabled={!configIsParseable}
    />
  );
}
