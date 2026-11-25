/**
 * Carrier wizard next step (#4135)
 *
 * A new carrier account ships nothing until a sales channel's delivery method
 * is assigned to it. That assignment is made on the carrier's connection page
 * ("Ships for"), so this links there and picks nothing itself.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';

export function CarrierNextStep({ connectionId }: { readonly connectionId: string }): ReactElement {
  const copy = useMessages('connections').wizardCreated.assignChannel;
  return (
    <Alert tone="info" title={copy.title}>
      <p>{copy.body}</p>
      <p>
        <Link className="link" to={`/connections/${connectionId}`}>
          {copy.link}
        </Link>
      </p>
    </Alert>
  );
}
