/**
 * Erli Credentials Panel
 *
 * Plugin-owned credentials affordance for Erli connections — rotates the
 * stored Shop API key in place via PUT /credentials. Owns its own toggle
 * state, mutation, and toast feedback; the parent `EditConnectionForm`
 * renders this only when the plugin contributes it. When the credential is
 * env-backed (`credentialsBacked === false`) the panel shows a read-only
 * affordance instead.
 *
 * @module plugins/erli/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import { useUpdateConnectionCredentialsMutation } from '../../../features/connections';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';

export function ErliCredentialsPanel({ connection }: { connection: Connection }): ReactElement {
  const [showRotate, setShowRotate] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const rotate = useUpdateConnectionCredentialsMutation();
  const { showToast } = useToast();

  if (!connection.credentialsBacked) {
    return (
      <FormField label="API Key" name="credentials">
        <Input value="Environment variable (not editable via UI)" disabled />
      </FormField>
    );
  }

  const canSubmit = apiKey.trim().length > 0;

  const onRotate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await rotate.mutateAsync({
        connectionId: connection.id,
        credentials: { apiKey: apiKey.trim() },
      });
      showToast({
        tone: 'success',
        title: 'Credentials rotated',
        description: 'The new Erli API key is now in use.',
      });
      setApiKey('');
      setShowRotate(false);
    } catch {
      // surfaced via rotate.error
    }
  };

  return (
    <FormField
      label="API Key"
      name="credentials"
      description="Stored securely on the server. Rotate to replace the key without restarting the API."
    >
      {showRotate ? (
        <div className="form-grid">
          {rotate.error ? <Alert tone="error">{rotate.error.message}</Alert> : null}
          <Input
            type="password"
            autoComplete="off"
            placeholder="New API key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <div className="form-actions">
            <Button
              type="button"
              onClick={(event) => void onRotate(event)}
              disabled={rotate.isPending || !canSubmit}
            >
              {rotate.isPending ? 'Rotating...' : 'Save new API key'}
            </Button>
            <Button
              tone="secondary"
              type="button"
              onClick={() => {
                setShowRotate(false);
                setApiKey('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button tone="secondary" type="button" onClick={() => setShowRotate(true)}>
          Rotate API key
        </Button>
      )}
    </FormField>
  );
}
