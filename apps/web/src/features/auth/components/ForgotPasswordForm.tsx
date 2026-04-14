import { useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useForgotPassword } from '../hooks/use-forgot-password';
import {
  forgotPasswordFormSchema,
  type ForgotPasswordFormValues,
} from './forgot-password-form.schema';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';

const DEFAULT_VALUES: ForgotPasswordFormValues = { email: '' };

export function ForgotPasswordForm(): ReactElement {
  const mutation = useForgotPassword();
  const [submitted, setSubmitted] = useState(false);
  const form = useForm<ForgotPasswordFormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(forgotPasswordFormSchema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync({ email: values.email });
      setSubmitted(true);
    } catch {
      // mutation.error handles display
    }
  });

  if (submitted) {
    return (
      <div className="form-card guest-form">
        <Alert tone="info" title="Check your email">
          If an account exists for that email, you&apos;ll receive password reset instructions
          shortly.
        </Alert>
        <div className="form-actions">
          <Link className="button" to="/login">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      className="form-card guest-form"
      noValidate
      onSubmit={(event) => void onSubmit(event)}
    >
      {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
      {mutation.error ? (
        <Alert tone="error" title="Request failed">
          {mutation.error.message}
        </Alert>
      ) : null}

      <FormField label="Email" name="email" error={form.formState.errors.email?.message}>
        <Input
          {...form.register('email')}
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          invalid={Boolean(form.formState.errors.email)}
        />
      </FormField>

      <div className="form-actions">
        <Button className="guest-form__submit" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Sending...' : 'Send reset link'}
        </Button>
        <Link className="guest-form__secondary" to="/login">
          Back to sign in
        </Link>
      </div>
    </form>
  );
}
