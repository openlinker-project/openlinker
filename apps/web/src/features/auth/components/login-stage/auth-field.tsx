/**
 * Auth Field
 *
 * One login-stage field: a label row (with an optional aside such as a hint
 * or the forgot-password link), the control, and an error row whose height is
 * ALWAYS reserved, so an error appearing never moves anything below it (#4029).
 *
 * @module features/auth/components/login-stage
 */
import { AnimatePresence, motion } from 'motion/react';
import type { ReactElement, ReactNode } from 'react';

export interface AuthFieldControlProps {
  id: string;
  invalid: boolean;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

interface AuthFieldProps {
  id: string;
  label: string;
  aside?: ReactNode;
  error?: string;
  children: (control: AuthFieldControlProps) => ReactElement;
}

export function AuthField({ id, label, aside, error, children }: AuthFieldProps): ReactElement {
  const errorId = `${id}-error`;
  const control = children({
    id,
    invalid: Boolean(error),
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? errorId : undefined,
  });
  return (
    <div className="auth-field">
      <div className="auth-field__labels">
        <label htmlFor={id} className="form-field__label">
          {label}
        </label>
        {aside}
      </div>
      {control}
      <div className="auth-field__error">
        <AnimatePresence initial={false}>
          {error ? (
            <motion.p
              key={error}
              id={errorId}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {error}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
