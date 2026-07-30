/**
 * Proof-screenshot helper for the preflight-divergence suite
 *
 * The specs in this directory are characterization tests: each pins one place
 * where the bulk offer wizard reports a row as READY and the backend then
 * refuses it. `captureProof` writes the two frames that make that contradiction
 * legible in an issue / PR - the Review step that promised, and the 400 banner /
 * failed batch row that followed - next to this file.
 *
 * Contract:
 *   - it NEVER throws and never fails a spec. Every capture is best-effort: a
 *     missing locator, a navigation error or a filesystem problem is swallowed
 *     and reported as `null`, because a capture is documentation, not an
 *     assertion.
 *   - it writes `<name>.png` into this directory, so the filename IS the
 *     convention: `fNN-before-review-ready.png` / `fNN-before-result.png` while
 *     the divergence exists, `-after-` once it is fixed and the same specs are
 *     re-run.
 *   - dependency-free (Playwright + node stdlib only) and it touches nothing
 *     outside `tests/preflight-divergence/`.
 *
 * @module tests/preflight-divergence/__proof__
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';

/** Directory this file lives in - every proof image is written beside it. */
const PROOF_DIR = dirname(fileURLToPath(import.meta.url));

/** How long to wait for a requested region to become visible before falling back. */
const REGION_TIMEOUT_MS = 10_000;

export interface CaptureProofOptions {
  /**
   * Frame this element instead of the viewport (a CSS selector or a Locator).
   * A tight region keeps the decisive text - the readiness counts, the CTA
   * label, the error code - legible at issue-embed width. When the region is
   * missing or invisible the capture silently falls back to the viewport.
   */
  region?: Locator | string;
  /**
   * Work to do inside the same guarded block right before the shot (navigate to
   * the batch page, expand a failure-details panel, scroll something into
   * view). A throw here aborts the capture, never the spec.
   */
  prepare?: () => Promise<void>;
  /** Capture the whole scrollable page rather than the viewport. Ignored when `region` is set. */
  fullPage?: boolean;
}

/**
 * Write one proof screenshot. Returns the file path, or `null` when nothing
 * could be captured (the reason is printed as a warning).
 *
 * @param page  the live page
 * @param name  file stem, e.g. `f01-before-review-ready` (no extension)
 */
export async function captureProof(
  page: Page,
  name: string,
  options: CaptureProofOptions = {},
): Promise<string | null> {
  const path = join(PROOF_DIR, `${name}.png`);
  try {
    if (options.prepare !== undefined) {
      await options.prepare();
    }

    const region = resolveRegion(page, options.region);
    if (region !== null) {
      const target = region.first();
      const visible = await target
        .waitFor({ state: 'visible', timeout: REGION_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (visible) {
        await target.screenshot({ path, timeout: 30_000 });
        return path;
      }
    }

    await page.screenshot({ path, fullPage: options.fullPage ?? false, timeout: 30_000 });
    return path;
  } catch (error) {
    console.warn(`[proof] could not capture "${name}": ${describe(error)}`);
    return null;
  }
}

/**
 * The Review step's decisive region: the header (with the `Create offers (N)`
 * CTA), the `N ready · M need attention · K excluded` summary, and the row
 * table - i.e. everything the operator reads before committing. Resolved as the
 * summary's parent because the step has no single root class.
 */
export function reviewRegion(page: Page): Locator {
  return page.locator('.bulk-review__summary').locator('..');
}

function resolveRegion(page: Page, region: Locator | string | undefined): Locator | null {
  if (region === undefined) return null;
  return typeof region === 'string' ? page.locator(region) : region;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}
