import { forwardRef, type ButtonHTMLAttributes, type ReactElement } from 'react';

export type ButtonTone = 'danger' | 'ghost' | 'primary' | 'secondary';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className = '', tone = 'primary', type = 'button', ...props }: ButtonProps,
  ref,
): ReactElement {
  const classes = ['button', `button--${tone}`, className].filter(Boolean).join(' ');

  return <button ref={ref} type={type} className={classes} {...props} />;
});
