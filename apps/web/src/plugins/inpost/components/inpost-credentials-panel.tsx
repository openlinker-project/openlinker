/**
 * InPost Credentials Panel (#771)
 *
 * Plugin-owned credentials affordance for InPost connections — enters/rotates
 * the stored ShipX Bearer API token in place via PUT /credentials. Owns its
 * toggle state, mutation, and toast; the parent `EditConnectionForm` renders
 * this only when the plugin contributes it.
 *
 * Lives in the plugin (not core) because the rotation form is shaped to InPost's
 * single-token credential model (`apiToken`) — surfacing it generically would
 * mislabel the input for any other platform that opted in. Mirrors the
 * PrestaShop / DPD panels.
 *
 * @module plugins/inpost/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import { useUpdateConnectionCredentialsMutation } from '../../../features/connections';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';

export function InpostCredentialsPanel({ connection }: { connection: Connection }): ReactElement {
  const [showRotate, setShowRotate] = useState(false);
  const [apiToken, setApiToken] = useState('');
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
    if (apiToken.trim().length === 0) return;
    try {
      await rotate.mutateAsync({
        connectionId: connection.id,
        credentials: { apiToken: apiToken.trim() },
      });
      showToast({
        tone: 'success',
        title: 'Credentials rotated',
        description: 'The new ShipX API token is now in use.',
      });
      setApiToken('');
      setShowRotate(false);
    } catch {
      // surfaced via rotate.error
    }
  };

  return (
    <FormField
      label="ShipX API token"
      name="credentials"
      description="ShipX Bearer token, stored securely on the server. Rotate to replace it without restarting the API."
    >
      {showRotate ? (
        <div className="form-grid">
          {rotate.error ? <Alert tone="error">{rotate.error.message}</Alert> : null}
          <Input
            type="password"
            autoComplete="off"
            className="mono-text"
            placeholder="New ShipX API token"
            value={apiToken}
            onChange={(event) => setApiToken(event.target.value)}
          />
          <div className="form-actions">
            <Button
              type="button"
              onClick={(event) => void onRotate(event)}
              disabled={rotate.isPending || apiToken.trim().length === 0}
            >
              {rotate.isPending ? 'Rotating...' : 'Save new token'}
            </Button>
            <Button
              tone="secondary"
              type="button"
              onClick={() => {
                setShowRotate(false);
                setApiToken('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button tone="secondary" type="button" onClick={() => setShowRotate(true)}>
          Rotate API token
        </Button>
      )}
    </FormField>
  );
}
