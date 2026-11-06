/**
 * Register Form
 *
 * Self-service registration form for the /register guest page. Submits to
 * POST /auth/register. In demo mode (OL_DEMO_MODE=true), accounts need no
 * admin approval but stay inactive until the user confirms their email
 * (#1624) — the success screen reflects that confirmation step.
 *
 * @module features/users/components
 */
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useRegisterMutation } from '../hooks/use-register-mutation';
import { createRegisterFormSchema, type RegisterFormValues } from './register-form.schema';
import { renderRich, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { MarketingTrackingFootnote, SessionRecordingBullets } from '../../demo';

interface RegisterFormProps {
  demoMode?: boolean;
  showTrackingFootnote?: boolean;
}

export function RegisterForm({
  demoMode = false,
  showTrackingFootnote = false,
}: RegisterFormProps): ReactElement {
  const register = useRegisterMutation();
  const users = useMessages('users');
  const copy = users.register;
  const schema = useMemo(() => createRegisterFormSchema(users.validation), [users]);
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<RegisterFormValues>({
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
    resolver: zodResolver(schema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : []
  );

  if (submitted) {
    return (
      <div className="guest-page__success">
        {demoMode ? (
          <>
            <p>{copy.demoSubmitted}</p>
            <Link to="/login">{copy.backToSignIn}</Link>
          </>
        ) : (
          <>
            <p>{copy.submitted}</p>
            <Link to="/login">{copy.backToLogin}</Link>
          </>
        )}
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async ({ username, email, password }) => {
    try {
      // Session recording is a condition of the demo, not a choice on this form
      // (#1938): creating the account is the acceptance, and the notice under
      // the submit button is where it is disclosed. Outside demo mode nothing
      // records, so nothing is accepted.
      await register.mutateAsync({ username, email, password, analyticsConsent: demoMode });
      setSubmitted(true);
    } catch {
      return;
    }
  });

  return (
    <form className="form-card guest-form" onSubmit={(event) => void onSubmit(event)} noValidate>
      {demoMode ? (
        <div className="guest-form__demo-bar">
          <strong>🔗 {copy.demoBarTitle}</strong>
          <span>{copy.demoBar}</span>
        </div>
      ) : null}

      {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
      {register.error ? (
        <Alert tone="error" title={copy.failed}>
          {/*
            The 409 branch used to hardcode 'This email is already
            registered.' It was wrong twice (#3156 review): it told an
            anonymous visitor that a specific email exists — the enumeration
            claim the server just stopped making — and a USERNAME-only
            collision returns the same 409, so the user was told to change an
            email that was never the problem and looped. The server's own
            message names neither field, so render it.
          */}
          {register.error.message}
        </Alert>
      ) : null}

      {demoMode ? (
        <div className="guest-form__demo-callout">
          <span className="guest-form__demo-callout-icon" aria-hidden="true">
            ⚡
          </span>
          <div>{renderRich(copy.demoCallout, { strong: (text) => <strong>{text}</strong> })}</div>
        </div>
      ) : null}

      <FormField label={copy.username} name="username" error={form.formState.errors.username?.message}>
        <Input
          {...form.register('username')}
          placeholder={copy.usernamePlaceholder}
          autoComplete="username"
        />
      </FormField>

      <FormField label={copy.email} name="email" error={form.formState.errors.email?.message}>
        <Input
          {...form.register('email')}
          type="email"
          placeholder={copy.emailPlaceholder}
          autoComplete="email"
        />
      </FormField>

      <FormField label={copy.password} name="password" error={form.formState.errors.password?.message}>
        <Input
          {...form.register('password')}
          type="password"
          placeholder={copy.passwordPlaceholder}
          autoComplete="new-password"
        />
      </FormField>

      <FormField
        label={copy.confirmPassword}
        name="confirmPassword"
        error={form.formState.errors.confirmPassword?.message}
      >
        <Input
          {...form.register('confirmPassword')}
          type="password"
          placeholder={copy.confirmPasswordPlaceholder}
          autoComplete="new-password"
        />
      </FormField>

      <Button type="submit" tone="primary" disabled={register.isPending}>
        {register.isPending ? (
          copy.submitting
        ) : demoMode ? (
          <>
            {copy.submitDemo} <span aria-hidden="true">→</span>
          </>
        ) : (
          copy.submit
        )}
      </Button>

      {demoMode ? (
        <div className="guest-form__recording-notice">
          <p>{copy.recordingNotice}</p>
          <details className="guest-form__disclosure">
            <summary>{copy.whatWeRecord}</summary>
            <div className="guest-form__disclosure-body">
              <SessionRecordingBullets />
            </div>
          </details>
        </div>
      ) : null}

      <p className="guest-form__footer-link">
        {renderRich(copy.alreadyHaveAccount, { link: (text) => <Link to="/login">{text}</Link> })}
      </p>

      {showTrackingFootnote ? <MarketingTrackingFootnote /> : null}
    </form>
  );
}
