import {
  forwardRef,
  useCallback,
  useId,
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
    const bodyId = useId();

    const formatted = useMemo(() => formatPayload(payload), [payload]);
    const isJson = useMemo(() => payloadIsJson(payload), [payload]);
    const tinted = useMemo(
      () => (isJson ? tintJson(formatted) : null),
      [formatted, isJson],
    );

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
              aria-controls={bodyId}
            >
              {open ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </header>
        <pre
          id={bodyId}
          className="raw-payload__body mono-text"
          aria-label="Payload content"
          hidden={!open}
        >
          {tinted ?? formatted}
        </pre>
      </section>
    );
  },
);

function payloadIsJson(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null;
}

function formatPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload === null || payload === undefined) return '';
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

const TINT_PATTERN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g;

function tintJson(source: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let keyIndex = 0;

  for (const match of source.matchAll(TINT_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      nodes.push(source.slice(cursor, start));
    }

    const [full, stringPart, colonPart, numberPart, literalPart] = match;

    if (stringPart) {
      if (colonPart) {
        nodes.push(
          <span key={`k-${keyIndex++}`} className="raw-payload__token-key">
            {stringPart}
          </span>,
        );
        nodes.push(colonPart);
      } else {
        nodes.push(
          <span key={`s-${keyIndex++}`} className="raw-payload__token-string">
            {stringPart}
          </span>,
        );
      }
    } else if (numberPart) {
      nodes.push(
        <span key={`n-${keyIndex++}`} className="raw-payload__token-number">
          {numberPart}
        </span>,
      );
    } else if (literalPart) {
      nodes.push(
        <span key={`l-${keyIndex++}`} className="raw-payload__token-literal">
          {literalPart}
        </span>,
      );
    }

    cursor = start + full.length;
  }

  if (cursor < source.length) {
    nodes.push(source.slice(cursor));
  }

  return nodes;
}
