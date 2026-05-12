/**
 * StructuredErrorList
 *
 * Domain-agnostic primitive for rendering structured `{ field?, code, message }`
 * error rows. Marketplace-specific copy lives in feature-layer translators
 * (e.g. `features/allegro/lib/translate-allegro-error.ts`) and is passed in
 * via the optional `translate` prop — the primitive itself never references
 * Allegro, PrestaShop, or any other platform by name (#607).
 *
 * Visual model: forensic operator log.
 *   - Single 6 px severity dot per row (subtle red), not a full red wash —
 *     a publish failure context already implies error; flooding the panel
 *     with status-error-soft makes 1 error look like 5.
 *   - Field paths render as a breadcrumb chain (`offer › modules › productSafety
 *     › … › responsibleProducer`). Internal segments dimmed; the terminal
 *     segment (the actual offending field) is foreground weight. Click-to-
 *     copy on the trail since operators paste paths into platform docs.
 *   - Code chips use `<code>` semantics — small, mono, tinted — so operators
 *     can grep them without eye-fighting the prose.
 *   - When a translation is returned, the friendly message renders in primary
 *     text and the platform's original `message` is kept collapsed in
 *     `<details>`. When no translator is passed (or it returns `null`), the
 *     raw message renders verbatim with no disclosure block.
 *
 * @module apps/web/src/shared/ui
 */
import { useCallback, useState, type ReactElement } from 'react';

export interface StructuredError {
  field?: string;
  code: string;
  message: string;
}

export interface StructuredErrorTranslation {
  message: string;
}

export interface StructuredErrorListProps {
  errors: StructuredError[] | null | undefined;
  translate?: (error: StructuredError) => StructuredErrorTranslation | null;
  className?: string;
}

export function StructuredErrorList({
  errors,
  translate,
  className = '',
}: StructuredErrorListProps): ReactElement | null {
  if (!errors || errors.length === 0) {
    return null;
  }

  const classes = ['structured-error-list', className].filter(Boolean).join(' ');

  return (
    <ul className={classes} aria-label="Errors">
      {errors.map((error, index) => (
        <StructuredErrorRow
          key={`${error.code}-${error.field ?? 'no-field'}-${index}`}
          error={error}
          translate={translate}
        />
      ))}
    </ul>
  );
}

interface StructuredErrorRowProps {
  error: StructuredError;
  translate?: (error: StructuredError) => StructuredErrorTranslation | null;
}

function StructuredErrorRow({ error, translate }: StructuredErrorRowProps): ReactElement {
  const translation = translate?.(error) ?? null;
  const primaryMessage = translation?.message ?? error.message;

  return (
    <li className="structured-error-list__item">
      <span className="structured-error-list__dot" aria-hidden="true" />
      <div className="structured-error-list__body">
        {error.field ? <FieldBreadcrumb path={error.field} /> : null}
        <span className="structured-error-list__message">{primaryMessage}</span>
        {translation ? (
          <details className="structured-error-list__raw">
            <summary>Original message</summary>
            <span className="structured-error-list__raw-body">{error.message}</span>
          </details>
        ) : null}
      </div>
      {/* `<code>` not `<kbd>`: this is program-output text, not user
          keyboard input. Visual treatment in CSS (kbd-like chip) is fine;
          semantics must follow the meaning per frontend.md §Accessibility. */}
      <code className="structured-error-list__code mono-text" title={error.code}>
        {error.code}
      </code>
    </li>
  );
}

/**
 * Renders a dotted path as a breadcrumb chain with click-to-copy.
 *
 *   offer › modules › productSafety › data › productsData[0] › **responsibleProducer**
 *
 * Internal segments dim; terminal segment is at-foreground weight so the
 * actionable leaf is the visual anchor. The whole trail is one button so a
 * single click copies the full dotted path — operators commonly paste this
 * into platform docs / search.
 */
function FieldBreadcrumb({ path }: { path: string }): ReactElement {
  const segments = path.split('.').filter((s) => s.length > 0);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(path).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [path]);

  // Pathological inputs — empty string, or the literal "null" some platforms
  // emit when an error has no field anchor. Render nothing so callers can
  // pass `path` unconditionally without sentinel branching.
  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'null')) {
    return <span />;
  }

  if (segments.length === 1) {
    return (
      <button
        type="button"
        className="structured-error-list__field structured-error-list__field--single mono-text"
        onClick={handleCopy}
        aria-label={copied ? `Copied ${path}` : `Copy field path ${path}`}
      >
        {segments[0]}
        {copied ? <span className="structured-error-list__copied">copied</span> : null}
      </button>
    );
  }

  const trail = segments.slice(0, -1);
  const leaf = segments[segments.length - 1];

  return (
    <button
      type="button"
      className="structured-error-list__field mono-text"
      onClick={handleCopy}
      aria-label={copied ? `Copied ${path}` : `Copy field path ${path}`}
    >
      {trail.map((seg, i) => (
        <span key={i} className="structured-error-list__field-trail">
          {seg}
          <span className="structured-error-list__field-sep" aria-hidden="true">
            {'›'}
          </span>
        </span>
      ))}
      <span className="structured-error-list__field-leaf">{leaf}</span>
      {copied ? <span className="structured-error-list__copied">copied</span> : null}
    </button>
  );
}
