import {
  forwardRef,
  useCallback,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
} from 'react';
import { useCopy } from '../i18n/use-copy';
import { interpolate } from '../i18n/interpolate';
import { useFormat } from '../i18n/use-format';
import { uiCopy } from './ui.copy';

export interface FileUploadProps {
  /**
   * Comma-separated list of accepted MIME types (or extensions).
   * Forwarded to the underlying `<input type="file">` `accept` attribute.
   */
  accept: string;
  /**
   * Hard cap in bytes. Files larger than this are rejected client-side
   * with `onError` before `onFileSelected` fires.
   */
  maxBytes: number;
  /**
   * Fired when a file has been picked or dropped and passes the
   * `accept` + `maxBytes` validation. Async handlers are awaited so the
   * caller can keep `busy` true through the upload.
   */
  onFileSelected: (file: File) => void | Promise<void>;
  /**
   * Optional client-side validation feedback hook. Called with a
   * human-readable message when the file fails an inline check.
   */
  onError?: (message: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  busy?: boolean;
  /**
   * Override the visible label text. Defaults to "Drop a file here, or
   * click to choose" (or "Uploading…" while busy, "Release to upload"
   * during drag-over). Callers use this to communicate disabled-cause
   * states like "Maximum N attachments reached".
   */
  label?: string;
  /** Override the default helper line; otherwise renders accepted types + size cap. */
  hint?: string;
  className?: string;
}

/**
 * `FileUpload` — operator-cockpit file picker + drop zone, styled in
 * vanilla CSS via design tokens. One file per call by design; multi-file
 * is the parent component's job (drive a list of uploads via repeated
 * calls).
 *
 * The underlying primitive is a native `<input type="file">` so screen
 * readers and keyboard a11y come for free; the dropzone is a styled
 * `<label>` that triggers the input via association.
 */
export const FileUpload = forwardRef<HTMLInputElement, FileUploadProps>(function FileUpload(
  {
    accept,
    maxBytes,
    onFileSelected,
    onError,
    disabled = false,
    invalid = false,
    busy = false,
    label,
    hint,
    className = '',
  }: FileUploadProps,
  ref,
): ReactElement {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const copy = useCopy(uiCopy).fileUpload;
  const { number } = useFormat();
  const formatBytes = useCallback(
    (bytes: number): string => formatByteSize(bytes, number),
    [number],
  );
  const [isDragOver, setIsDragOver] = useState(false);

  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );

  const validateAndForward = useCallback(
    async (file: File): Promise<void> => {
      if (file.size > maxBytes) {
        onError?.(
          interpolate(copy.tooLarge, { size: formatBytes(file.size), max: formatBytes(maxBytes) }),
        );
        return;
      }
      // The `accept` attribute on the input handles MIME-type filtering at
      // pick time, but drag-and-drop bypasses that — re-check here.
      if (accept && !mimeMatchesAccept(file.type, accept)) {
        onError?.(interpolate(copy.wrongType, { type: file.type, accept }));
        return;
      }
      await onFileSelected(file);
    },
    [accept, maxBytes, onError, onFileSelected, copy, formatBytes],
  );

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      if (!file) return;
      void validateAndForward(file);
      // Allow re-uploading the same file (browsers don't fire change for
      // the same value otherwise).
      event.target.value = '';
    },
    [validateAndForward],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>): void => {
      event.preventDefault();
      setIsDragOver(false);
      if (disabled || busy) return;
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      void validateAndForward(file);
    },
    [disabled, busy, validateAndForward],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLLabelElement>): void => {
      event.preventDefault();
      if (disabled || busy) return;
      setIsDragOver(true);
    },
    [disabled, busy],
  );

  const onDragLeave = useCallback((event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    setIsDragOver(false);
  }, []);

  const classes = [
    'file-upload',
    isDragOver ? 'file-upload--drag-over' : '',
    invalid ? 'file-upload--invalid' : '',
    busy ? 'file-upload--busy' : '',
    disabled ? 'file-upload--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label
      htmlFor={inputId}
      className={classes}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      aria-busy={busy || undefined}
      aria-disabled={disabled || undefined}
    >
      <input
        ref={setRefs}
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled || busy}
        onChange={onChange}
        className="file-upload__input"
      />
      {/* No aria-live on the label — the <label> already exposes
          aria-busy / aria-disabled, and announcing on every drag-over
          would spam screen-reader users. */}
      <span className="file-upload__label">
        {resolveLabel({ busy, isDragOver, label, copy })}
      </span>
      <span className="file-upload__hint">
        {hint ?? interpolate(copy.hint, { accept, max: formatBytes(maxBytes) })}
      </span>
    </label>
  );
});

function resolveLabel({
  busy,
  isDragOver,
  label,
  copy,
}: {
  busy: boolean;
  isDragOver: boolean;
  label: string | undefined;
  copy: { readonly uploading: string; readonly release: string; readonly drop: string };
}): string {
  if (busy) return copy.uploading;
  if (isDragOver) return copy.release;
  if (label) return label;
  return copy.drop;
}

function formatByteSize(
  bytes: number,
  number: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  if (bytes < 1024) return `${number(bytes)} B`;
  if (bytes < 1024 * 1024) return `${number(bytes / 1024, oneDecimal)} KB`;
  return `${number(bytes / (1024 * 1024), oneDecimal)} MB`;
}

/**
 * Match a file's MIME type against the `accept` attribute string.
 * Handles wildcards (`image/*`) and extension-style entries (`.pdf`).
 * Browsers do this for `<input>` clicks; we re-implement for drops.
 */
function mimeMatchesAccept(mimeType: string, accept: string): boolean {
  if (!mimeType) return false;
  const tokens = accept.split(',').map((t) => t.trim().toLowerCase());
  const lowerMime = mimeType.toLowerCase();
  for (const token of tokens) {
    if (!token) continue;
    if (token.startsWith('.')) {
      // Extension match isn't reliable from MIME alone — defer to the
      // browser's own check at click time. For drops, allow through and
      // trust the server-side validator.
      return true;
    }
    if (token.endsWith('/*')) {
      const prefix = token.slice(0, -1); // keep trailing '/'
      if (lowerMime.startsWith(prefix)) return true;
    } else if (token === lowerMime) {
      return true;
    }
  }
  return false;
}
