/**
 * Step 2 — Add packers (#3457)
 *
 * Optional: admins and operators can open the pack bench themselves, so the
 * Continue button reads "Skip for now" while there are no packers.
 *
 * ## The one-time password is shown once, then gone
 *
 * `POST /users` returns the temporary password in its response and nowhere
 * else (#3456). It is held in THIS component's state only — never in the
 * query cache, never in storage — so leaving the step unmounts it and the
 * password cannot be rendered again. The packer is asked to replace it at
 * first sign-in.
 *
 * States (mockup vocabulary): `step-2-packers-empty`, `step-2-packer-added`.
 *
 * @module features/oms-onboarding/components
 */
import { useRef, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { StatusBadge } from '../../../shared/ui/status-badge';
import {
  readCreateUserConflictField,
  useCreateUserMutation,
  type PackerSummary,
} from '../../users';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import {
  ADD_PACKER_DEFAULTS,
  addPackerFormSchema,
  type AddPackerFormSubmission,
  type AddPackerFormValues,
} from './step-packers.schema';
import { StepPanel } from './step-panel';

export interface StepPackersProps {
  readonly packers: readonly PackerSummary[];
  readonly canWrite: boolean;
  readonly demoReadOnly: boolean;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

interface CreatedPacker {
  readonly name: string;
  readonly login: string;
  readonly password: string;
}

export function StepPackers({ packers, canWrite, demoReadOnly, onBack, onContinue }: StepPackersProps): ReactElement {
  const createUser = useCreateUserMutation();
  const [created, setCreated] = useState<CreatedPacker | null>(null);
  const [copied, setCopied] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const form = useForm<AddPackerFormValues, undefined, AddPackerFormSubmission>({
    defaultValues: ADD_PACKER_DEFAULTS,
    resolver: zodResolver(addPackerFormSchema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : []
  );

  const onSubmit = form.handleSubmit(async (values) => {
    setCreated(null);
    setCopied(false);
    try {
      const response = await createUser.mutateAsync({
        displayName: values.displayName,
        username: values.username,
        email: values.email === '' ? undefined : values.email,
        role: 'packer',
      });
      setCreated({ name: values.displayName, login: values.username, password: response.temporaryPassword });
      form.reset(ADD_PACKER_DEFAULTS);
    } catch (error) {
      const field = readCreateUserConflictField(error);
      if (field === 'username') {
        form.setError('username', { message: COPY.step2.loginTaken });
      } else if (field === 'email') {
        form.setError('email', { message: COPY.step2.emailTaken });
      }
      // Anything else is shown by the Alert below from `createUser.error`.
    }
  });

  const copyPassword = (): void => {
    if (created === null) return;
    const selectText = (): void => passwordRef.current?.select();
    // The Clipboard API is absent outside a secure context; selecting the
    // text leaves the operator one keystroke from copying it themselves.
    if (navigator.clipboard === undefined) {
      selectText();
      return;
    }
    navigator.clipboard.writeText(created.password).then(() => setCopied(true), selectText);
  };

  const unmappedError =
    createUser.error !== null && readCreateUserConflictField(createUser.error) === null ? createUser.error : null;
  const disabled = !canWrite || createUser.isPending;

  return (
    <StepPanel
      step={2}
      why={COPY.step2.why}
      onBack={onBack}
      next={
        <Button type="button" tone="primary" data-testid="btn-continue-step-2" onClick={onContinue}>
          {packers.length > 0 ? COPY.continue : COPY.step2.skip}
        </Button>
      }
    >
      <form className="oms-onboarding__form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <p className="oms-onboarding__subtitle">{COPY.step2.addTitle}</p>
        {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
          <FormErrorSummary errors={validationMessages} />
        ) : null}
        {unmappedError !== null ? (
          <Alert tone="error" title={COPY.step2.createFailedTitle}>
            {unmappedError.message}
          </Alert>
        ) : null}
        <div className="oms-onboarding__fields">
          <FormField label={COPY.step2.nameLabel} name="displayName" error={form.formState.errors.displayName?.message}>
            <Input
              {...form.register('displayName')}
              data-testid="input-p-name"
              placeholder={COPY.step2.namePlaceholder}
              autoComplete="off"
              invalid={Boolean(form.formState.errors.displayName)}
              disabled={!canWrite}
            />
          </FormField>
          <FormField
            label={COPY.step2.loginLabel}
            name="username"
            description={COPY.step2.loginHint}
            error={form.formState.errors.username?.message}
          >
            <Input
              {...form.register('username')}
              data-testid="input-p-login"
              className="mono-text"
              placeholder={COPY.step2.loginPlaceholder}
              autoComplete="off"
              invalid={Boolean(form.formState.errors.username)}
              disabled={!canWrite}
            />
          </FormField>
          <FormField
            label={`${COPY.step2.emailLabel} ${COPY.step2.emailOptional}`}
            name="email"
            description={COPY.step2.emailHint}
            error={form.formState.errors.email?.message}
          >
            <Input
              {...form.register('email')}
              data-testid="input-p-mail"
              type="email"
              placeholder={COPY.step2.emailPlaceholder}
              autoComplete="off"
              invalid={Boolean(form.formState.errors.email)}
              disabled={!canWrite}
            />
          </FormField>
        </div>
        <div>
          <Button
            type="submit"
            tone="secondary"
            data-testid="btn-add-packer"
            disabled={disabled}
            title={demoReadOnly ? DEMO_READ_ONLY_ACTION_MESSAGE : !canWrite ? COPY.adminOnly : undefined}
          >
            {createUser.isPending ? COPY.step2.adding : COPY.step2.add}
          </Button>
        </div>
      </form>

      {created !== null ? (
        <Alert tone="success" title={COPY.step2.createdTitle(created.name)} data-testid="packer-created-notice">
          <span>{COPY.step2.createdBody(created.login)}</span>
          <span className="oms-onboarding__copybox">
            <Input
              ref={passwordRef}
              readOnly
              value={created.password}
              aria-label={COPY.step2.tempPasswordLabel}
              data-testid="input-tmp-pass"
              className="mono-text"
            />
            <Button type="button" tone="secondary" data-testid="btn-copy-pass" onClick={copyPassword}>
              {copied ? COPY.step2.copied : COPY.step2.copy}
            </Button>
          </span>
        </Alert>
      ) : null}

      {packers.length > 0 ? (
        <div>
          <p className="oms-onboarding__subtitle">{COPY.step2.listTitle(packers.length)}</p>
          <ul className="oms-onboarding__list" data-testid="packer-list">
            {packers.map((packer) => (
              <li key={packer.id} className="oms-onboarding__list-row">
                <span>
                  {COPY.step2.loginPrefix} <span className="mono-text">{packer.username}</span>
                </span>
                <StatusBadge tone="success" compact>
                  {COPY.step2.packerBadge}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Alert tone="info" title={COPY.step2.unassignedTitle}>
        {COPY.step2.unassignedBody}
      </Alert>

      <details className="oms-onboarding__more">
        <summary>{COPY.step2.existingSummary}</summary>
        <p>
          {COPY.step2.existingBody} <Link to="/users">{COPY.step2.usersLink}</Link>.
        </p>
      </details>
    </StepPanel>
  );
}
