/**
 * Allegro Extra Edit-Connection Section
 *
 * Plugin slot adapter that wraps the existing `AllegroSellerDefaultsSection`
 * with the registry-shaped prop signature, and (since #839) renders a
 * read-only Allegro Delivery info subsection below it when the connection
 * declares the `ShippingProviderManager` capability.
 *
 * Kept thin: all GPSR / location / responsible-producer rendering still
 * lives in the feature module — this is only the plugin-contract surface
 * plus the static info banner per AC-8 (no Allegro Delivery terminology
 * when no connection declares the capability).
 *
 * @module plugins/allegro/components
 */
import type { ReactElement } from 'react';

import { AllegroSellerDefaultsSection } from '../../../features/connections';
import type { ExtraConfigSectionProps } from '../../../shared/plugins';

const SHIPPING_CAPABILITY = 'ShippingProviderManager';

export function AllegroExtraSection({
  connection,
  form,
  configIsParseable,
  syncSellerDefaultsToJson,
}: ExtraConfigSectionProps): ReactElement {
  // AC-8 capability gate (#839) — only render the Allegro Delivery
  // subsection when this connection declares ShippingProviderManager.
  // Operators with Allegro-only-as-source connections (no shipping
  // capability) never see Allegro Delivery terminology on this screen.
  const showAllegroDelivery = connection.supportedCapabilities.includes(SHIPPING_CAPABILITY);

  return (
    <>
      <AllegroSellerDefaultsSection
        connectionId={connection.id}
        form={form}
        onChange={syncSellerDefaultsToJson}
        disabled={!configIsParseable}
      />

      {showAllegroDelivery ? (
        <section aria-labelledby="allegro-delivery-info-heading">
          <h3 id="allegro-delivery-info-heading" className="detail-section__title">
            Allegro Delivery
          </h3>
          {/* Collapsible details — keeps the toolbar visually tight on the
              connection page, expands when the operator wants context.
              Native <details> per shared-UI policy (use native HTML when it
              covers the use case). */}
          <details>
            <summary>
              <strong>No configuration needed</strong> — how shipment tracking works
            </summary>
            <p>
              Allegro Delivery (&ldquo;Wysyłam z Allegro&rdquo;) labels are issued via
              Allegro&apos;s shipment-management API and tracked automatically:
            </p>
            <ul>
              <li>
                <strong>Label creation</strong> is synchronous from OL&apos;s side — operators
                generate a label from the order detail panel; OL waits for Allegro&apos;s
                command to complete before responding.
              </li>
              <li>
                <strong>Tracking number</strong> resolves <em>asynchronously</em>. Allegro
                generates the waybill on a delay; OL polls every 15 minutes and backfills the
                row when it arrives (no manual refresh needed).
              </li>
              <li>
                <strong>Buyer-selected pickup points</strong> (Allegro One Box, Paczkomat,
                kurier) are pre-filled on the label form from the order snapshot.
              </li>
            </ul>
            <p>
              Cursor key: <code className="mono-text">allegro.shipmentStatus.scanOffset</code>{' '}
              · Job type: <code className="mono-text">marketplace.shipment.statusSync</code>
            </p>
          </details>
        </section>
      ) : null}
    </>
  );
}
