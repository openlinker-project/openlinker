/**
 * Capture Allegro category-parameters response (dev tool)
 *
 * Bootstraps the Nest application context, resolves the Allegro
 * `OfferManager` adapter for the given connection, and dumps the raw
 * `/sale/categories/{id}/parameters` response to disk. Used to capture
 * fixtures for the mapper / adapter specs (#410).
 *
 * Usage:
 *   pnpm --filter @openlinker/api allegro:capture-cat-params \
 *     <connectionId> <categoryId> [outputPath]
 *
 * If `outputPath` is omitted, the script writes to the conventional fixture
 * path:
 *   libs/integrations/allegro/src/infrastructure/adapters/__fixtures__/category-parameters-{categoryId}.json
 *
 * The `OL_FIXTURE_OUT_PATH` env var overrides everything. Useful when pnpm's
 * arg-forwarding eats the third positional argument in some workspace
 * configurations.
 *
 * @module apps/api/scripts
 */
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { INTEGRATIONS_SERVICE_TOKEN, type IIntegrationsService } from '@openlinker/core/integrations';
import type { OfferManagerPort } from '@openlinker/core/listings';
import { AppModule } from '../src/app.module';

interface AllegroLikeAdapter extends OfferManagerPort {
  fetchCategoryParametersRaw?: (categoryId: string) => Promise<unknown>;
}

// Worktree root resolved from this script's location: apps/api/scripts/<this>
// → ../../.. takes us to the repo root regardless of where pnpm sets cwd.
const WORKTREE_ROOT = resolve(__dirname, '..', '..', '..');
const DEFAULT_FIXTURE_DIR =
  'libs/integrations/allegro/src/infrastructure/adapters/__fixtures__';

async function main(): Promise<void> {
  const [, , connectionId, categoryId, outputPathArg] = process.argv;

  if (!connectionId || !categoryId) {
    process.stderr.write(
      'Usage: capture-allegro-cat-params <connectionId> <categoryId> [outputPath]\n',
    );
    process.exit(1);
  }

  // Resolve the output path with this priority: env var > positional arg >
  // conventional fixture path. Relative paths resolve against the worktree
  // root (not pnpm's cwd, which is apps/api when invoked via pnpm --filter).
  const envPath = process.env.OL_FIXTURE_OUT_PATH;
  const rawOutputPath =
    envPath ?? outputPathArg ?? `${DEFAULT_FIXTURE_DIR}/category-parameters-${categoryId}.json`;
  const resolvedOutputPath = resolve(WORKTREE_ROOT, rawOutputPath);

  // Bootstrap Nest with logs muted — our own progress lines go to stderr.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    process.stderr.write(`> Resolving OfferManager adapter for connection ${connectionId}…\n`);
    const integrationsService = app.get<IIntegrationsService>(INTEGRATIONS_SERVICE_TOKEN);
    const adapter = (await integrationsService.getCapabilityAdapter(
      connectionId,
      'OfferManager',
    )) as AllegroLikeAdapter;

    if (typeof adapter.fetchCategoryParametersRaw !== 'function') {
      process.stderr.write(
        `! Adapter for connection ${connectionId} does not expose fetchCategoryParametersRaw — only the Allegro adapter implements this dev hook.\n`,
      );
      process.exit(2);
    }

    process.stderr.write(`> Fetching /sale/categories/${categoryId}/parameters…\n`);
    const raw = await adapter.fetchCategoryParametersRaw(categoryId);
    const json = JSON.stringify(raw, null, 2);

    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, json + '\n', 'utf8');
    process.stderr.write(
      `> Wrote ${json.length.toLocaleString()} bytes to ${resolvedOutputPath}\n`,
    );
    reportShape(raw);
  } finally {
    await app.close();
  }
}

/**
 * Quick scout output: how many parameters the response contains, and whether
 * any dictionary entry carries `dependsOnParameterValueIds` (the marker that
 * makes a category a useful "cascading dictionary" fixture).
 */
function reportShape(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || !('parameters' in raw)) {
    process.stderr.write('! Response did not contain a `parameters` array.\n');
    return;
  }
  const params = (raw as { parameters: unknown[] }).parameters;
  if (!Array.isArray(params)) {
    process.stderr.write('! `parameters` is not an array.\n');
    return;
  }

  let entryFilterCount = 0;
  let paramVisibilityCount = 0;
  let dictionaryEntries = 0;
  for (const p of params) {
    if (!p || typeof p !== 'object') continue;
    const op = p as Record<string, unknown>;
    const options = (op.options ?? null) as Record<string, unknown> | null;
    if (options && typeof options.dependsOnParameterId === 'string') {
      paramVisibilityCount += 1;
    }
    const dict = Array.isArray(op.dictionary) ? (op.dictionary as Array<Record<string, unknown>>) : [];
    dictionaryEntries += dict.length;
    for (const entry of dict) {
      if (Array.isArray(entry.dependsOnValueIds) && entry.dependsOnValueIds.length > 0) {
        entryFilterCount += 1;
      }
    }
  }

  process.stderr.write(
    `> Shape: ${params.length} parameters, ${dictionaryEntries.toLocaleString()} dictionary entries, ` +
      `${paramVisibilityCount} parameter-level dependsOnParameterId, ` +
      `${entryFilterCount.toLocaleString()} entries with dependsOnValueIds.\n`,
  );

  if (entryFilterCount > 0) {
    process.stderr.write(
      '> ✅ This category has dictionary-entry filtering — good candidate for the cascading fixture.\n',
    );
  } else {
    process.stderr.write(
      '> ⚠ This category has no dictionary-entry filtering. Try another category if you need the cascading fixture.\n',
    );
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`! Capture failed: ${message}\n`);
  process.exit(1);
});
