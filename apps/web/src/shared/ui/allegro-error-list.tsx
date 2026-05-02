/**
 * AllegroErrorList
 *
 * Shared primitive for rendering structured Allegro `{ field?, code, message }`
 * error rows. Used by both the offer-create flow (#448) — wrapped by
 * `OfferCreationErrorList` — and the content-publish flow (#486).
 *
 * Visual model: forensic operator log.
 *   - Single 6 px severity dot per row (subtle red), not a full red wash —
 *     a publish failure context already implies error; flooding the panel
 *     with status-error-soft makes 1 error look like 5.
 *   - Field paths render as a breadcrumb chain (`offer › modules › productSafety
 *     › … › responsibleProducer`). Internal segments dimmed; the terminal
 *     segment (the actual offending field) is foreground weight. Click-to-
 *     copy on the trail since operators paste paths into Allegro docs.
 *   - Code chips use `<kbd>` semantics — small, mono, tinted — so operators
 *     can grep them without eye-fighting the prose.
 *   - Translated messages render the friendly English in primary text and
 *     keep Allegro's original `userMessage` collapsed in `<details>`.
 *
 * @module apps/web/src/shared/ui
 */
import { useCallback, useState, type ReactElement } from 'react';
import {
  translateAllegroError,
  type AllegroLikeError,
} from '../lib/allegro-error-mapping';

interface AllegroErrorListProps {
  errors: AllegroLikeError[] | null | undefined;
  className?: string;
}

export function AllegroErrorList({
  errors,
  className = '',
}: AllegroErrorListProps): ReactElement | null {
  if (!errors || errors.length === 0) {
    return null;
  }

  const classes = ['allegro-error-list', className].filter(Boolean).join(' ');

  return (
    <ul className={classes} aria-label="Allegro errors">
      {errors.map((error, index) => (
        <AllegroErrorRow key={`${error.code}-${error.field ?? 'no-field'}-${index}`} error={error} />
      ))}
    </ul>
  );
}

function AllegroErrorRow({ error }: { error: AllegroLikeError }): ReactElement {
  const translation = translateAllegroError(error);
  const primaryMessage = translation?.message ?? error.message;

  return (
    <li className="allegro-error-list__item">
      <span className="allegro-error-list__dot" aria-hidden="true" />
      <div className="allegro-error-list__body">
        {error.field ? <FieldBreadcrumb path={error.field} /> : null}
        <span className="allegro-error-list__message">{primaryMessage}</span>
        {translation ? (
          <details className="allegro-error-list__raw">
            <summary>Allegro&apos;s original message</summary>
            <span className="allegro-error-list__raw-body">{error.message}</span>
          </details>
        ) : null}
      </div>
      {/* `<code>` not `<kbd>`: this is program-output text, not user
          keyboard input. Visual treatment in CSS (kbd-like chip) is fine;
          semantics must follow the meaning per frontend.md §Accessibility. */}
      <code className="allegro-error-list__code mono-text" title={error.code}>
        {error.code}
      </code>
    </li>
  );
}

/**
 * Renders a dotted Allegro path as a breadcrumb chain with click-to-copy.
 *
 *   offer › modules › productSafety › data › productsData[0] › **responsibleProducer**
 *
 * Internal segments dim; terminal segment is at-foreground weight so the
 * actionable leaf is the visual anchor. The whole trail is one button so a
 * single click copies the full dotted path — operators commonly paste this
 * into Allegro docs / search.
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

  // Pathological inputs — empty string, the literal "null" Allegro emits when
  // an error has no field anchor. Render nothing so callers can pass `path`
  // unconditionally without sentinel branching.
  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'null')) {
    return <span />;
  }

  if (segments.length === 1) {
    return (
      <button
        type="button"
        className="allegro-error-list__field allegro-error-list__field--single mono-text"
        onClick={handleCopy}
        aria-label={copied ? `Copied ${path}` : `Copy field path ${path}`}
      >
        {segments[0]}
        {copied ? <span className="allegro-error-list__copied">copied</span> : null}
      </button>
    );
  }

  const trail = segments.slice(0, -1);
  const leaf = segments[segments.length - 1];

  return (
    <button
      type="button"
      className="allegro-error-list__field mono-text"
      onClick={handleCopy}
      aria-label={copied ? `Copied ${path}` : `Copy field path ${path}`}
    >
      {trail.map((seg, i) => (
        <span key={i} className="allegro-error-list__field-trail">
          {seg}
          <span className="allegro-error-list__field-sep" aria-hidden="true">
            {'›'}
          </span>
        </span>
      ))}
      <span className="allegro-error-list__field-leaf">{leaf}</span>
      {copied ? <span className="allegro-error-list__copied">copied</span> : null}
    </button>
  );
}
