import {
  forwardRef,
  useCallback,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';

interface RawPayloadPanelProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  defaultOpen?: boolean;
  description?: ReactNode;
  payload: unknown;
  title?: ReactNode;
}

export const RawPayloadPanel = forwardRef<HTMLElement, RawPayloadPanelProps>(
  function RawPayloadPanel(
    { defaultOpen = false, description, payload, title = 'Payload', className = '', ...props },
    ref,
  ) {
    const [open, setOpen] = useState(defaultOpen);
    const [copied, setCopied] = useState(false);

    const formatted = useMemo(() => formatPayload(payload), [payload]);

    const handleCopy = useCallback(() => {
      void navigator.clipboard?.writeText(formatted).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      });
    }, [formatted]);

    const classes = ['raw-payload', open ? 'raw-payload--open' : '', className]
      .filter(Boolean)
      .join(' ');

    return (
      <section ref={ref} className={classes} {...props}>
        <header className="raw-payload__header">
          <div className="raw-payload__heading">
            <strong className="raw-payload__title">{title}</strong>
            {description ? <span className="raw-payload__description">{description}</span> : null}
          </div>
          <div className="raw-payload__actions">
            <button
              type="button"
              className="raw-payload__action"
              onClick={handleCopy}
              aria-label={copied ? 'Copied payload' : 'Copy payload'}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="raw-payload__action"
              onClick={() => setOpen((prev) => !prev)}
              aria-expanded={open}
            >
              {open ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </header>
        {open ? (
          <pre className="raw-payload__body mono-text" aria-label="Payload content">
            {formatted}
          </pre>
        ) : null}
      </section>
    );
  },
);

function formatPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload === null || payload === undefined) return '';
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}
