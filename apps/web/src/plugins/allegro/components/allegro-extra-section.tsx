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
import { renderRich } from '../../../shared/i18n';
import type { ExtraConfigSectionProps } from '../../../shared/plugins';
import { useAllegroMessages } from '../messages';

const SHIPPING_CAPABILITY = 'ShippingProviderManager';

const rich = {
  strong: (text: string): ReactElement => <strong>{text}</strong>,
  em: (text: string): ReactElement => <em>{text}</em>,
  code: (text: string): ReactElement => <code className="mono-text">{text}</code>,
};

export function AllegroExtraSection({
  connection,
  form,
  configIsParseable,
  syncSellerDefaultsToJson,
}: ExtraConfigSectionProps): ReactElement {
  const copy = useAllegroMessages().allegroExtraSection.delivery;
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
            {copy.title}
          </h3>
          {/* Collapsible details — keeps the toolbar visually tight on the
              connection page, expands when the operator wants context.
              Native <details> per shared-UI policy (use native HTML when it
              covers the use case). */}
          <details>
            <summary>
              {renderRich(copy.summary, rich)}
            </summary>
            <p>{copy.intro}</p>
            <ul>
              <li>{renderRich(copy.labelCreation, rich)}</li>
              <li>{renderRich(copy.trackingNumber, rich)}</li>
              <li>{renderRich(copy.pickupPoints, rich)}</li>
            </ul>
            <p>
              {renderRich(copy.diagnostics, rich, {
                cursorKey: 'allegro.shipmentStatus.scanOffset',
                jobType: 'marketplace.shipment.statusSync',
              })}
            </p>
          </details>
        </section>
      ) : null}
    </>
  );
}
