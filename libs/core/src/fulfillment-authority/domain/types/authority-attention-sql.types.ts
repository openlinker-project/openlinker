/**
 * The producer-scoped attention write, as one shared statement (#2352)
 *
 * `order_records.omsAttention` and `returns.omsAttention` carry the same shape
 * and need the same forty-line CTE. It lives here, once, because two
 * hand-maintained copies of a statement whose correctness rests on three subtle
 * clauses is precisely the hazard this repo spends whole `check-*-mirror.mjs`
 * scripts on — and a fix applied to one copy and not the other would silently
 * leave one owning row with the defect.
 *
 * **Pure string construction over caller-supplied LITERALS.** No I/O, no
 * framework, no argument mutated — the `engineering-standards.md` pure-rule
 * exception, the same one `applyPricingRule` and `resolveOfferLifecycle` sit
 * under. It builds no value from request data: every interpolated fragment is a
 * compile-time identifier its caller passes, and the three runtime values travel
 * as bound parameters.
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 */

/** The identifiers one owning table contributes to the shared statement. */
export interface AuthorityAttentionUpsertTarget {
  /** Unquoted table name, e.g. `order_records`. A compile-time literal, never request data. */
  readonly table: string;
  /** Unquoted primary-key column the row is addressed by, e.g. `internalOrderId`. */
  readonly idColumn: string;
  /** Alias the UPDATE uses for the target row, e.g. `rec`. */
  readonly alias: string;
}

/**
 * Build the statement that sets — or clears — ONE producer's entry.
 *
 * Bound parameters, in order: `$1` the row id, `$2` the producer, `$3` the
 * proposed entry as a JSON string (`null` to clear), `$4` the ISO instant to
 * stamp when this producer has no entry yet.
 *
 * Four clauses carry the correctness and none is decoration:
 *
 * 1. **`FOR UPDATE` on the reading CTE.** Without it the read is a plain
 *    snapshot read: under READ COMMITTED a peer producer committing between the
 *    snapshot and this statement taking the row lock is re-checked by EPQ
 *    against the WHERE, but `next.value` was already materialised from the STALE
 *    snapshot and is not recomputed — so the write would land, dropping the
 *    peer's entry, and nothing would ever put it back because a producer only
 *    writes when its own answer CHANGES. That is exactly the lost update the
 *    array shape exists to prevent, so the lock is the whole point rather than
 *    defensive garnish. It also blocks-then-follows the update chain, so the
 *    rebuild sees the latest committed version.
 * 2. **`IS DISTINCT FROM $2` / `= $2`** — the removal and the replacement are
 *    both scoped to the calling producer, which is what lets several unrelated
 *    subsystems share one column.
 * 3. **`COALESCE(parts.mine->>'since', $4)`** — an existing entry's instant is
 *    carried forward, so refining a reason inside one episode does not reset the
 *    age an operator is watching.
 * 4. **`jsonb_agg(… ORDER BY …)` + `NULLIF(…, '[]')`** — a deterministic order
 *    and exactly one spelling for "nothing reported", which together make the
 *    `IS DISTINCT FROM` no-op guard exact: re-writing an unchanged state touches
 *    no row and does not bump `updatedAt`. Entry order carries no meaning; it
 *    exists only to make that comparison stable.
 *
 * A row that does not exist yields an empty CTE and therefore a clean zero-row
 * no-op, never a throw.
 */
export function buildAuthorityAttentionUpsertSql(
  target: AuthorityAttentionUpsertTarget
): string {
  const { table, idColumn, alias } = target;
  return `WITH cur AS (
         SELECT "${idColumn}", COALESCE("omsAttention", '[]'::jsonb) AS attention
           FROM "${table}"
          WHERE "${idColumn}" = $1
          FOR UPDATE
       ), parts AS (
         SELECT cur."${idColumn}",
                COALESCE(
                  (SELECT jsonb_agg(e)
                     FROM jsonb_array_elements(cur.attention) e
                    WHERE e->>'producer' IS DISTINCT FROM $2),
                  '[]'::jsonb
                ) AS others,
                (SELECT e
                   FROM jsonb_array_elements(cur.attention) e
                  WHERE e->>'producer' = $2
                  LIMIT 1) AS mine
           FROM cur
       ), next AS (
         SELECT parts."${idColumn}",
                COALESCE(
                  (SELECT jsonb_agg(e ORDER BY e->>'producer')
                     FROM jsonb_array_elements(
                            parts.others ||
                            CASE
                              WHEN $3::jsonb IS NULL THEN '[]'::jsonb
                              ELSE jsonb_build_array(
                                     $3::jsonb ||
                                     jsonb_build_object(
                                       'since',
                                       COALESCE(parts.mine->>'since', $4::text)
                                     )
                                   )
                            END
                          ) e),
                  '[]'::jsonb
                ) AS value
           FROM parts
       )
       UPDATE "${table}" ${alias}
          SET "omsAttention" = NULLIF(next.value, '[]'::jsonb),
              "updatedAt" = now()
         FROM next
        WHERE ${alias}."${idColumn}" = next."${idColumn}"
          AND ${alias}."omsAttention" IS DISTINCT FROM NULLIF(next.value, '[]'::jsonb)`;
}

/**
 * The JSON payload for `$3`, or `null` to clear this producer's entry.
 *
 * Shared with the statement for the same reason the statement is: the two are
 * one contract, and a field added on one side only would be silently dropped.
 * `since` is deliberately NOT set here — it is derived inside the statement,
 * which is the only place that knows whether an episode is already running.
 */
export function buildAuthorityAttentionPayload(
  producer: string,
  entry: { reason: string; detail?: string; subjectRef?: string } | null
): string | null {
  return entry === null
    ? null
    : JSON.stringify({
        producer,
        reason: entry.reason,
        ...(entry.detail === undefined ? {} : { detail: entry.detail }),
        ...(entry.subjectRef === undefined ? {} : { subjectRef: entry.subjectRef }),
      });
}
