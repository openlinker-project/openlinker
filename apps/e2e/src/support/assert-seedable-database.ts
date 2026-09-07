/**
 * Seed-target guard (#2809 review)
 *
 * The sales-document seeds issue unconditional `DELETE`s against
 * `E2E_DATABASE_URL`, which **defaults** to a real local Postgres
 * (`postgres://postgres:postgres@localhost:5432/openlinker`, `config/env.ts`).
 * Every delete is id-scoped and parameterized, so the blast radius is the
 * suite's own fixture rows — but nothing stopped that URL from being pointed
 * at a shared or production database by an env var, and a destructive write is
 * exactly the shape the package already gates behind an opt-in
 * (`E2E_ALLOW_DESTRUCTIVE_PRUNE`, `api/prestashop-webservice.ts`).
 *
 * The rule: a host that is unmistakably a disposable stack (loopback, or a
 * container-network service name) is allowed on its own; anything else needs
 * the same explicit opt-in the PrestaShop prune uses. An unparseable URL is
 * REFUSED rather than allowed — a guard that fails open is not a guard.
 *
 * @module src/support
 */
import { resolveEnv } from '../config/env';

/** Hosts that cannot be anything but a throwaway stack. */
const DISPOSABLE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db']);

export function assertSeedableDatabase(seedName: string): void {
  const env = resolveEnv();
  if (env.allowDestructivePrune) return;

  let host: string;
  try {
    host = new URL(env.databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error(
      `[${seedName}] E2E_DATABASE_URL is not a parseable URL, so this seed cannot confirm it is ` +
        `pointing at a disposable stack. Refusing to run destructive fixture writes. ` +
        `Set E2E_ALLOW_DESTRUCTIVE_PRUNE=true to override.`,
    );
  }

  if (!DISPOSABLE_HOSTS.has(host)) {
    throw new Error(
      `[${seedName}] E2E_DATABASE_URL points at host "${host}", which is not recognised as a ` +
        `disposable test stack. This seed DELETEs its fixture rows before writing them. ` +
        `Set E2E_ALLOW_DESTRUCTIVE_PRUNE=true if that database really is expendable.`,
    );
  }
}
