/**
 * KSeF Connection Actions
 *
 * Plugin-owned action rows rendered inside `ConnectionActionsPanel` for KSeF
 * connections, via the `ConnectionActions` platform slot. Today it hosts the
 * single "Invoice numbering" row (#1577); it is the extension point for any
 * future KSeF-specific connection action. Rendered only for KSeF connections
 * (the slot is resolved through `usePlatform('ksef')`), so it needs no
 * platformType check of its own.
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import { KsefNumberingActions } from './ksef-numbering-actions';

interface KsefConnectionActionsProps {
  connection: Connection;
}

export function KsefConnectionActions({
  connection,
}: KsefConnectionActionsProps): ReactElement {
  return <KsefNumberingActions connection={connection} />;
}
