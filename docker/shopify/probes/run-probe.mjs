#!/usr/bin/env node
/**
 * Capability probes for spike #3928
 *
 * Each probe is a small, named, re-runnable experiment against the seeded dev
 * store. Output is the raw request intent plus the response fields that decide
 * the verdict, so it can be pasted into the spike document as a transcript.
 *
 * Usage: node probes/run-probe.mjs <probe-name>   (from docker/shopify, .env loaded)
 *        node probes/run-probe.mjs --list
 */

import { createClient } from '../lib/shopify-client.mjs';
import { probes } from './probes.mjs';

const name = process.argv[2];
if (!name || name === '--list') {
  process.stdout.write(`${Object.keys(probes).join('\n')}\n`);
  process.exit(name ? 0 : 1);
}
const probe = probes[name];
if (!probe) {
  process.stderr.write(`unknown probe "${name}"; --list shows them\n`);
  process.exit(1);
}

const shopify = await createClient();
const log = (label, value) =>
  process.stdout.write(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await probe({ shopify, log, sleep });
} catch (error) {
  process.stderr.write(`probe ${name} threw: ${error.message}\n`);
  process.exit(1);
}
