import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of the input value that only updates
 * after the specified delay has elapsed without changes.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(value); }, delayMs);
    return () => { clearTimeout(timer); };
  }, [value, delayMs]);

  return debounced;
}
