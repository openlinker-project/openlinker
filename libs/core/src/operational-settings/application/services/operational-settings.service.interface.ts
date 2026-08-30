/**
 * Operational Settings Service Interface
 *
 * The cross-context contract for the operator-settable sweep budgets and
 * deletion-audit cadence (#2651). The worker's sweep handlers and
 * `SchedulerService` consume this - never `OperationalSettingsRepositoryPort`,
 * which is an intra-context contract.
 *
 * @module libs/core/src/operational-settings/application/services
 */
import type {
  OperationalSettingsInput,
  OperationalSettingsView,
} from '../../domain/types/operational-settings.types';

export interface IOperationalSettingsService {
  /**
   * Every effective value, each with the rung that produced it.
   *
   * Called PER TICK by the worker, never cached at boot: a value that needs a
   * restart to take effect is barely better than the env var it replaces
   * (#2651). The cost is one singleton-row primary-key lookup, the same
   * through-the-DB read `MultiProviderAiCompletionAdapter` makes on every
   * completion.
   */
  resolve(): Promise<OperationalSettingsView>;

  /**
   * Validate and persist a partial update.
   *
   * An omitted field is left alone; an explicit `null` clears it back to the
   * env-or-default rung. Throws `InvalidOperationalSettingError` on an
   * out-of-range number or an unusable cadence - bounds are enforced HERE, not
   * only in a DTO, because the browser is not the only way in.
   */
  updateSettings(input: OperationalSettingsInput, updatedBy: string | null): Promise<void>;
}
