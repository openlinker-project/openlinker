/**
 * Inline the amount + currency on every persisted sales-document rule (#3189)
 *
 * `SalesDocumentCondition`'s `orderTotalGross` arm stopped carrying a
 * `thresholdRef` into `sales_document_thresholds` and now carries its own
 * `amount` (decimal string) + `currency`. This pass rewrites the rows.
 *
 * **Why it cannot be skipped.** `isSalesDocumentCondition` returns `false` for
 * a shape it does not recognise, and every caller reads that as *"this rule
 * never matches"* - no throw, no log, no operator-visible signal. Shipping the
 * new shape without this migration would therefore make every existing
 * threshold rule silently stop matching, and the orders it used to route would
 * start hanging with nothing to explain why. The model and the data move in one
 * release, deliberately.
 *
 * **Which version of a threshold is inlined.** A `ref` may carry several
 * versions (`version_effective_from` / `version_effective_to`) - that
 * independent versioning was the whole point of the indirection ADR-041
 * decision 5 chose and #3189 knowingly reverses. The rule cited "the current
 * threshold", not a particular version, so the version EFFECTIVE AT MIGRATION
 * TIME is the only faithful reading; where no version covers today, the latest
 * by `version_effective_from` is used rather than failing, since a rule
 * pointing at an expired amount was already being evaluated against that row.
 *
 * **An unresolvable ref FAILS the migration**, naming every offending rule.
 * Such a rule could not be evaluated before this change either (the engine's
 * referential-integrity branch made it not match), so nothing is being broken -
 * but inlining is the moment that silence becomes visible, and quietly writing
 * a shape that still never matches would carry the defect forward under a new
 * name. `createRule` validated refs at write time, so this should be
 * unreachable; if it fires, delete or repoint the rules it names and re-run.
 *
 * **The canonicalisation is COPIED, not imported.** `conditions_hash` backs the
 * write-path conflict guard's unique index and must be recomputed here. A
 * migration has to reproduce the hashing rule as it stands AT THE MOMENT IT
 * RUNS; binding it to a live `@openlinker/core` import would silently change
 * what this already-applied migration meant the next time that rule is edited.
 * The copy below must match `canonicalizeSalesDocumentConditions` /
 * `computeSalesDocumentConditionsHash` as of #3189.
 *
 * `down()` is intentionally NOT the inverse. Rebuilding a `thresholdRef` would
 * mean inventing which ref an inline amount "came from", and two rules with the
 * same amount could have cited different refs. It restores nothing and says so.
 *
 * @module apps/api/src/migrations
 */
import { createHash } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';

interface RuleRow {
  id: string;
  conditions: unknown;
  /** Needed for the unique-index pre-check below, not for the rewrite itself. */
  country: string;
  effective_from: string;
}

interface ThresholdRow {
  ref: string;
  amount: string;
  currency: string;
  version_effective_from: string;
  version_effective_to: string | null;
}

/** Copy of `canonicalizeSalesDocumentConditions` as of #3189 - see the module doc. */
function canonicalize(conditions: readonly Record<string, unknown>[]): string {
  const sorted = [...conditions].sort((a, b) => String(a.field).localeCompare(String(b.field)));
  return JSON.stringify(
    sorted.map((condition) => {
      const ordered: Record<string, unknown> = {};
      for (const key of Object.keys(condition).sort()) {
        ordered[key] = condition[key];
      }
      return ordered;
    }),
  );
}

/** Copy of `computeSalesDocumentConditionsHash` as of #3189. */
function hashConditions(conditions: readonly Record<string, unknown>[]): string {
  return createHash('sha256').update(canonicalize(conditions)).digest('hex');
}

/**
 * The threshold version to inline for one ref: the one covering today, else the
 * latest by `version_effective_from`. See the module doc for why.
 */
function pickVersion(rows: readonly ThresholdRow[]): ThresholdRow | undefined {
  const today = new Date().toISOString().slice(0, 10);
  const covering = rows.find(
    (row) =>
      row.version_effective_from <= today &&
      (row.version_effective_to === null || row.version_effective_to >= today),
  );
  if (covering !== undefined) return covering;
  return [...rows].sort((a, b) =>
    a.version_effective_from < b.version_effective_from ? 1 : -1,
  )[0];
}

export class InlineSalesDocumentRuleAmounts1892000000000 implements MigrationInterface {
  name = 'InlineSalesDocumentRuleAmounts1892000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rules = (await queryRunner.query(
      `SELECT "id", "conditions", "country", "effective_from" FROM "sales_document_rules"`,
    )) as RuleRow[];
    if (rules.length === 0) return;

    const thresholds = (await queryRunner.query(
      `SELECT "ref", "amount", "currency", "version_effective_from", "version_effective_to"
         FROM "sales_document_thresholds"`,
    )) as ThresholdRow[];
    const byRef = new Map<string, ThresholdRow[]>();
    for (const row of thresholds) {
      byRef.set(row.ref, [...(byRef.get(row.ref) ?? []), row]);
    }

    const unresolved: string[] = [];
    const updates: {
      id: string;
      conditions: Record<string, unknown>[];
      country: string;
      effectiveFrom: string;
    }[] = [];

    for (const rule of rules) {
      if (!Array.isArray(rule.conditions)) continue;
      const conditions = rule.conditions as Record<string, unknown>[];
      let changed = false;
      const rewritten = conditions.map((condition) => {
        if (condition.field !== 'orderTotalGross' || typeof condition.thresholdRef !== 'string') {
          return condition;
        }
        const version = pickVersion(byRef.get(condition.thresholdRef) ?? []);
        if (version === undefined) {
          unresolved.push(`rule ${rule.id} -> threshold ref '${String(condition.thresholdRef)}'`);
          return condition;
        }
        changed = true;
        return {
          field: 'orderTotalGross',
          op: condition.op,
          // `numeric` comes back from the driver as a string already, which is
          // exactly the shape the new condition stores - no float in between.
          amount: String(version.amount),
          currency: version.currency,
        };
      });
      if (changed) {
        updates.push({
          id: rule.id,
          conditions: rewritten,
          country: rule.country,
          effectiveFrom: String(rule.effective_from),
        });
      }
    }

    // Two rules citing DIFFERENT refs that resolve to the same amount + currency
    // hash identically after the rewrite, and
    // `UQ_sales_document_rules_country_hash_from` refuses the second UPDATE. The
    // transaction rolls back cleanly either way, so this is not about data
    // safety - it is so the operator reads which rules to repoint instead of a
    // raw Postgres 23505 naming an index, the same standard the unresolvable-ref
    // arm below already sets.
    const collisions = new Map<string, string[]>();
    for (const update of updates) {
      const key = `${update.country}|${hashConditions(update.conditions)}|${update.effectiveFrom}`;
      collisions.set(key, [...(collisions.get(key) ?? []), update.id]);
    }
    const collided = [...collisions.entries()].filter(([, ids]) => ids.length > 1);
    if (collided.length > 0) {
      throw new Error(
        `Cannot inline sales-document rule amounts: ${collided.length} group(s) of rules would ` +
          `become identical once their threshold refs resolve to the same amount and currency, ` +
          `and "UQ_sales_document_rules_country_hash_from" forbids that. They cite different ` +
          `refs today but the same figure. Delete or narrow one rule per group, then re-run. ` +
          collided
            .map(([key, ids]) => `[${key.split('|')[0]} @ ${key.split('|')[2]}] ${ids.join(', ')}`)
            .join('; '),
      );
    }

    if (unresolved.length > 0) {
      throw new Error(
        `Cannot inline sales-document rule amounts: ${unresolved.length} condition(s) cite a ` +
          `threshold ref with no row in "sales_document_thresholds". Such a rule already matched ` +
          `nothing before this change. Delete or repoint it, then re-run. ` +
          unresolved.join('; '),
      );
    }

    for (const update of updates) {
      await queryRunner.query(
        `UPDATE "sales_document_rules"
            SET "conditions" = $1::jsonb, "conditions_hash" = $2
          WHERE "id" = $3`,
        [JSON.stringify(update.conditions), hashConditions(update.conditions), update.id],
      );
    }
  }

  // Not `async`: the body only throws, so there is nothing to await and the
  // rejection is raised synchronously by the caller's own `await`.
  public down(): Promise<void> {
    throw new Error(
      'InlineSalesDocumentRuleAmounts1892000000000 is not reversible: rebuilding a thresholdRef ' +
        'would mean inventing which ref an inline amount came from, and two rules carrying the ' +
        'same amount could have cited different refs. Restore from a backup instead.',
    );
  }
}
