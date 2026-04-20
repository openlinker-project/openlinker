import * as RadixToast from '@radix-ui/react-toast';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import type { AlertTone } from './alert';

interface Toast {
  description: string;
  durationMs: number;
  id: number;
  open: boolean;
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

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, open: false } : t)));
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ description, durationMs = 4000, title, tone = 'info' }: ShowToastOptions) => {
      const id = nextIdRef.current++;
      setToasts((current) => [...current, { description, durationMs, id, open: true, title, tone }]);
    },
    [],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ dismissToast, showToast }),
    [dismissToast, showToast],
  );

  return (
    <ToastContext.Provider value={value}>
      <RadixToast.Provider swipeDirection="right">
        {children}
        {toasts.map((toast) => (
          <RadixToast.Root
            key={toast.id}
            className={`toast toast--${toast.tone}`}
            open={toast.open}
            duration={toast.durationMs}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) {
                removeToast(toast.id);
              }
            }}
          >
            <div className="toast__content">
              {toast.title ? (
                <RadixToast.Title className="toast__title">{toast.title}</RadixToast.Title>
              ) : null}
              <RadixToast.Description className="toast__description">
                {toast.description}
              </RadixToast.Description>
            </div>
            <RadixToast.Close
              aria-label={`Dismiss ${toast.title ?? 'notification'}`}
              className="toast__dismiss"
            >
              Dismiss
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="toast-region" />
      </RadixToast.Provider>
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
