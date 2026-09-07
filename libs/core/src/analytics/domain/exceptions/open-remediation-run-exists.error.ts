/**
 * Open Remediation Run Exists Error
 *
 * Raised by `AnalyticsRemediationRunRepository.createRun` when a category
 * already holds an `open`/`in-progress` run (#2468). A domain error rather
 * than a leaked `QueryFailedError`, per
 * `docs/engineering-standards.md § Repository Error Handling` — the
 * interfaces layer maps it to HTTP 409.
 *
 * This is a real conflict, not a race to paper over: two overlapping
 * currency restatements would clear and re-enqueue the same orders under two
 * run ids, and the second run's completion poll could resolve while the first
 * still had work in flight.
 *
 * @module libs/core/src/analytics/domain/exceptions
 */
export class OpenRemediationRunExistsError extends Error {
  constructor(public readonly category: string) {
    super(`An open remediation run already exists for category '${category}'`);
    this.name = 'OpenRemediationRunExistsError';
  }
}
