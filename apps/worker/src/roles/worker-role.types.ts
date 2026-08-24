/**
 * Worker Role Types
 *
 * The worker process's role vocabulary (#2279, ADR-051): which of the four
 * responsibilities a booted worker carries. Roles select MODULE IMPORTS at
 * bootstrap (`AppModule.forRoles`), never runtime flags on an already-booted
 * graph — a role that is off contributes no providers, no consumers, and no
 * timers at all.
 *
 * @module apps/worker/src/roles
 */

export const WorkerRoleValues = ['jobs', 'events', 'scheduler', 'maintenance'] as const;
export type WorkerRole = (typeof WorkerRoleValues)[number];

/**
 * Resolve `OL_WORKER_ROLE` into the role set to boot with.
 *
 * Accepts `all` (the default when unset/empty) or a comma-separated subset,
 * case-insensitive, e.g. `jobs`, `jobs,events`, `scheduler,maintenance`.
 *
 * An unknown role name THROWS rather than being skipped: in a split
 * deployment a typo (`scheduIer`) would otherwise boot a worker that silently
 * carries nothing, and the missing responsibility would surface only as
 * drifting cron output hours later.
 */
export function resolveWorkerRoles(raw: string | undefined): readonly WorkerRole[] {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'all') {
    return WorkerRoleValues;
  }

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return WorkerRoleValues;
  }

  const roles: WorkerRole[] = [];
  for (const part of parts) {
    if (!(WorkerRoleValues as readonly string[]).includes(part)) {
      throw new Error(
        `Unknown worker role '${part}' in OL_WORKER_ROLE — valid roles: ${WorkerRoleValues.join(', ')}, or 'all'`
      );
    }
    if (!roles.includes(part as WorkerRole)) {
      roles.push(part as WorkerRole);
    }
  }
  return roles;
}
