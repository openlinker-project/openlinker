import type { ReactElement } from 'react';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useRegisterMutation } from '../hooks/use-register-mutation';
import { registerFormSchema, type RegisterFormValues } from './register-form.schema';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';

export function RegisterForm(): ReactElement {
  const register = useRegisterMutation();
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<RegisterFormValues>({
    defaultValues: { username: '', email: '', password: '', confirmPassword: '' },
    resolver: zodResolver(registerFormSchema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : []
  );

  if (submitted) {
    return (
      <div className="guest-page__success">
        <p>Registration submitted. An admin will review your request.</p>
        <Link to="/login">Back to login</Link>
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async ({ username, email, password }) => {
    try {
      await register.mutateAsync({ username, email, password });
      setSubmitted(true);
    } catch {
      return;
    }
  });

  return (
    <form className="form-card guest-form" onSubmit={(event) => void onSubmit(event)} noValidate>
      {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
      {register.error ? (
        <Alert tone="error" title="Registration failed">
          {register.error.message}
        </Alert>
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

      <Button type="submit" tone="primary" disabled={register.isPending}>
        {register.isPending ? 'Submitting…' : 'Request access'}
      </Button>

      <p className="guest-form__footer-link">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </form>
  );
}
