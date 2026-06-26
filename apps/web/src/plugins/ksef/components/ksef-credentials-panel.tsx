/**
 * KSeF Credentials Panel
 *
 * Plugin-owned credentials affordance for KSeF connections — rotates the
 * stored authentication secret in place via PUT /credentials. The operator
 * picks the auth type and pastes a fresh secret; the value is write-only
 * (never echoed back by the API). Owns its own toggle state, mutation, and
 * toast feedback; the parent `EditConnectionForm` renders this only when the
 * plugin contributes it.
 *
 * Mirrors the WooCommerce/DPD rotate pattern. The submitted payload matches
 * the C2 `KsefCredentials` shape — `{ authType, secret }`.
 *
 * @module plugins/ksef/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import {
  useUpdateConnectionCredentialsMutation,
  KSEF_AUTH_TYPE_VALUES,
} from '../../../features/connections';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';

const AUTH_TYPE_LABELS: Record<(typeof KSEF_AUTH_TYPE_VALUES)[number], string> = {
  'ksef-token': 'KSeF authorization token',
  'qualified-seal': 'Qualified electronic seal',
};

export function KsefCredentialsPanel({ connection }: { connection: Connection }): ReactElement {
  const [showRotate, setShowRotate] = useState(false);
  const [authType, setAuthType] = useState<(typeof KSEF_AUTH_TYPE_VALUES)[number]>('ksef-token');
  const [secret, setSecret] = useState('');
  const rotate = useUpdateConnectionCredentialsMutation();
  const { showToast } = useToast();

  if (!connection.credentialsBacked) {
    return (
      <FormField label="Authentication secret" name="credentials">
        <Input value="Environment variable (not editable via UI)" disabled />
      </FormField>
    );
  }

  const canSubmit = secret.trim().length > 0;

  const onRotate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await rotate.mutateAsync({
        connectionId: connection.id,
        credentials: { authType, secret: secret.trim() },
      });
      showToast({
        tone: 'success',
        title: 'Credentials rotated',
        description: 'The new KSeF authentication secret is now in use.',
      });
      setSecret('');
      setShowRotate(false);
    } catch {
      // surfaced via rotate.error
    }
  };

  return (
    <FormField
      label="Authentication secret"
      name="credentials"
      description="Stored securely on the server. Rotate to replace the KSeF token / seal reference without restarting the API."
    >
      {showRotate ? (
        <div className="form-grid">
          {rotate.error ? <Alert tone="error">{rotate.error.message}</Alert> : null}
          <Select
            value={authType}
            onChange={(event) =>
              setAuthType(event.target.value as (typeof KSEF_AUTH_TYPE_VALUES)[number])
            }
          >
            {KSEF_AUTH_TYPE_VALUES.map((value) => (
              <option key={value} value={value}>
                {AUTH_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
          <Input
            type="password"
            autoComplete="off"
            placeholder="New authentication secret"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
          <div className="form-actions">
            <Button
              type="button"
              onClick={(event) => void onRotate(event)}
              disabled={rotate.isPending || !canSubmit}
            >
              {rotate.isPending ? 'Rotating...' : 'Save new secret'}
            </Button>
            <Button
              tone="secondary"
              type="button"
              onClick={() => {
                setShowRotate(false);
                setSecret('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button tone="secondary" type="button" onClick={() => setShowRotate(true)}>
          Rotate authentication secret
        </Button>
      )}
    </FormField>
  );
}
