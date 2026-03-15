import { forwardRef, type ReactElement, type SelectHTMLAttributes } from 'react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { children, className = '', invalid = false, ...props }: SelectProps,
  ref,
): ReactElement {
  const classes = ['control', 'control--select', invalid ? 'control--invalid' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <select ref={ref} className={classes} {...props}>
      {children}
    </select>
  );
});
