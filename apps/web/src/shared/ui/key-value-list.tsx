import { forwardRef, Fragment, type ComponentPropsWithoutRef, type ReactNode } from 'react';

export interface KeyValueItem {
  id: string;
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
        <Fragment key={item.id}>
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
        </Fragment>
      ))}
    </dl>
  );
});
