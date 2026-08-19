#!/usr/bin/env node
/**
 * NUL-Byte Guard (#1902 / PR #2137 B1 follow-up)
 *
 * Fails `pnpm lint` if any tracked TEXT source file contains a literal `0x00`
 * byte.
 *
 * Why this exists: `document-token.policy.ts` shipped three raw NUL bytes inside
 * a template literal (they were meant to be `\0` escapes). Git classifies a file
 * containing a NUL as binary, so it renders as `Bin 0 -> 2999 bytes` on GitHub -
 * no diff, no reviewable lines, and no way to resolve a merge conflict in it.
 * The file in question derives the vendor idempotency key that stands between a
 * retried fiscal-registration POST and a second real registration: precisely the
 * kind of file a reviewer must be able to read. The escape and the raw byte emit
 * identical bytes at runtime, so there is never a reason to prefer the raw form.
 *
 * Scope: tracked files whose extension is in {@link TEXT_EXTENSIONS}. Genuinely
 * binary assets (images, fonts, archives) are out of scope by construction
 * rather than by allowlist, since they are never matched in the first place.
 *
 * Run with `--self-check` to exercise the pure scanner against synthetic
 * buffers, so a refactor of the detection itself cannot silently pass.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain.
 *
 * @module scripts
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Extensions treated as text. A NUL byte in any of these is a defect; anything
 * not listed is not inspected at all.
 */
const TEXT_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'md',
  'mdx',
  'yml',
  'yaml',
  'css',
  'scss',
  'html',
  'sql',
  'sh',
  'php',
  'cs',
  'csproj',
  'xml',
  'xsd',
  'env',
  'txt',
];

/** Read at most this many files concurrently, to bound open descriptors. */
const READ_CONCURRENCY = 32;

/**
 * Byte offsets of every `0x00` in a buffer. Pure - the whole detection lives
 * here so `--self-check` can exercise it without touching the filesystem.
 */
export function findNulOffsets(buffer) {
  const offsets = [];
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0) {
      offsets.push(i);
    }
  }
  return offsets;
}

/**
 * 1-based line number of a byte offset, for an actionable error line. Counts
 * `\n` only: a NUL-bearing file is not reliably decodable, and this is a
 * locator, not a renderer.
 */
export function lineOfOffset(buffer, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < buffer.length; i += 1) {
    if (buffer[i] === 0x0a) {
      line += 1;
    }
  }
  return line;
}

async function trackedTextFiles() {
  const patterns = TEXT_EXTENSIONS.map((ext) => `*.${ext}`);
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', ...patterns], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split('\0').filter((entry) => entry.length > 0);
}

async function main() {
  const files = await trackedTextFiles();
  const violations = [];

  for (let start = 0; start < files.length; start += READ_CONCURRENCY) {
    const batch = files.slice(start, start + READ_CONCURRENCY);
    await Promise.all(
      batch.map(async (file) => {
        let buffer;
        try {
          buffer = await readFile(resolve(ROOT, file));
        } catch {
          // A tracked-but-absent path (mid-rebase, sparse checkout) is not this
          // guard's business.
          return;
        }
        const offsets = findNulOffsets(buffer);
        if (offsets.length > 0) {
          violations.push({ file, count: offsets.length, line: lineOfOffset(buffer, offsets[0]) });
        }
      })
    );
  }

  if (violations.length > 0) {
    console.error('✗ check-nul-bytes: literal NUL (0x00) bytes found in text source files.\n');
    for (const v of violations.sort((a, b) => a.file.localeCompare(b.file))) {
      console.error(
        `  ${v.file}:${v.line} — ${v.count} NUL byte(s). Write \\0 (or \\u0000) instead; ` +
          `git treats a NUL-bearing file as binary, so it has no reviewable diff.`
      );
    }
    console.error('');
    process.exit(1);
  }

  console.log(`✓ check-nul-bytes: ${files.length} text files carry no literal NUL bytes.`);
}

function selfCheck() {
  const failures = [];
  const expect = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
      failures.push(`  ${label}: expected ${e}, got ${a}`);
    }
  };

  expect('clean buffer → no offsets', findNulOffsets(Buffer.from('const a = 1;\n')), []);
  expect(
    'escaped NUL in source → no offsets',
    // The two-character sequence backslash-zero, i.e. what the fix looks like.
    findNulOffsets(Buffer.from('const sep = "\\0";\n')),
    []
  );
  expect('raw NUL → its offset', findNulOffsets(Buffer.from([0x61, 0x00, 0x62])), [1]);
  expect(
    'several raw NULs → every offset',
    findNulOffsets(Buffer.from([0x00, 0x61, 0x00])),
    [0, 2]
  );
  expect('empty buffer → no offsets', findNulOffsets(Buffer.alloc(0)), []);

  expect('offset on first line → 1', lineOfOffset(Buffer.from([0x00]), 0), 1);
  expect(
    'offset after two newlines → 3',
    lineOfOffset(Buffer.from([0x61, 0x0a, 0x62, 0x0a, 0x00]), 4),
    3
  );

  if (failures.length > 0) {
    console.error('✗ check-nul-bytes --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-nul-bytes --self-check: scanner + locator behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-nul-bytes: fatal error:', err);
    process.exit(1);
  });
}
