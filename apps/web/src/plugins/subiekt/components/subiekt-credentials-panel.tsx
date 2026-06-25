/**
 * Subiekt Credentials Panel (#759)
 *
 * Plugin-owned credentials affordance for Subiekt connections — rotates the
 * stored Bearer bridge token in place via PUT /connections/:id/credentials.
 * Clone of `PrestashopCredentialsPanel`, preserving every security property:
 * `type="password"`, `autoComplete="off"`, clear-on-success, toast carries
 * NO secret value, gated on `connection.credentialsBacked`.
 *
 * The credential key is `bridgeToken` (Decision 7) — pinned to the Subiekt BE
 * adapter contract (#753), NOT copied from PrestaShop's `webserviceApiKey`.
 * A panel test asserts the body key so a mismatch fails loudly. The token is
 * NEVER routed through `mergeStructuredIntoConfig` / `config`.
 *
 * @module plugins/subiekt/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import { useUpdateConnectionCredentialsMutation } from '../../../features/connections';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';
import { useTranslation } from '../../../shared/i18n';

/** Bearer bridge-token credential key — pinned to the Subiekt BE adapter (#753). */
export const SUBIEKT_CREDENTIAL_KEY = 'bridgeToken';

export function SubiektCredentialsPanel({
  connection,
}: {
  connection: Connection;
}): ReactElement {
  const [showRotate, setShowRotate] = useState(false);
  const [newToken, setNewToken] = useState('');
  const rotate = useUpdateConnectionCredentialsMutation();
  const { showToast } = useToast();
  const { t } = useTranslation();

  if (!connection.credentialsBacked) {
    return (
      <FormField label={t('subiekt.settings.token.label', 'Bridge token')} name="credentials">
        <Input
          value={t(
            'subiekt.settings.token.envManaged',
            'Environment variable (not editable via UI)',
          )}
          disabled
        />
      </FormField>
    );
  }

  // Rotate handler — sends { [SUBIEKT_CREDENTIAL_KEY]: newToken.trim() },
  // success toast WITHOUT the secret, clears local state, closes the form.
  const onRotate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (newToken.trim().length === 0) return;
    try {
      await rotate.mutateAsync({
        connectionId: connection.id,
        credentials: { [SUBIEKT_CREDENTIAL_KEY]: newToken.trim() },
      });
      showToast({
        tone: 'success',
        title: t('subiekt.settings.token.rotated', 'Credentials rotated'),
        description: t('subiekt.settings.token.rotatedHint', 'The new bridge token is now in use.'),
      });
      setNewToken('');
      setShowRotate(false);
    } catch {
      // surfaced via rotate.error
    }
  };

  return (
    <FormField
      label={t('subiekt.settings.token.label', 'Bridge token')}
      name="credentials"
      description={t(
        'subiekt.settings.token.description',
        'Stored securely on the server. Rotate to replace the bridge token without restarting the API.',
      )}
    >
      {showRotate ? (
        <div className="form-grid">
          {rotate.error ? <Alert tone="error">{rotate.error.message}</Alert> : null}
          <Input
            type="password"
            autoComplete="off"
            placeholder={t('subiekt.settings.token.placeholder', 'New bridge token')}
            value={newToken}
            onChange={(event) => setNewToken(event.target.value)}
          />
          <div className="form-actions">
            <Button
              type="button"
              onClick={(event) => void onRotate(event)}
              disabled={rotate.isPending || newToken.trim().length === 0}
            >
              {rotate.isPending
                ? t('subiekt.settings.token.rotating', 'Rotating...')
                : t('subiekt.settings.token.save', 'Save new token')}
            </Button>
            <Button
              tone="secondary"
              type="button"
              onClick={() => {
                setShowRotate(false);
                setNewToken('');
              }}
            >
              {t('subiekt.settings.token.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button tone="secondary" type="button" onClick={() => setShowRotate(true)}>
          {t('subiekt.settings.token.rotate', 'Rotate bridge token')}
        </Button>
      )}
    </FormField>
  );
}
