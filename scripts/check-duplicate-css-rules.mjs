#!/usr/bin/env node
/**
 * Duplicate CSS Rule Guard
 *
 * Fails if apps/web/src/index.css contains two top-level blocks (rule or
 * at-rule) whose selector/prelude and body are textually identical after
 * stripping comments and collapsing whitespace.
 *
 * Why: merges of parallel UI branches left whole families of pm-* / bf-* /
 * bpick-* rules pasted twice (411 exact copies). A later identical copy
 * re-asserts everything the earlier one declared, so the earlier one is dead
 * weight that still has to be read, diffed and kept consistent.
 *
 * Deliberately limited to EXACT duplicates at top level: the same selector
 * appearing twice with different declarations is a legitimate cascade layering
 * and is not reported.
 *
 * Run with --self-check to exercise the scanner on synthetic sources.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/web/src/index.css');

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}
const norm = (s) => stripComments(s).replace(/\s+/g, ' ').replace(/ ?([{};:,]) ?/g, '$1').trim();

/** Top-level blocks as {prelude, body, line}; comments and strings are skipped. */
export function topBlocks(src) {
  const blocks = [];
  let depth = 0;
  let preStart = 0;
  let bodyStart = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      i = j < 0 ? src.length : j + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '{') {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        blocks.push({
          prelude: src.slice(preStart, bodyStart),
          body: src.slice(bodyStart, i + 1),
          line: src.slice(0, bodyStart).split('\n').length,
        });
        preStart = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      preStart = i + 1;
    }
    i++;
  }
  return blocks;
}

export function findDuplicates(src) {
  const seen = new Map();
  const dups = [];
  for (const b of topBlocks(src)) {
    const key = `${norm(b.prelude)}|${norm(b.body)}`;
    if (seen.has(key)) dups.push({ selector: norm(b.prelude), first: seen.get(key), second: b.line });
    else seen.set(key, b.line);
  }
  return dups;
}

if (process.argv.includes('--self-check')) {
  const a = '.a{color:red}\n.b{color:blue}\n.a { color : red }\n';
  const c = '.a{color:red}\n.a{color:blue}\n/* x */ @media (min-width:1px){.a{color:red}}\n';
  if (findDuplicates(a).length !== 1) throw new Error('self-check: exact dup not found');
  if (findDuplicates(c).length !== 0) throw new Error('self-check: false positive');
  console.log('✓ check-duplicate-css-rules self-check');
  process.exit(0);
}

const src = readFileSync(FILE, 'utf8');
if (topBlocks(src).length === 0) {
  console.error('check-duplicate-css-rules: no blocks parsed from index.css (empty corpus)');
  process.exit(1);
}
const dups = findDuplicates(src);
if (dups.length > 0) {
  console.error(`✗ ${dups.length} exact duplicate top-level CSS block(s) in apps/web/src/index.css:`);
  for (const d of dups.slice(0, 30)) console.error(`  line ${d.second} repeats line ${d.first}: ${d.selector.slice(0, 80)}`);
  console.error('Remove the earlier copy; an identical later copy already carries every declaration.');
  process.exit(1);
}
console.log('✓ check-duplicate-css-rules: no exact duplicate top-level blocks in index.css');
