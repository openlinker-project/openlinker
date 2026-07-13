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
 * offers" checkbox. Checking it reveals the Allegro app credential source
 * choice (#1387 below); saving writes the resolved credentials into the same
 * `useUpdateConnectionCredentialsMutation` call as `apiKey` (merged, only the
 * fields the operator actually filled), then, in a second sequenced request,
 * patches `connection.config.allegroCategoryAccessEnabled` to match the
 * checkbox.
 *
 * #1387 — when the operator has at least one Allegro connection, the panel
 * defaults to a "Reuse credentials from an existing Allegro connection"
 * radio (with a `<select>` of that connection's name) alongside "Enter
 * Allegro app credentials manually". Reuse sends `{ reuseAllegroConnectionId
 * }` instead of `{ allegroClientId, allegroClientSecret }` — the backend
 * (`ConnectionService.updateCredentials`, ADR-031) resolves the source
 * connection's `clientId`/`clientSecret` server-side and writes them into
 * this connection's own credentials; the raw secret is never sent to, or
 * returned by, the browser. With zero Allegro connections the radio is
 * skipped entirely and only the manual fields render (today's #1384
 * behavior), with a short notice per the approved mockup.
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
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import {
  useConnectionsQuery,
  useUpdateConnectionCredentialsMutation,
  useUpdateConnectionMutation,
} from '../../../features/connections';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';

type AllegroCredentialSource = 'reuse' | 'manual';
type AllegroCatalogEnvironment = 'sandbox' | 'production';

function isAllegroCategoryAccessEnabled(connection: Connection): boolean {
  return connection.config.allegroCategoryAccessEnabled === true;
}

/**
 * `config.environment` on an Allegro connection (sandbox/production) — read
 * here so the "reuse" path can infer the category-catalog client's target
 * environment from the *same* connection it's borrowing app credentials
 * from. Without this, `ErliAdapterFactory` defaults to `'production'`
 * (erli-adapter.factory.ts) regardless of the source connection's actual
 * environment, so reusing a sandbox Allegro app's credentials always fails
 * category-catalog auth with a 401 `invalid_client` — the sandbox app was
 * never registered against Allegro's production token endpoint.
 */
function readAllegroEnvironment(connection: Connection): AllegroCatalogEnvironment {
  return connection.config.environment === 'sandbox' ? 'sandbox' : 'production';
}

export function ErliCredentialsPanel({ connection }: { connection: Connection }): ReactElement {
  const [showRotate, setShowRotate] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [allegroEnabled, setAllegroEnabled] = useState(() =>
    isAllegroCategoryAccessEnabled(connection)
  );
  const [allegroClientId, setAllegroClientId] = useState('');
  const [allegroClientSecret, setAllegroClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [credSource, setCredSource] = useState<AllegroCredentialSource>('reuse');
  const [selectedAllegroConnectionId, setSelectedAllegroConnectionId] = useState('');
  const [manualEnvironment, setManualEnvironment] = useState<AllegroCatalogEnvironment>('production');
  const [validationError, setValidationError] = useState<string | null>(null);
  const rotate = useUpdateConnectionCredentialsMutation();
  const updateConfig = useUpdateConnectionMutation();
  const { showToast } = useToast();
  // #1387 — every Allegro connection the operator already has, offered as a
  // "reuse this app's credentials" pick list. Filtered client-side (not just
  // trusted from the `platformType` query param) so a mocked/misbehaving
  // response never renders a non-Allegro connection as a reuse target.
  // Gated on `showRotate` (#1405 review) so the query doesn't fire on every
  // page render — only when the operator actually opens "Rotate API key".
  const allegroConnectionsQuery = useConnectionsQuery(
    { platformType: 'allegro', status: 'active' },
    { enabled: showRotate }
  );

  if (!connection.credentialsBacked) {
    return (
      <FormField label="API Key" name="credentials">
        <Input value="Environment variable (not editable via UI)" disabled />
      </FormField>
    );
  }

  const allegroConnections = (allegroConnectionsQuery.data ?? []).filter(
    (c) => c.platformType === 'allegro' && c.status === 'active'
  );
  const hasAllegroConnections = allegroConnections.length > 0;
  // The query is gated on `showRotate` (#1405 review), so the first render
  // after opening the panel is a loading gap — don't render the "no Allegro
  // connection" empty state during that gap, it would misleadingly suggest
  // there's nothing to reuse before the fetch has even resolved.
  const isLoadingAllegroConnections = showRotate && allegroConnectionsQuery.isLoading;
  // Zero Allegro connections collapses the choice to manual entry regardless
  // of the radio's own state — there's nothing to reuse.
  const effectiveCredSource: AllegroCredentialSource = hasAllegroConnections
    ? credSource
    : 'manual';
  const selectedAllegroConnection = allegroConnections.find(
    (c) => c.id === selectedAllegroConnectionId
  );
  const reuseEnvironment = selectedAllegroConnection
    ? readAllegroEnvironment(selectedAllegroConnection)
    : undefined;

  const initialAllegroEnabled = isAllegroCategoryAccessEnabled(connection);
  // Resync when the connection's server-confirmed state changes (e.g. after
  // this panel's own save invalidates the query) — the Allegro section is
  // always mounted now (not gated behind "Rotate API key"), so there's no
  // open/close moment to reseed it from otherwise.
  useEffect(() => {
    setAllegroEnabled(initialAllegroEnabled);
  }, [initialAllegroEnabled]);
  const idFilled = allegroClientId.trim().length > 0;
  const secretFilled = allegroClientSecret.trim().length > 0;
  const reuseSelected = selectedAllegroConnectionId.trim().length > 0;
  const canSubmit =
    apiKey.trim().length > 0 ||
    (allegroEnabled && effectiveCredSource === 'manual' && (idFilled || secretFilled)) ||
    (allegroEnabled && effectiveCredSource === 'reuse' && reuseSelected) ||
    allegroEnabled !== initialAllegroEnabled;

  function openApiKeyInput(): void {
    setApiKey('');
    setShowRotate(true);
  }

  function closeApiKeyInput(): void {
    setShowRotate(false);
    setApiKey('');
    setValidationError(null);
  }

  /** Clears only the one-shot manual-entry secret fields after a successful
   *  save — `allegroEnabled`/`credSource`/`selectedAllegroConnectionId`/
   *  `manualEnvironment` are sticky UI state now that this section is always
   *  visible (not a collapse/reopen flow), so they're left as the operator
   *  set them. */
  function resetAllegroTransientFields(): void {
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
      if (effectiveCredSource === 'manual') {
        if (idFilled !== secretFilled) {
          setValidationError(
            'Enter both the Allegro Client ID and Client Secret, or leave both blank.'
          );
          return;
        }
        if (!idFilled && !secretFilled && !initialAllegroEnabled) {
          setValidationError(
            'Enter the Allegro Client ID and Client Secret to enable category browsing.'
          );
          return;
        }
      } else if (!reuseSelected && !initialAllegroEnabled) {
        setValidationError(
          'Select an Allegro connection to reuse its credentials, or switch to manual entry.'
        );
        return;
      }
    }

    const credentials: Record<string, unknown> = {};
    if (apiKey.trim()) credentials.apiKey = apiKey.trim();
    // Both-or-neither is already enforced above; omit both fields entirely
    // (not empty strings) when the checkbox is unchecked, so the backend's
    // shape validator's "both or neither" rule is satisfied by omission.
    if (allegroEnabled && effectiveCredSource === 'manual' && idFilled && secretFilled) {
      credentials.allegroClientId = allegroClientId.trim();
      credentials.allegroClientSecret = allegroClientSecret.trim();
    }
    // #1387 — server-side copy: the backend resolves this into
    // allegroClientId/allegroClientSecret from the source connection. The
    // raw secret never round-trips through this browser.
    if (allegroEnabled && effectiveCredSource === 'reuse' && reuseSelected) {
      credentials.reuseAllegroConnectionId = selectedAllegroConnectionId;
    }

    try {
      if (Object.keys(credentials).length > 0) {
        await rotate.mutateAsync({ connectionId: connection.id, credentials });
      }
      // Second, sequenced request: keep `allegroCategoryAccessEnabled` in
      // sync with the checkbox whenever either changed or new Allegro
      // credentials were just written (manual or reused). Only reached once
      // the credentials write above has succeeded (or wasn't needed) — see
      // the module header for why this ordering fails safe.
      if (
        allegroEnabled !== initialAllegroEnabled ||
        'allegroClientId' in credentials ||
        'reuseAllegroConnectionId' in credentials
      ) {
        // `allegroEnvironment` drives which Allegro OAuth/REST host the
        // category-catalog client targets (erli-adapter.factory.ts defaults
        // to 'production' when absent). Reuse infers it from the source
        // connection so a sandbox Allegro app's credentials aren't sent to
        // Allegro's production token endpoint (always a 401 invalid_client);
        // manual entry uses the operator's explicit pick since there's no
        // source connection to infer it from.
        const allegroEnvironment: AllegroCatalogEnvironment | undefined = allegroEnabled
          ? effectiveCredSource === 'reuse'
            ? reuseEnvironment
            : manualEnvironment
          : undefined;
        await updateConfig.mutateAsync({
          connectionId: connection.id,
          input: {
            config: {
              ...connection.config,
              allegroCategoryAccessEnabled: allegroEnabled,
              ...(allegroEnvironment ? { allegroEnvironment } : {}),
            },
          },
        });
      }
      showToast({
        tone: 'success',
        title: 'Credentials saved',
        description: 'Erli connection credentials are now in use.',
      });
      closeApiKeyInput();
      resetAllegroTransientFields();
    } catch {
      // Surfaced via rotate.error / updateConfig.error below. Fields are
      // deliberately NOT cleared on failure so a retry can resend them.
    }
  };

  return (
    <div className="form-grid">
      {rotate.error ? <Alert tone="error">{rotate.error.message}</Alert> : null}
      {updateConfig.error ? (
        <Alert tone="error">
          Category-browsing setting failed to save: {updateConfig.error.message}. Click Save again
          to retry.
        </Alert>
      ) : null}
      {validationError ? <Alert tone="error">{validationError}</Alert> : null}

      <FormField
        label="API Key"
        name="credentials"
        description="Stored securely on the server. Rotate to replace the key without restarting the API."
      >
        {showRotate ? (
          <div className="erli-credentials-panel__input-row">
            <Input
              type="password"
              autoComplete="off"
              placeholder="New API key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <Button tone="ghost" type="button" onClick={closeApiKeyInput}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button tone="secondary" type="button" onClick={openApiKeyInput}>
            Rotate API key
          </Button>
        )}
      </FormField>

      {/* Independent of the API key rotation above — an operator managing
       * category-browsing access shouldn't have to open (or fill in) the key
       * rotation flow to reach this. */}
      <div>
        <label className="erli-credentials-panel__option-label">
          <input
            type="checkbox"
            checked={allegroEnabled}
            onChange={(event) => setAllegroEnabled(event.target.checked)}
          />
          <span>
            <strong>Browse Allegro categories when creating Erli offers</strong>
            <small className="erli-credentials-panel__hint">
              Turn this on to pick categories and fill required parameters from a list, the same
              way you do for Allegro. Leave it off and you&apos;ll enter category IDs by hand.
            </small>
          </span>
        </label>

        {allegroEnabled ? (
          <div className="form-grid">
            {isLoadingAllegroConnections ? (
              <Alert tone="info">Checking for existing Allegro connections...</Alert>
            ) : hasAllegroConnections ? (
              <div>
                <label className="erli-credentials-panel__option-label">
                  <input
                    type="radio"
                    name="erli-allegro-cred-source"
                    checked={effectiveCredSource === 'reuse'}
                    onChange={() => setCredSource('reuse')}
                  />
                  <span>
                    <strong>Reuse credentials from an existing Allegro connection</strong>
                    <small className="erli-credentials-panel__hint">
                      Recommended - uses the same app credentials already configured on that
                      connection. Nothing new to register.
                    </small>
                  </span>
                </label>
                {effectiveCredSource === 'reuse' ? (
                  <div className="erli-credentials-panel__indent">
                    <Select
                      aria-label="Allegro connection to reuse"
                      value={selectedAllegroConnectionId}
                      onChange={(event) => setSelectedAllegroConnectionId(event.target.value)}
                    >
                      <option value="">Select an Allegro connection...</option>
                      {allegroConnections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <small className="erli-credentials-panel__hint">
                      Only read access to the public category catalog is used - this
                      connection&apos;s seller credentials are never touched.
                    </small>
                    {selectedAllegroConnection ? (
                      <small className="erli-credentials-panel__hint">
                        Will use that connection&apos;s environment: <strong>{reuseEnvironment}</strong>.
                      </small>
                    ) : null}
                  </div>
                ) : null}
                <label className="erli-credentials-panel__option-label">
                  <input
                    type="radio"
                    name="erli-allegro-cred-source"
                    checked={effectiveCredSource === 'manual'}
                    onChange={() => setCredSource('manual')}
                  />
                  <span>
                    <strong>Enter Allegro app credentials manually</strong>
                    <small className="erli-credentials-panel__hint">
                      Use a different Allegro app - e.g. one dedicated just for category browsing.
                    </small>
                  </span>
                </label>
              </div>
            ) : (
              <Alert tone="info">
                No Allegro connection found on this account. Enter your own Allegro app
                credentials below to enable category browsing.
              </Alert>
            )}

            {effectiveCredSource === 'manual' ? (
              <div className="form-grid">
                <div>
                  <Select
                    aria-label="Allegro app environment"
                    value={manualEnvironment}
                    onChange={(event) =>
                      setManualEnvironment(event.target.value as AllegroCatalogEnvironment)
                    }
                  >
                    <option value="production">Production</option>
                    <option value="sandbox">Sandbox</option>
                  </Select>
                  <small className="erli-credentials-panel__hint">
                    Sandbox and production Allegro apps are registered separately - pick the one
                    this Client ID/Secret belongs to, or category requests will fail
                    authentication.
                  </small>
                </div>
                <div>
                  <Input
                    autoComplete="off"
                    placeholder="Allegro Client ID"
                    value={allegroClientId}
                    onChange={(event) => setAllegroClientId(event.target.value)}
                  />
                  <small className="erli-credentials-panel__hint">
                    From an Allegro app you register at apps.developer.allegro.pl. Used only to
                    read the public category catalog - never to sign in as a seller or place
                    offers.
                  </small>
                </div>
                <div>
                  <div className="erli-credentials-panel__input-row">
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
                  <small className="erli-credentials-panel__hint">
                    Stored encrypted. You won&apos;t see it again after saving.
                  </small>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="form-actions">
        <Button
          type="button"
          onClick={(event) => void onSave(event)}
          disabled={rotate.isPending || updateConfig.isPending || !canSubmit}
        >
          {rotate.isPending || updateConfig.isPending ? 'Saving...' : 'Save credentials'}
        </Button>
      </div>
    </div>
  );
}
