import { forwardRef, type ReactElement, type TextareaHTMLAttributes } from 'react';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className = '', invalid = false, ...props }: TextareaProps,
  ref,
): ReactElement {
  const classes = ['control', invalid ? 'control--invalid' : '', className].filter(Boolean).join(' ');

  return <textarea ref={ref} className={classes} {...props} />;
});
