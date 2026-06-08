/**
 * WooCommerce Credentials Panel
 *
 * Plugin-owned credentials affordance for WooCommerce connections — rotates
 * the stored Consumer Key + Consumer Secret pair in place via PUT /credentials.
 * Both credentials must be rotated together. Owns its own toggle state, mutation,
 * and toast feedback; the parent `EditConnectionForm` renders this only when the
 * plugin contributes it.
 *
 * @module plugins/woocommerce/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import { useUpdateConnectionCredentialsMutation } from '../../../features/connections';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';

export function WoocommerceCredentialsPanel({
  connection,
}: {
  connection: Connection;
}): ReactElement {
  const [showRotate, setShowRotate] = useState(false);
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const rotate = useUpdateConnectionCredentialsMutation();
  const { showToast } = useToast();

  if (!connection.credentialsBacked) {
    return (
      <FormField label="API Credentials" name="credentials">
        <Input value="Environment variable (not editable via UI)" disabled />
      </FormField>
    );
  }

  const canSubmit = consumerKey.trim().length > 0 && consumerSecret.trim().length > 0;

  const onRotate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await rotate.mutateAsync({
        connectionId: connection.id,
        credentials: {
          consumerKey: consumerKey.trim(),
          consumerSecret: consumerSecret.trim(),
        },
      });
      showToast({
        tone: 'success',
        title: 'Credentials rotated',
        description: 'New WooCommerce API credentials are now in use.',
      });
      setConsumerKey('');
      setConsumerSecret('');
      setShowRotate(false);
    } catch {
      // surfaced via rotate.error
    }
  };

  return (
    <FormField
      label="API Credentials"
      name="credentials"
      description="Stored securely on the server. Rotate to replace the keys without restarting the API."
    >
      {showRotate ? (
        <div className="form-grid">
          {rotate.error ? <Alert tone="error">{rotate.error.message}</Alert> : null}
          <Input
            type="password"
            autoComplete="off"
            placeholder="New consumer key (ck_...)"
            value={consumerKey}
            onChange={(event) => setConsumerKey(event.target.value)}
          />
          <Input
            type="password"
            autoComplete="off"
            placeholder="New consumer secret (cs_...)"
            value={consumerSecret}
            onChange={(event) => setConsumerSecret(event.target.value)}
          />
          <div className="form-actions">
            <Button
              type="button"
              onClick={(event) => void onRotate(event)}
              disabled={rotate.isPending || !canSubmit}
            >
              {rotate.isPending ? 'Rotating...' : 'Save new credentials'}
            </Button>
            <Button
              tone="secondary"
              type="button"
              onClick={() => {
                setShowRotate(false);
                setConsumerKey('');
                setConsumerSecret('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button tone="secondary" type="button" onClick={() => setShowRotate(true)}>
          Rotate API credentials
        </Button>
      )}
    </FormField>
  );
}
