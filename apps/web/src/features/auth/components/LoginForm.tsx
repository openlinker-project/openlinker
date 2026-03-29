import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useLogin } from '../hooks/use-login';
import { loginFormSchema, type LoginFormValues } from './login-form.schema';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';

const DEFAULT_VALUES: LoginFormValues = {
  username: '',
  password: '',
};

export function LoginForm(): ReactElement {
  const login = useLogin();
  const form = useForm<LoginFormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(loginFormSchema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
    } catch {
      return;
    }
  });

  return (
    <form className="form-card guest-form" onSubmit={(event) => void onSubmit(event)}>
      {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
      {login.error ? (
        <Alert tone="error" title="Login failed">
          {login.error.message}
        </Alert>
      ) : null}

      <FormField label="Username" name="username" error={form.formState.errors.username?.message}>
        <Input
          {...form.register('username')}
          placeholder="Enter your username"
          autoComplete="username"
          invalid={Boolean(form.formState.errors.username)}
        />
      </FormField>

      <FormField label="Password" name="password" error={form.formState.errors.password?.message}>
        <Input
          {...form.register('password')}
          type="password"
          placeholder="Enter your password"
          autoComplete="current-password"
          invalid={Boolean(form.formState.errors.password)}
        />
      </FormField>

      <div className="form-actions">
        <Button className="guest-form__submit" type="submit" disabled={login.isPending}>
          {login.isPending ? 'Signing in...' : 'Sign in'}
        </Button>
      </div>
    </form>
  );
}
