import type { ReactElement } from 'react';
import { useReleaseStepObserver } from '../hooks/use-release-step-observer';

/** Renders nothing; mounts the step completion observer (#4146). */
export function ReleaseStepObserver(): ReactElement | null {
  useReleaseStepObserver();
  return null;
}
