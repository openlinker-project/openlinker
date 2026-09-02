/**
 * Automation Delegate Resolver Service Interface (#2361)
 *
 * The contract every executor reaches a sibling context's shipped service
 * through. Declared as an interface so the executors depend on the seam rather
 * than on the `ModuleRef`-and-lazy-`require` mechanics behind it — which is also
 * what lets a unit spec substitute a plain object instead of booting a container.
 *
 * @module libs/core/src/automation/application/interfaces
 */

/** The sibling barrel an automation executor may reach, and the token it wants. */
export interface AutomationDelegateRef {
  /** Package specifier, e.g. `@openlinker/core/orders`. */
  readonly barrel: string;
  /** Exported Symbol-token name on that barrel. */
  readonly tokenName: string;
}

export interface IAutomationDelegateResolverService {
  /**
   * Resolve a sibling service, or `null` when it is not bound in this process.
   *
   * `null` is a normal, expected answer rather than an error — `MAILER_TOKEN` is
   * bound only in `apps/api` today, and automation fires from the worker. The
   * CALLER turns that absence into an operator-facing `failed` step naming the
   * missing binding; this seam never decides what an absence means.
   */
  resolve<T>(ref: AutomationDelegateRef): T | null;
}
