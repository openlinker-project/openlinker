/**
 * OpenLinker OMS — frontend plugin contribution
 *
 * Registers `platformType: 'openlinker'` so an OMS connection renders with its
 * own name on the connections list and detail page (#2405, ADR-055).
 *
 * It is offered by "Add new connection" as a FEATURED card that opens the
 * packing setup, and is hidden from the by-hand advanced form
 * (`hideFromCreateConnection`, #3457): the `openlinker`
 * connection is one of four writes the packing setup at `/settings/packing`
 * makes (the warehouse, every product master's stock location and the switch
 * itself are the other three), and a connection created by hand with none of
 * them packs nothing. That setup is where it is created, and it is reached
 * from Settings and from the pack bench's "no work can reach this bench" state.
 *
 * No `StructuredConfigSection`, no `CredentialsPanel`. The OMS holds no
 * credentials, so the host's default "managed by integration" affordance is
 * the correct rendering rather than something to override.
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
    hideFromCreateConnection: true,
    setupCard: {
      title: 'OpenLinker OMS',
      description:
        'Pack and ship orders in OpenLinker instead of your shop. There is no account to connect: the setup creates it for you.',
      to: '/settings/packing',
      badge: 'OMS',
      featured: true,
    },
  },
});
