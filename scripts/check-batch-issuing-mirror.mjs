#!/usr/bin/env node
/**
 * check-batch-issuing-mirror.mjs
 *
 * Lint-time invariant for the batch-issuing rules the browser mirrors
 * (#3582 / #3583 / #3584). The web bundle cannot import `@openlinker/core`
 * (#591), so three rules exist twice:
 *
 * 1. The trigger-model vocabulary and the precedence-rung names
 *    (`resolveTriggerModelForKind`):
 *      libs/core/src/invoicing/domain/types/invoice-trigger.types.ts
 *        `InvoiceTriggerModelValues`, `TriggerModelSourceValues`
 *      apps/web/src/features/connections/types/invoice-trigger-model.types.ts
 *        `INVOICE_TRIGGER_MODEL_VALUES`
 *      apps/web/src/features/connections/lib/resolve-trigger-model-for-kind.ts
 *        `TRIGGER_MODEL_SOURCE_VALUES`
 *
 * 2. The schedule shape the form writes and the worker reads
 *    (`readBatchSchedule`): the frequencies, the defaults and the `HH:MM`
 *    pattern.
 *      libs/core/src/sales-documents/domain/types/batch-schedule.types.ts
 *      apps/web/src/features/sales-documents/components/batch-schedule.schema.ts
 *
 * A drift here is silent at runtime: a form that accepts a value the worker
 * reads back as its default changes WHEN fiscal documents are issued with no
 * error anywhere. (The server also refuses such a value since the #3583 review
 * fix, but the form is where the operator is told.) The two case tables in the
 * specs pin behaviour; this pins the vocabulary they are written over.
 *
 * Files are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step like its siblings. `--self-check` exercises the
 * parsers against synthetic input.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const CORE_TRIGGER = 'libs/core/src/invoicing/domain/types/invoice-trigger.types.ts';
const WEB_TRIGGER_VALUES = 'apps/web/src/features/connections/types/invoice-trigger-model.types.ts';
const WEB_TRIGGER_RESOLVER = 'apps/web/src/features/connections/lib/resolve-trigger-model-for-kind.ts';
const CORE_SCHEDULE = 'libs/core/src/sales-documents/domain/types/batch-schedule.types.ts';
const WEB_SCHEDULE = 'apps/web/src/features/sales-documents/components/batch-schedule.schema.ts';

/** The string members of `const <name> = [ ... ]` (with or without `as const`). */
export function parseStringArray(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`));
  if (!match) return null;
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** The members of the first `z.enum([ ... ])` that follows `<field>:`. */
export function parseZodEnum(source, field) {
  const match = source.match(new RegExp(`\\b${field}\\s*:\\s*z\\.enum\\(\\s*\\[([^\\]]*)\\]`));
  if (!match) return null;
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** The literal of `const <name> = '...'`. */
export function parseStringConst(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*['"]([^'"]*)['"]`));
  return match ? match[1] : null;
}

/** The source of `const <name> = /.../`. */
export function parseRegexConst(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(/.+/[a-z]*)\\s*;`));
  return match ? match[1] : null;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function selfCheck() {
  const arr = parseStringArray("export const X = ['a', 'b'] as const;", 'X');
  if (!same(arr, ['a', 'b'])) throw new Error(`self-check: array parser -> ${JSON.stringify(arr)}`);
  const zod = parseZodEnum("  frequency: z.enum(['daily', 'month-end']),", 'frequency');
  if (!same(zod, ['daily', 'month-end'])) throw new Error('self-check: zod enum parser');
  if (parseStringConst("export const T = '18:00';", 'T') !== '18:00') {
    throw new Error('self-check: string const parser');
  }
  if (parseRegexConst('const P = /^(a|b)$/;', 'P') !== '/^(a|b)$/') {
    throw new Error('self-check: regex parser');
  }
  if (same(['a'], ['b'])) throw new Error('self-check: drift not detected');
  process.stdout.write('check-batch-issuing-mirror: self-check passed\n');
}

async function read(file) {
  return readFile(join(ROOT, file), 'utf8');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const [coreTrigger, webTriggerValues, webResolver, coreSchedule, webSchedule] = await Promise.all(
    [CORE_TRIGGER, WEB_TRIGGER_VALUES, WEB_TRIGGER_RESOLVER, CORE_SCHEDULE, WEB_SCHEDULE].map(read)
  );

  const pairs = [
    {
      what: 'trigger-model values',
      core: [CORE_TRIGGER, parseStringArray(coreTrigger, 'InvoiceTriggerModelValues')],
      web: [WEB_TRIGGER_VALUES, parseStringArray(webTriggerValues, 'INVOICE_TRIGGER_MODEL_VALUES')],
    },
    {
      what: 'trigger-model precedence rungs',
      core: [CORE_TRIGGER, parseStringArray(coreTrigger, 'TriggerModelSourceValues')],
      web: [WEB_TRIGGER_RESOLVER, parseStringArray(webResolver, 'TRIGGER_MODEL_SOURCE_VALUES')],
    },
    {
      what: 'batch frequencies',
      core: [CORE_SCHEDULE, parseStringArray(coreSchedule, 'BatchFrequencyValues')],
      web: [WEB_SCHEDULE, parseZodEnum(webSchedule, 'frequency')],
    },
    {
      what: 'default batch time zone',
      core: [CORE_SCHEDULE, parseStringConst(coreSchedule, 'DEFAULT_BATCH_TIME_ZONE')],
      web: [WEB_SCHEDULE, parseStringConst(webSchedule, 'DEFAULT_BATCH_TIME_ZONE')],
    },
    {
      what: 'default batch time',
      core: [CORE_SCHEDULE, parseStringConst(coreSchedule, 'DEFAULT_BATCH_TIME')],
      web: [WEB_SCHEDULE, parseStringConst(webSchedule, 'DEFAULT_BATCH_TIME')],
    },
    {
      what: 'HH:MM time pattern',
      core: [CORE_SCHEDULE, parseRegexConst(coreSchedule, 'TIME_PATTERN')],
      web: [WEB_SCHEDULE, parseRegexConst(webSchedule, 'TIME_PATTERN')],
    },
  ];

  let failed = false;
  for (const { what, core, web } of pairs) {
    for (const [file, value] of [core, web]) {
      if (value === null) {
        process.stderr.write(`${file}: could not read the ${what}\n`);
        failed = true;
      }
    }
    if (core[1] !== null && web[1] !== null && !same(core[1], web[1])) {
      process.stderr.write(
        `Batch-issuing mirror drifted (${what}):\n` +
          `  ${core[0]} -> ${JSON.stringify(core[1])}\n` +
          `  ${web[0]} -> ${JSON.stringify(web[1])}\n`
      );
      failed = true;
    }
  }
  if (failed) process.exit(1);

  process.stdout.write(`check-batch-issuing-mirror: ok (${pairs.length} rules in sync)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
