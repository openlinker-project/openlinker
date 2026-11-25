/**
 * Shipping "what next" block (#4135)
 *
 * Shown right after a sales channel is connected. Until a carrier is assigned
 * per delivery method the shop ships every order, which is invisible from the
 * connection screens, so this says it once and links to the one place the
 * assignment lives. It deliberately offers no picker and suggests no carrier:
 * the assignment stays in Mappings.
 *
 * @module features/connections/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { shippingAssignmentPath } from './shipping-assignment-path';

export interface ShippingNextStepProps {
  /** The sales channel that was just connected. */
  readonly connectionId: string;
}

export function ShippingNextStep({ connectionId }: ShippingNextStepProps): ReactElement {
  const copy = useMessages('connections').shippingNextStep;
  return (
    <Alert tone="info" title={copy.title}>
      <p>{copy.body}</p>
      <p>
        <Link className="link" to={shippingAssignmentPath(connectionId)}>
          {copy.link}
        </Link>
      </p>
    </Alert>
  );
}
