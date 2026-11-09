import { useMemo, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useLogin } from '../hooks/use-login';
import { createLoginFormSchema, type LoginFormValues } from './login-form.schema';
import { useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { MarketingTrackingFootnote } from '../../demo';

const DEFAULT_VALUES: LoginFormValues = {
  username: '',
  password: '',
};

interface LoginFormProps {
  demoMode?: boolean;
  showTrackingFootnote?: boolean;
}

export function LoginForm({
  demoMode = false,
  showTrackingFootnote = false,
}: LoginFormProps): ReactElement {
  const login = useLogin();
  const auth = useMessages('auth');
  const copy = auth.login;
  const schema = useMemo(() => createLoginFormSchema(auth.validation), [auth]);
  const form = useForm<LoginFormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(schema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : []
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
    } catch {
      return;
    }
  });

  return (
    <form className="form-card guest-form" onSubmit={(event) => void onSubmit(event)} noValidate>
      {demoMode ? (
        <div className="guest-form__demo-bar">
          <strong>🔗 {copy.demoTitle}</strong>
          <span>{copy.demoTagline}</span>
          {/* Plain <a>, not router <Link>: these leave the app. They are also the
              crawlable path from the indexed demo back to the project (#3709). */}
          <nav className="guest-form__demo-links" aria-label={copy.projectLinks}>
            <a href="https://openlinker.io/en/">{copy.links.site}</a>
            <a href="https://docs.openlinker.io/">{copy.links.docs}</a>
            <a href="https://github.com/openlinker-project/openlinker">{copy.links.github}</a>
          </nav>
        </div>
      ) : null}

      {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
      {login.error ? (
        <Alert tone="error" title={copy.failed}>
          {login.error.message}
        </Alert>
      ) : null}

      <FormField
        label={copy.username}
        name="username"
        error={form.formState.errors.username?.message}
      >
        <Input
          {...form.register('username')}
          placeholder={copy.username}
          autoComplete="username"
          invalid={Boolean(form.formState.errors.username)}
        />
      </FormField>

      <FormField label={copy.password} name="password" error={form.formState.errors.password?.message}>
        <Input
          {...form.register('password')}
          type="password"
          placeholder={copy.passwordPlaceholder}
          autoComplete="current-password"
          invalid={Boolean(form.formState.errors.password)}
        />
      </FormField>

      <div className="form-actions">
        <Button className="guest-form__submit" type="submit" disabled={login.isPending}>
          {login.isPending ? copy.submitting : copy.submit}
        </Button>
        <Link className="guest-form__secondary" to="/forgot-password">
          {copy.forgotPassword}
        </Link>
      </div>

      {demoMode ? (
        <>
          <div className="guest-form__divider" aria-hidden="true">
            {copy.newHere}
          </div>
          <Link to="/register" className="button button--secondary guest-form__demo-register">
            {copy.registerDemo} <span aria-hidden="true">→</span>
          </Link>
        </>
      ) : null}

      {showTrackingFootnote ? <MarketingTrackingFootnote /> : null}
    </form>
  );
}
