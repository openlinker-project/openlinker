/**
 * Recording Popover
 *
 * "What we record" opens as a popover above the sentence instead of an
 * expanding block, so opening it never pushes the layout (#4029).
 *
 * @module features/auth/components/login-stage
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { LOGIN_STAGE_EASE } from './login-stage-motion';

interface RecordingPopoverProps {
  label: string;
  items: string[];
}

export function RecordingPopover({ label, items }: RecordingPopoverProps): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref}>
      <button
        type="button"
        className="auth-card__linkish"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            id={popId}
            className="auth-card__popover"
            role="dialog"
            aria-label={label}
            initial={{ opacity: 0, scale: 0.97, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: LOGIN_STAGE_EASE }}
          >
            <strong>{label}</strong>
            <ul>
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
