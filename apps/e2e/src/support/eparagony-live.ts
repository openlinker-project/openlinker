/**
 * Live eparagony sandbox helpers (#3912)
 *
 * Credentials come from the environment only (`EPARAGONY_SANDBOX_*`) and are
 * never written to a file. The connection payload mirrors what the guided
 * wizard sends (`toCreateConnectionInput` in
 * `apps/web/src/plugins/eparagony/components/eparagony-setup.schema.ts`) for a
 * receipts-only connection, so the spec exercises the same create path the UI
 * does.
 *
 * @module support
 */
import pg from 'pg';
import type { ApiClient } from '../api/api-client';
import type { Connection } from '../api/api.types';
import { resolveEnv } from '../config/env';
import { assertSeedableDatabase } from './assert-seedable-database';
import { pollUntil } from './poller';

export interface EparagonySandboxCredentials {
  clientId: string;
  clientSecret: string;
  posId: string;
}

/** `null` when any of the three required variables is missing. */
export function readEparagonySandboxCredentials(): EparagonySandboxCredentials | null {
  const clientId = process.env.EPARAGONY_SANDBOX_CLIENT_ID?.trim();
  const clientSecret = process.env.EPARAGONY_SANDBOX_CLIENT_SECRET?.trim();
  const posId = process.env.EPARAGONY_SANDBOX_POS_ID?.trim();
  if (!clientId || !clientSecret || !posId) return null;
  return { clientId, clientSecret, posId };
}

/** Create a receipts-only sandbox connection the way the setup wizard does. */
export async function createEparagonySandboxConnection(
  api: ApiClient,
  credentials: EparagonySandboxCredentials,
  name: string,
): Promise<Connection> {
  return api.connections.create({
    name,
    platformType: 'eparagony',
    adapterKey: 'eparagony.documents.v3',
    credentials: { clientId: credentials.clientId, clientSecret: credentials.clientSecret },
    config: { environment: 'sandbox', posId: credentials.posId },
    enabledCapabilities: ['Fiscalization'],
  });
}

/** Terminal answers a registration can settle on (`registered` is the success one). */
const TERMINAL_PROGRESS = ['registered', 'rejected', 'in-doubt', 'interrupted'] as const;

/**
 * Ask for a registration, then poll the progress read until it settles.
 * Returns the settled progress; the caller asserts it is `registered`.
 */
export async function registerAndWait(
  api: ApiClient,
  orderId: string,
  connectionId: string,
  timeoutMs = 300_000,
): Promise<string> {
  await api.fiscalRegistrations.register({ orderId, connectionId });
  const settled = await pollUntil(
    () => api.fiscalRegistrations.progress(orderId, connectionId),
    (view) => (TERMINAL_PROGRESS as readonly string[]).includes(view.progress),
    {
      timeoutMs,
      intervalMs: 3_000,
      message: `fiscal registration of ${orderId} to reach a terminal progress`,
    },
  );
  return settled.progress;
}

/** One line of a `fiscalization.register` job payload, as persisted. */
export interface RegisteredPayloadLine {
  name: string;
  quantity: number;
  unitPriceGross: number;
  taxRate: string;
}

/**
 * Read the lines of the `fiscalization.register` job payload for an order.
 *
 * The payload is the only place the composed delivery lines are visible before
 * the printer answers - the registration record carries none of them - so the
 * spec asserts the names and amounts from `sync_jobs.payloadJson` directly.
 */
export async function readRegisterJobLines(orderId: string): Promise<RegisteredPayloadLine[]> {
  assertSeedableDatabase('readRegisterJobLines');
  const client = new pg.Client({ connectionString: resolveEnv().databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ payloadJson: { lines?: RegisteredPayloadLine[] } }>(
      `SELECT "payloadJson" FROM sync_jobs
        WHERE "jobType" = 'fiscalization.register' AND "payloadJson"->>'orderId' = $1
        ORDER BY "createdAt" DESC LIMIT 1`,
      [orderId],
    );
    return result.rows[0]?.payloadJson.lines ?? [];
  } finally {
    await client.end();
  }
}
