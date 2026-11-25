/**
 * Step copy lookup (#4147)
 *
 * Step sentences live under `steps.<id>.*` in the release-center namespace and
 * are addressed by a catalog id that is plain data, so the lookup is by string.
 * A step without copy falls back to its id rather than rendering nothing.
 *
 * @module features/release-center/components
 */
import { useMessages } from '../../../shared/i18n';

interface StepCopy {
  title: string;
  why: string;
}

export function useStepCopy(): (stepId: string) => StepCopy {
  const steps = useMessages('release-center').steps as unknown as Record<
    string,
    Partial<StepCopy> | undefined
  >;
  return (stepId) => ({ title: steps[stepId]?.title ?? stepId, why: steps[stepId]?.why ?? '' });
}
