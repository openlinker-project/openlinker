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
 * #1384 — also carries the "Browse Allegro categories when creating Erli
 * offers" checkbox. Checking it reveals the Allegro app's Client ID / Client
 * Secret fields (masked, show/hide toggle); saving writes them into the same
 * `useUpdateConnectionCredentialsMutation` call as `apiKey` (merged, only the
 * fields the operator actually filled), then, in a second sequenced request,
 * patches `connection.config.allegroCategoryAccessEnabled` to match the
 * checkbox.
 *
 * Atomicity note (see ADR-031 "Correction" + the PR description): the
 * backend's generic `PUT .../credentials` and `PATCH /connections/:id`
 * (config) routes are independent, single-purpose endpoints with no
 * cross-write coupling for any platform — there is no single backend request
 * that can set both the credential pair and the config flag together. This
 * panel therefore sequences two mutations from one Save click, in the order
 * that fails safe: credentials first, then the config flag. If the
 * credentials write fails, nothing else runs — the flag is untouched, so a
 * connection never ends up advertising category access it can't actually
 * serve. If the second (config) write fails after the first succeeded, the
 * flag simply stays at its prior value — the wizard keeps showing today's
 * safe plain-text fallback until the operator retries (the fields stay
 * filled and the retry re-sends both mutations, which is idempotent on the
 * credentials side).
 *
 * @module plugins/erli/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import {
  useUpdateConnectionCredentialsMutation,
  useUpdateConnectionMutation,
} from '../../../features/connections';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';

function isAllegroCategoryAccessEnabled(connection: Connection): boolean {
  return connection.config.allegroCategoryAccessEnabled === true;
}

export function ErliCredentialsPanel({ connection }: { connection: Connection }): ReactElement {
  const [showRotate, setShowRotate] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [allegroEnabled, setAllegroEnabled] = useState(() =>
    isAllegroCategoryAccessEnabled(connection),
  );
  const [allegroClientId, setAllegroClientId] = useState('');
  const [allegroClientSecret, setAllegroClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const rotate = useUpdateConnectionCredentialsMutation();
  const updateConfig = useUpdateConnectionMutation();
  const { showToast } = useToast();

  if (!connection.credentialsBacked) {
    return (
      <FormField label="API Key" name="credentials">
        <Input value="Environment variable (not editable via UI)" disabled />
      </FormField>
    );
  }

  const initialAllegroEnabled = isAllegroCategoryAccessEnabled(connection);
  const idFilled = allegroClientId.trim().length > 0;
  const secretFilled = allegroClientSecret.trim().length > 0;
  const canSubmit =
    apiKey.trim().length > 0 ||
    (allegroEnabled && (idFilled || secretFilled)) ||
    allegroEnabled !== initialAllegroEnabled;

  function openPanel(): void {
    // Seed the checkbox from the connection's current server-confirmed state
    // every time the panel opens — it may have changed since the last open
    // (e.g. another operator, or a prior save in this session).
    setAllegroEnabled(initialAllegroEnabled);
    setShowRotate(true);
  }

  function closePanel(): void {
    setShowRotate(false);
    setApiKey('');
    setAllegroClientId('');
    setAllegroClientSecret('');
    setShowSecret(false);
    setValidationError(null);
  }

  const onSave = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setValidationError(null);
    if (!canSubmit) return;

    if (allegroEnabled) {
      if (idFilled !== secretFilled) {
        setValidationError(
          'Enter both the Allegro Client ID and Client Secret, or leave both blank.',
        );
        return;
      }
      if (!idFilled && !secretFilled && !initialAllegroEnabled) {
        setValidationError(
          'Enter the Allegro Client ID and Client Secret to enable category browsing.',
        );
        return;
      }
    }

    const credentials: Record<string, unknown> = {};
    if (apiKey.trim()) credentials.apiKey = apiKey.trim();
    // Both-or-neither is already enforced above; omit both fields entirely
    // (not empty strings) when the checkbox is unchecked, so the backend's
    // shape validator's "both or neither" rule is satisfied by omission.
    if (allegroEnabled && idFilled && secretFilled) {
      credentials.allegroClientId = allegroClientId.trim();
      credentials.allegroClientSecret = allegroClientSecret.trim();
    }

    try {
      if (Object.keys(credentials).length > 0) {
        await rotate.mutateAsync({ connectionId: connection.id, credentials });
      }
      // Second, sequenced request: keep `allegroCategoryAccessEnabled` in
      // sync with the checkbox whenever either changed or new Allegro
      // credentials were just written. Only reached once the credentials
      // write above has succeeded (or wasn't needed) — see the module
      // header for why this ordering fails safe.
      if (allegroEnabled !== initialAllegroEnabled || 'allegroClientId' in credentials) {
        await updateConfig.mutateAsync({
          connectionId: connection.id,
          input: {
            config: { ...connection.config, allegroCategoryAccessEnabled: allegroEnabled },
          },
        });
      }
      showToast({
        tone: 'success',
        title: 'Credentials saved',
        description: 'Erli connection credentials are now in use.',
      });
      closePanel();
    } catch {
      // Surfaced via rotate.error / updateConfig.error below. Fields are
      // deliberately NOT cleared on failure so a retry can resend them.
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
          {updateConfig.error ? (
            <Alert tone="error">
              Category-browsing setting failed to save: {updateConfig.error.message}. Click Save
              again to retry.
            </Alert>
          ) : null}
          {validationError ? <Alert tone="error">{validationError}</Alert> : null}
          <Input
            type="password"
            autoComplete="off"
            placeholder="New API key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
            <input
              type="checkbox"
              checked={allegroEnabled}
              onChange={(event) => setAllegroEnabled(event.target.checked)}
            />
            <span>
              <strong>Browse Allegro categories when creating Erli offers</strong>
              <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                Used only to read the public category catalog — never to sign in as a seller or
                place offers.
              </small>
            </span>
          </label>

          {allegroEnabled ? (
            <div className="form-grid">
              <Input
                autoComplete="off"
                placeholder="Allegro Client ID"
                value={allegroClientId}
                onChange={(event) => setAllegroClientId(event.target.value)}
              />
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <Input
                  type={showSecret ? 'text' : 'password'}
                  autoComplete="off"
                  placeholder="Allegro Client Secret"
                  value={allegroClientSecret}
                  onChange={(event) => setAllegroClientSecret(event.target.value)}
                />
                <Button
                  tone="ghost"
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  aria-label={showSecret ? 'Hide Client Secret' : 'Show Client Secret'}
                >
                  {showSecret ? 'Hide' : 'Show'}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="form-actions">
            <Button
              type="button"
              onClick={(event) => void onSave(event)}
              disabled={rotate.isPending || updateConfig.isPending || !canSubmit}
            >
              {rotate.isPending || updateConfig.isPending ? 'Saving...' : 'Save credentials'}
            </Button>
            <Button tone="secondary" type="button" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button tone="secondary" type="button" onClick={openPanel}>
          Rotate API key
        </Button>
      )}
    </FormField>
  );
}
