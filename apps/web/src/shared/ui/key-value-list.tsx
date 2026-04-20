import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

export interface KeyValueItem {
  key: string;
  label: ReactNode;
  mono?: boolean;
  value: ReactNode;
}

interface KeyValueListProps extends ComponentPropsWithoutRef<'dl'> {
  items: KeyValueItem[];
}

export const KeyValueList = forwardRef<HTMLDListElement, KeyValueListProps>(function KeyValueList(
  { items, className = '', ...props },
  ref,
) {
  const classes = ['key-value-list', className].filter(Boolean).join(' ');

  return (
    <dl ref={ref} className={classes} {...props}>
      {items.map((item) => (
        <div key={item.key} className="key-value-list__row">
          <dt className="key-value-list__label">{item.label}</dt>
          <dd
            className={
              item.mono
                ? 'key-value-list__value key-value-list__value--mono mono-text'
                : 'key-value-list__value'
            }
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
});
