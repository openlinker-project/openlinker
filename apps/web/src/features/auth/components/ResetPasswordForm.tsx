import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { useResetPassword } from '../hooks/use-reset-password';
import { useToast } from '../../../shared/ui/toast-provider';
import {
  resetPasswordFormSchema,
  type ResetPasswordFormValues,
} from './reset-password-form.schema';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';

interface ResetPasswordFormProps {
  token: string;
}

const DEFAULT_VALUES: ResetPasswordFormValues = { newPassword: '', confirmPassword: '' };

export function ResetPasswordForm({ token }: ResetPasswordFormProps): ReactElement {
  const mutation = useResetPassword();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const form = useForm<ResetPasswordFormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(resetPasswordFormSchema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync({ token, newPassword: values.newPassword });
      form.reset();
      showToast({
        tone: 'success',
        title: 'Password updated',
        description: 'You can now sign in with your new password.',
      });
      void navigate('/login', { replace: true });
    } catch {
      // mutation.error displayed below
    }
  });

  return (
    <form
      className="form-card guest-form"
      noValidate
      onSubmit={(event) => void onSubmit(event)}
    >
      {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
      {mutation.error ? (
        <Alert tone="error" title="Reset failed">
          {mutation.error.message}
        </Alert>
      ) : null}

      <FormField
        label="New password"
        name="newPassword"
        error={form.formState.errors.newPassword?.message}
      >
        <Input
          {...form.register('newPassword')}
          type="password"
          autoComplete="new-password"
          invalid={Boolean(form.formState.errors.newPassword)}
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
          autoComplete="new-password"
          invalid={Boolean(form.formState.errors.confirmPassword)}
        />
      </FormField>

      <div className="form-actions">
        <Button className="guest-form__submit" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Updating...' : 'Update password'}
        </Button>
        <Link className="guest-form__secondary" to="/login">
          Back to sign in
        </Link>
      </div>
    </form>
  );
}
