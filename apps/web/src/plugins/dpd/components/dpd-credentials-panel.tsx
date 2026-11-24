/**
 * DPD Polska Credentials Panel
 *
 * Plugin-owned credentials affordance for DPD connections — rotates the stored
 * DPDServices Basic-auth pair (`login` + `password`) in place via
 * PUT /credentials. Owns its toggle state, mutation, and toast; the parent
 * `EditConnectionForm` renders this only when the plugin contributes it.
 *
 * Lives in the plugin (not core) because the rotation form is shaped to DPD's
 * two-field credential model — surfacing it generically would mislabel the
 * inputs for any other platform that opted in. Mirrors the PrestaShop panel.
 *
 * @module plugins/dpd/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import { useUpdateConnectionCredentialsMutation } from '../../../features/connections';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';
import { useDpdMessages } from '../messages';
import { describeApiError } from '../../../shared/api/describe-api-error';

export function DpdCredentialsPanel({ connection }: { connection: Connection }): ReactElement {
  const copy = useDpdMessages().dpdCredentialsPanel;
  const [showRotate, setShowRotate] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const rotate = useUpdateConnectionCredentialsMutation();
  const { showToast } = useToast();

  if (!connection.credentialsBacked) {
    return (
      <FormField label={copy.envBackedLabel} name="credentials">
        <Input value={copy.envBacked} disabled />
      </FormField>
    );
  }

  const canSubmit = login.trim().length > 0 && password.length > 0;

  const onRotate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await rotate.mutateAsync({
        connectionId: connection.id,
        credentials: { login: login.trim(), password },
      });
      showToast({
        tone: 'success',
        title: copy.toast.title,
        description: copy.toast.description,
      });
      setLogin('');
      setPassword('');
      setShowRotate(false);
    } catch {
      // surfaced via rotate.error
    }
  };

  return (
    <FormField
      label={copy.label}
      name="credentials"
      description={copy.description}
    >
      {showRotate ? (
        <div className="form-grid">
          {rotate.error ? <Alert tone="error">{describeApiError(rotate.error, 'dpd')}</Alert> : null}
          <Input
            autoComplete="off"
            className="mono-text"
            placeholder={copy.newLoginPlaceholder}
            value={login}
            onChange={(event) => setLogin(event.target.value)}
          />
          <Input
            type="password"
            autoComplete="off"
            placeholder={copy.newPasswordPlaceholder}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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
                setLogin('');
                setPassword('');
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
