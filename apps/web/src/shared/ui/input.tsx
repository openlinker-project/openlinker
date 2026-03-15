import { forwardRef, type InputHTMLAttributes, type ReactElement } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = '', invalid = false, ...props }: InputProps,
  ref,
): ReactElement {
  const classes = ['control', invalid ? 'control--invalid' : '', className].filter(Boolean).join(' ');

  return <input ref={ref} className={classes} {...props} />;
});
