/**
 * Shop wizard "packing and carriers" next step (#4135)
 *
 * A freshly connected shop ships every order itself. Who ships what is chosen
 * per sales-channel delivery method in Mappings, so this only says so and links
 * there; it picks nothing.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';

export function ShopPackingNextStep({ connectionId }: { readonly connectionId: string }): ReactElement {
  const copy = useMessages('connections').wizardCreated.shopPacking;
  return (
    <Alert tone="info" title={copy.title}>
      <p>{copy.body}</p>
      <p>
        <Link className="link" to={`/connections/${connectionId}/mappings`}>
          {copy.link}
        </Link>
      </p>
    </Alert>
  );
}
