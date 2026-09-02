/**
 * OpenLinker OMS — frontend plugin contribution
 *
 * Registers `platformType: 'openlinker'` so the OL-OMS appears in the
 * create-connection platform picker (#2405, ADR-055). Without this entry the
 * platform is absent from the dropdown and the credential-less create path is
 * unreachable from the UI — a row only `curl` could produce.
 *
 * Deliberately minimal: no `setupCard` (there is no guided flow to run yet —
 * that is #2407), no `StructuredConfigSection`, no `CredentialsPanel`. The OMS
 * holds no credentials, so the host's default "managed by integration"
 * affordance is the correct rendering rather than something to override.
 *
 * @module apps/web/src/plugins/oms
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';

export const omsPlugin: OpenLinkerPlugin = definePlugin({
  id: 'openlinker',
  platformType: 'openlinker',
  platform: {
    displayName: 'OpenLinker OMS',
  },
});
