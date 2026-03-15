import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import type { AlertTone } from './alert';

interface Toast {
  description: string;
  id: number;
  title?: string;
  tone: AlertTone;
}

interface ShowToastOptions {
  description: string;
  durationMs?: number;
  title?: string;
  tone?: AlertTone;
}

interface ToastContextValue {
  dismissToast: (id: number) => void;
  showToast: (options: ShowToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: PropsWithChildren): ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);
  const timeoutIdsRef = useRef<Map<number, number>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const timeoutId = timeoutIdsRef.current.get(id);

    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutIdsRef.current.delete(id);
    }

    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    ({ description, durationMs = 4000, title, tone = 'info' }: ShowToastOptions) => {
      const id = nextIdRef.current++;

      setToasts((currentToasts) => [...currentToasts, { description, id, title, tone }]);

      const timeoutId = window.setTimeout(() => {
        dismissToast(id);
      }, durationMs);

      timeoutIdsRef.current.set(id, timeoutId);
    },
    [dismissToast],
  );

  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current;

    return () => {
      for (const timeoutId of timeoutIds.values()) {
        window.clearTimeout(timeoutId);
      }
      timeoutIds.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      dismissToast,
      showToast,
    }),
    [dismissToast, showToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="toast-region">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`} role="status">
            <div className="toast__content">
              {toast.title ? <strong className="toast__title">{toast.title}</strong> : null}
              <p className="toast__description">{toast.description}</p>
            </div>
            <button
              type="button"
              aria-label={`Dismiss ${toast.title ?? 'notification'}`}
              className="toast__dismiss"
              onClick={() => dismissToast(toast.id)}
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);

  if (context === null) {
    throw new Error('useToast must be used within a ToastProvider');
  }

  return context;
}
