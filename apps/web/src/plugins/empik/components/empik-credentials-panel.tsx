/**
 * Empik Credentials Panel
 *
 * Rotates the stored Empik shop API key in place via PUT /credentials. Empik
 * allows one key per shop and generating a new one in the seller panel
 * invalidates the old one, so this is how an operator recovers a connection
 * that went `needs_reauth`. An env-backed credential shows a read-only field
 * instead. Same shape as `InfaktCredentialsPanel`.
 *
 * @module plugins/empik/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import { useUpdateConnectionCredentialsMutation } from '../../../features/connections';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';
import { useEmpikMessages } from '../messages';

export function EmpikCredentialsPanel({ connection }: { connection: Connection }): ReactElement {
  const copy = useEmpikMessages().empikCredentialsPanel;
  const [showRotate, setShowRotate] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const rotate = useUpdateConnectionCredentialsMutation();
  const { showToast } = useToast();

  if (!connection.credentialsBacked) {
    return (
      <FormField label={copy.label} name="credentials">
        <Input value={copy.envBacked} disabled />
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
      showToast({ tone: 'success', title: copy.toast.title, description: copy.toast.description });
      setApiKey('');
      setShowRotate(false);
    } catch {
      // surfaced via rotate.error
    }
  };

  return (
    <FormField label={copy.label} name="credentials" description={copy.description}>
      {showRotate ? (
        <div className="form-grid">
          {rotate.error ? <Alert tone="error">{describeApiError(rotate.error, 'empik')}</Alert> : null}
          <Input
            type="password"
            autoComplete="off"
            aria-label={copy.newKeyPlaceholder}
            placeholder={copy.newKeyPlaceholder}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <div className="form-actions">
            <Button
              type="button"
              onClick={(event) => void onRotate(event)}
              disabled={rotate.isPending || !canSubmit}
            >
              {rotate.isPending ? copy.rotating : copy.save}
            </Button>
            <Button
              tone="secondary"
              type="button"
              onClick={() => {
                setShowRotate(false);
                setApiKey('');
              }}
            >
              {copy.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <Button tone="secondary" type="button" onClick={() => setShowRotate(true)}>
          {copy.rotate}
        </Button>
      )}
    </FormField>
  );
}
