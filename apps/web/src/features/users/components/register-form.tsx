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
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useRegisterMutation } from '../hooks/use-register-mutation';
import {
  ANALYTICS_CONSENT_REQUIRED_MESSAGE,
  registerFormSchema,
  type RegisterFormValues,
} from './register-form.schema';
import { ApiError } from '../../../shared/api/api-error';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { MarketingTrackingFootnote } from '../../demo';

interface RegisterFormProps {
  demoMode?: boolean;
  showTrackingFootnote?: boolean;
}

export function RegisterForm({
  demoMode = false,
  showTrackingFootnote = false,
}: RegisterFormProps): ReactElement {
  const register = useRegisterMutation();
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<RegisterFormValues>({
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      // Ticked by default (#1938): on the demo, session recording is the only
      // allowed state of this form. The disclosure below keeps it out of the
      // foreground without hiding it — the fine print under the submit button
      // states it plainly, so consent stays informed.
      analyticsConsent: true,
    },
    resolver: zodResolver(registerFormSchema),
  });

  const analyticsConsent = form.watch('analyticsConsent');
  // Derived from the live value rather than from `formState.errors`, which
  // (with the default `onSubmit` mode) would only populate after a rejected
  // submit. The schema carries the same rule as the authoritative gate.
  const consentError =
    demoMode && analyticsConsent !== true ? ANALYTICS_CONSENT_REQUIRED_MESSAGE : undefined;

  // The consent error renders inside its own box, so it is filtered out here —
  // otherwise the same sentence appears twice on the card (#1938).
  const validationMessages = Object.entries(form.formState.errors).flatMap(([field, error]) =>
    field !== 'analyticsConsent' && error?.message ? [String(error.message)] : []
  );

  if (submitted) {
    return (
      <div className="guest-page__success">
        {demoMode ? (
          <>
            <p>
              Check your email to confirm your account. Click the link we sent you to activate it,
              then sign in.
            </p>
            <Link to="/login">Back to sign in</Link>
          </>
        ) : (
          <>
            <p>Registration submitted. An admin will review your request.</p>
            <Link to="/login">Back to login</Link>
          </>
        )}
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async ({ username, email, password, analyticsConsent }) => {
    try {
      await register.mutateAsync({ username, email, password, analyticsConsent });
      setSubmitted(true);
    } catch {
      return;
    }
  });

  return (
    <form className="form-card guest-form" onSubmit={(event) => void onSubmit(event)} noValidate>
      {demoMode ? (
        <div className="guest-form__demo-bar">
          <strong>🔗 OpenLinker Demo</strong>
          <span>Check your email to confirm and activate your account</span>
        </div>
      ) : null}

      {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
      {register.error ? (
        <Alert tone="error" title="Registration failed">
          {register.error instanceof ApiError && register.error.isConflict()
            ? 'This email is already registered.'
            : register.error.message}
        </Alert>
      ) : null}

      {demoMode ? (
        <div className="guest-form__demo-callout">
          <span className="guest-form__demo-callout-icon" aria-hidden="true">
            ⚡
          </span>
          <div>
            <strong>Demo mode active</strong> — no approval needed. Your account is set to
            read-only. We'll email you a confirmation link; click it to activate your account before
            signing in.
          </div>
        </div>
      ) : null}

      <FormField label="Username" name="username" error={form.formState.errors.username?.message}>
        <Input
          {...form.register('username')}
          placeholder="Choose a username"
          autoComplete="username"
        />
      </FormField>

      <FormField label="Email" name="email" error={form.formState.errors.email?.message}>
        <Input
          {...form.register('email')}
          type="email"
          placeholder="your@email.com"
          autoComplete="email"
        />
      </FormField>

      <FormField label="Password" name="password" error={form.formState.errors.password?.message}>
        <Input
          {...form.register('password')}
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
        />
      </FormField>

      <FormField
        label="Confirm password"
        name="confirmPassword"
        error={form.formState.errors.confirmPassword?.message}
      >
        <Input
          {...form.register('confirmPassword')}
          type="password"
          placeholder="Repeat your password"
          autoComplete="new-password"
        />
      </FormField>

      {demoMode ? (
        /* Held open while consent is off, so the error inside can never be
           collapsed out of sight (#1938). */
        <details className="guest-form__disclosure" open={analyticsConsent !== true || undefined}>
          <summary>Privacy and session recording</summary>
          <div className="guest-form__disclosure-body">
            <label
              className={[
                'guest-form__consent',
                consentError ? 'guest-form__consent--invalid' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <input
                type="checkbox"
                aria-invalid={consentError ? true : undefined}
                {...form.register('analyticsConsent')}
              />
              <span className="guest-form__consent-text">
                <strong>Record my demo session</strong>
                {/* Keep in step with the masking config in
                    features/demo/lib/init-demo-integrations.ts — #1878 narrowed
                    it to passwords only, so any "all inputs masked" wording
                    would be a false claim on the signup path (#1882). */}
                <span className="guest-form__consent-hint">
                  We watch how the demo gets used to see where the product gets confusing. That is
                  the whole reason it is free.
                </span>
                {consentError ? (
                  <span className="guest-form__consent-error" role="alert">
                    {consentError}
                  </span>
                ) : null}
              </span>
            </label>
            <ul className="guest-form__disclosure-list">
              <li>Pages you open and buttons you click</li>
              <li>Text you type, except passwords</li>
              <li>Your browser, screen size, and rough location from your IP</li>
              <li>Nothing real. Every store, order, and invoice in the demo is made up.</li>
            </ul>
          </div>
        </details>
      ) : null}

      <Button
        type="submit"
        tone="primary"
        disabled={register.isPending || (demoMode && analyticsConsent !== true)}
      >
        {register.isPending ? 'Submitting…' : demoMode ? 'Start exploring →' : 'Request access'}
      </Button>

      {demoMode ? (
        <p className="guest-form__consent-fineprint">
          Demo accounts have session recording on. Passwords are never recorded.
        </p>
      ) : null}

      <p className="guest-form__footer-link">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>

      {showTrackingFootnote ? <MarketingTrackingFootnote /> : null}
    </form>
  );
}
