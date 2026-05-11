/**
 * PrestaShop Credentials Panel
 *
 * Plugin-owned credentials affordance for PrestaShop connections — rotates
 * the stored Webservice API key in place via PUT /credentials. Owns its
 * own toggle state, mutation, and toast feedback; the parent
 * `EditConnectionForm` renders this only when the plugin contributes it.
 *
 * Lives in the plugin (not in core) because the rotation form is shaped to
 * the PS credential model (`webserviceApiKey`) — surfacing it generically
 * would mislabel the input for any other platform that opted in.
 *
 * @module plugins/prestashop/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { Connection } from '../../../features/connections/api/connections.types';
import { useUpdateConnectionCredentialsMutation } from '../../../features/connections/hooks/use-update-connection-credentials-mutation';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';

export function PrestashopCredentialsPanel({
  connection,
}: {
  connection: Connection;
}): ReactElement {
  const [showRotate, setShowRotate] = useState(false);
  const [newKey, setNewKey] = useState('');
  const rotate = useUpdateConnectionCredentialsMutation();
  const { showToast } = useToast();

  if (!connection.credentialsBacked) {
    return (
      <FormField label="Credentials" name="credentials">
        <Input value="Environment variable (not editable via UI)" disabled />
      </FormField>
    );
  }

  const onRotate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (newKey.trim().length === 0) return;
    try {
      await rotate.mutateAsync({
        connectionId: connection.id,
        credentials: { webserviceApiKey: newKey.trim() },
      });
      showToast({
        tone: 'success',
        title: 'Credentials rotated',
        description: 'The new webservice key is now in use.',
      });
      setNewKey('');
      setShowRotate(false);
    } catch {
      // surfaced via rotate.error
    }
  };

  return (
    <FormField
      label="Webservice key"
      name="credentials"
      description="Stored securely on the server. Rotate to replace the key without restarting the API."
    >
      {showRotate ? (
        <div className="form-grid">
          {rotate.error ? <Alert tone="error">{rotate.error.message}</Alert> : null}
          <Input
            type="password"
            autoComplete="off"
            placeholder="New webservice key"
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
          />
          <div className="form-actions">
            <Button
              type="button"
              onClick={(event) => void onRotate(event)}
              disabled={rotate.isPending || newKey.trim().length === 0}
            >
              {rotate.isPending ? 'Rotating...' : 'Save new key'}
            </Button>
            <Button
              tone="secondary"
              type="button"
              onClick={() => {
                setShowRotate(false);
                setNewKey('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button tone="secondary" type="button" onClick={() => setShowRotate(true)}>
          Rotate webservice key
        </Button>
      )}
    </FormField>
  );
}
