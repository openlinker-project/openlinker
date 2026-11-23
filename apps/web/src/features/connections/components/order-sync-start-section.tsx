/**
 * Order Sync Start Section
 *
 * The start choice for a setup wizard, gated on what the adapter really offers.
 * The modes come from the adapter metadata, so until that query answers the
 * field would show a guess: a disabled "from a date" card that the shop can in
 * fact do. This renders the field only once the metadata is in. While it loads
 * it says so, and if it fails it says the connection will start with new orders
 * only (the default the form already holds), rather than offering a choice the
 * page cannot back.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { useAdaptersQuery } from '../../adapters';
import { ORDER_SYNC_START_DEFAULT_MODES, type OrderSyncStartValue } from '../lib/order-sync-start';
import { OrderSyncStartField } from './order-sync-start-field';

interface OrderSyncStartSectionProps {
  adapterKey: string;
  value: OrderSyncStartValue;
  onChange: (value: OrderSyncStartValue) => void;
  error?: string;
}

export function OrderSyncStartSection({
  adapterKey,
  value,
  onChange,
  error,
}: OrderSyncStartSectionProps): ReactElement {
  const copy = useMessages('connections').orderSyncStart;
  const adaptersQuery = useAdaptersQuery();

  if (adaptersQuery.isPending) {
    return (
      <p className="muted-text" role="status">
        {copy.loading}
      </p>
    );
  }
  if (adaptersQuery.isError) {
    return (
      <p className="muted-text" role="status">
        {copy.loadFailed}
      </p>
    );
  }

  const metadata = adaptersQuery.data.find((adapter) => adapter.adapterKey === adapterKey);
  return (
    <OrderSyncStartField
      value={value}
      onChange={onChange}
      supportedModes={metadata?.orderSyncStartModes ?? ORDER_SYNC_START_DEFAULT_MODES}
      windowImport={metadata?.orderWindowImport ?? false}
      error={error}
    />
  );
}
