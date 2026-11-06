/**
 * Change Password Form
 *
 * Body of the `/change-password` page (#3456): where an account an admin created
 * with a one-time password replaces it before it can reach anything else. A page
 * rather than a modal for the consent gate's reason - a modal can be clicked past
 * and the API would then answer 403 to everything the account tried.
 *
 * A wrong one-time password is a 400 (not a 401, which would send the client's
 * session handling into a refresh-and-retry loop), so the message renders here.
 *
 * @module features/auth/components
 */
import { useMemo, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useChangePasswordMutation } from '../hooks/use-change-password-mutation';
import { useSession } from '../../../shared/auth/use-session';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useMessages } from '../../../shared/i18n';
import {
  createChangePasswordFormSchema,
  type ChangePasswordFormValues,
} from './change-password-form.schema';

interface ChangePasswordFormProps {
  /** Where to go once the password is replaced. Already validated by the caller. */
  nextPath: string;
}

const DEFAULT_VALUES: ChangePasswordFormValues = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

export function ChangePasswordForm({ nextPath }: ChangePasswordFormProps): ReactElement {
  const mutation = useChangePasswordMutation();
  const auth = useMessages('auth');
  const copy = auth.changePassword;
  const schema = useMemo(() => createChangePasswordFormSchema(auth.validation), [auth]);
  const { clearSession } = useSession();
  const navigate = useNavigate();
  const form = useForm<ChangePasswordFormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(schema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  const handleSignOut = async (): Promise<void> => {
    await clearSession();
    void navigate('/login', { replace: true });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      form.reset();
      void navigate(nextPath, { replace: true });
    } catch {
      // mutation.error displayed below
    }
  });

  return (
    <form className="form-card guest-form" noValidate onSubmit={(event) => void onSubmit(event)}>
      <Alert tone="info" title={copy.introTitle}>
        {copy.intro}
      </Alert>
      {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
      {mutation.error ? (
        <Alert tone="error" title={copy.failed}>
          {mutation.error.message}
        </Alert>
      ) : null}

      <FormField
        label={copy.currentPassword}
        name="currentPassword"
        error={form.formState.errors.currentPassword?.message}
      >
        <Input
          {...form.register('currentPassword')}
          type="password"
          autoComplete="current-password"
          invalid={Boolean(form.formState.errors.currentPassword)}
        />
      </FormField>

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
        <Button type="button" tone="secondary" onClick={() => void handleSignOut()}>
          {copy.signOut}
        </Button>
      </div>
    </form>
  );
}
