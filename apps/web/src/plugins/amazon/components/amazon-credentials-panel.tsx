/**
 * Amazon Credentials Panel (#4186)
 *
 * Plugin-owned credentials affordance for Amazon connections: re-authorizes
 * the connection with a new LWA refresh token (and, when the app's secret was
 * rotated, the new client secret), and sets the AWS key the notification
 * queue is read with. `PUT /connections/:id/credentials` replaces the stored
 * set, so the form asks for the whole LWA set and keeps the AWS pair together.
 *
 * Nothing stored is ever shown back. A read-only session sees the status with
 * the write control locked.
 *
 * @module plugins/amazon/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import type { Connection } from '../../../features/connections';
import { useUpdateConnectionCredentialsMutation } from '../../../features/connections';
import { useDemoMode } from '../../../features/system';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useToast } from '../../../shared/ui/toast-provider';
import { useAmazonMessages } from '../messages';

interface Draft {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
}

const EMPTY: Draft = { clientId: '', clientSecret: '', refreshToken: '', awsAccessKeyId: '', awsSecretAccessKey: '' };

export function AmazonCredentialsPanel({ connection }: { connection: Connection }): ReactElement {
  const copy = useAmazonMessages().credentials;
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const rotate = useUpdateConnectionCredentialsMutation();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  if (!connection.credentialsBacked) {
    return (
      <FormField label={copy.label} name="credentials">
        <Input value={copy.environment} disabled />
      </FormField>
    );
  }

  const lwaComplete =
    draft.clientId.trim() !== '' && draft.clientSecret.trim() !== '' && draft.refreshToken.trim() !== '';
  const awsPaired = (draft.awsAccessKeyId.trim() === '') === (draft.awsSecretAccessKey.trim() === '');
  const canSubmit = lwaComplete && awsPaired;
  const missing = connection.credentialsStored === false;

  const set = (field: keyof Draft) => (value: string) => setDraft((current) => ({ ...current, [field]: value }));

  const onSave = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await rotate.mutateAsync({
        connectionId: connection.id,
        credentials: {
          clientId: draft.clientId.trim(),
          clientSecret: draft.clientSecret.trim(),
          refreshToken: draft.refreshToken.trim(),
          ...(draft.awsAccessKeyId.trim()
            ? { awsAccessKeyId: draft.awsAccessKeyId.trim(), awsSecretAccessKey: draft.awsSecretAccessKey.trim() }
            : {}),
        },
      });
      showToast({ tone: 'success', title: copy.toast.title, description: copy.toast.description });
      setDraft(EMPTY);
      setOpen(false);
    } catch {
      // surfaced via rotate.error
    }
  };

  return (
    <FormField label={copy.label} name="credentials" description={missing ? copy.missing : copy.stored}>
      {open ? (
        <div className="form-grid">
          {rotate.error ? <Alert tone="error">{describeApiError(rotate.error, 'amazon')}</Alert> : null}
          <Input
            aria-label={copy.clientId}
            autoComplete="off"
            className="mono-text"
            placeholder={copy.clientId}
            value={draft.clientId}
            onChange={(event) => set('clientId')(event.target.value)}
          />
          <Input
            aria-label={copy.clientSecret}
            type="password"
            autoComplete="off"
            placeholder={copy.clientSecret}
            value={draft.clientSecret}
            onChange={(event) => set('clientSecret')(event.target.value)}
          />
          <Input
            aria-label={copy.refreshToken}
            type="password"
            autoComplete="off"
            placeholder={copy.refreshToken}
            value={draft.refreshToken}
            onChange={(event) => set('refreshToken')(event.target.value)}
          />
          <Input
            aria-label={copy.awsAccessKeyId}
            autoComplete="off"
            className="mono-text"
            placeholder={copy.awsAccessKeyId}
            value={draft.awsAccessKeyId}
            onChange={(event) => set('awsAccessKeyId')(event.target.value)}
          />
          <Input
            aria-label={copy.awsSecretAccessKey}
            type="password"
            autoComplete="off"
            placeholder={copy.awsSecretAccessKey}
            value={draft.awsSecretAccessKey}
            onChange={(event) => set('awsSecretAccessKey')(event.target.value)}
          />
          <p className="form-field__description">{awsPaired ? copy.awsHint : copy.awsPaired}</p>
          <div className="form-actions">
            <Button type="button" onClick={(event) => void onSave(event)} disabled={rotate.isPending || !canSubmit}>
              {rotate.isPending ? copy.saving : copy.save}
            </Button>
            <Button
              tone="secondary"
              type="button"
              onClick={() => {
                setOpen(false);
                setDraft(EMPTY);
              }}
            >
              {copy.cancel}
            </Button>
          </div>
        </div>
      ) : write.visible ? (
        <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
          <Button
            tone={missing ? 'primary' : 'secondary'}
            type="button"
            disabled={!write.canWrite}
            onClick={() => setOpen(true)}
          >
            {copy.reauthorize}
          </Button>
        </ReadOnlyLock>
      ) : (
        <Input value={missing ? copy.missingShort : copy.storedShort} disabled />
      )}
    </FormField>
  );
}
