import { useMemo, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useResetPassword } from '../hooks/use-reset-password';
import { useToast } from '../../../shared/ui/toast-provider';
import {
  createResetPasswordFormSchema,
  type ResetPasswordFormValues,
} from './reset-password-form.schema';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useMessages } from '../../../shared/i18n';

interface ResetPasswordFormProps {
  token: string;
}

const DEFAULT_VALUES: ResetPasswordFormValues = { newPassword: '', confirmPassword: '' };

export function ResetPasswordForm({ token }: ResetPasswordFormProps): ReactElement {
  const mutation = useResetPassword();
  const auth = useMessages('auth');
  const copy = auth.resetPassword;
  const schema = useMemo(() => createResetPasswordFormSchema(auth.validation), [auth]);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const form = useForm<ResetPasswordFormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(schema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((fieldError) =>
    fieldError?.message ? [String(fieldError.message)] : [],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync({ token, newPassword: values.newPassword });
      form.reset();
      showToast({
        tone: 'success',
        title: copy.updated,
        description: copy.updatedDescription,
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
        <Alert tone="error" title={copy.failed}>
          {describeApiError(mutation.error, 'auth')}
        </Alert>
      ) : null}

      <FormField
        label={copy.newPassword}
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
        label={copy.confirmPassword}
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
          {mutation.isPending ? copy.submitting : copy.submit}
        </Button>
        <Link className="guest-form__secondary" to="/login">
          {auth.common.backToSignIn}
        </Link>
      </div>
    </form>
  );
}
