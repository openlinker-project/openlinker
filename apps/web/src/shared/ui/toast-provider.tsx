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
  showToast: (options: ShowToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// In vitest happy-dom runs, Radix's auto-dismiss setTimeout can outlive the
// test if the toast is still mounted at teardown. Test env caps duration at
// the max int32 (~24.8 days) — the largest value Node's setTimeout accepts
// without coercion. Combined with `afterEach(cleanup)` in `test/setup.ts`,
// this guarantees neither the duration timer nor Radix's announce timer
// (`@radix-ui/react-toast/dist/index.mjs:477`) leaks past a test file.
// Production / dev behaviour is unchanged at the configured `durationMs`.
const IS_TEST_ENV = import.meta.env.MODE === 'test';
const TEST_ENV_DURATION_MS = 2_147_483_647;

export function ToastProvider({ children }: PropsWithChildren): ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ description, durationMs = 4000, title, tone = 'info' }: ShowToastOptions) => {
      const id = nextIdRef.current++;
      const effectiveDurationMs = IS_TEST_ENV ? TEST_ENV_DURATION_MS : durationMs;
      setToasts((current) => [
        ...current,
        { description, durationMs: effectiveDurationMs, id, title, tone },
      ]);
    },
    [],
  );

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {/* swipeDirection assumes LTR. Revisit when/if OpenLinker ships an RTL locale. */}
      <RadixToast.Provider swipeDirection="right">
        {children}
        {toasts.map((toast) => (
          <RadixToast.Root
            key={toast.id}
            className={`toast toast--${toast.tone}`}
            duration={toast.durationMs}
            onOpenChange={(open) => {
              if (!open) removeToast(toast.id);
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
