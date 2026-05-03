#!/bin/sh
# PrestaShop dev container entrypoint wrapper (#525).
#
# Auto-runs every *.sh in /tmp/post-install-scripts/ once the upstream
# auto-installer finishes — eliminating the manual `pnpm dev:stack:seed-prestashop`
# step that #156 + #521 each had to work around.
#
# Install-complete marker: absence of /var/www/html/install/. PrestaShop's
# installer removes that directory at the end of the install sequence
# (canonical PS security best-practice; leaving the install dir reachable
# on a deployed shop is a known footgun, so the installer self-deletes).
# More reliable than `parameters.php` (PS 9.x doesn't ship that file at the
# legacy path) or `.env` (the installer creates it *during* install, not at
# the end).
#
# Pattern: background-poll + exec upstream CMD. Same shape WordPress, Drupal,
# and Bitnami PrestaShop's official Docker images use — keeps Apache as PID 1
# so signal handling (`docker compose stop`) routes upstream natively.
# See https://github.com/docker-library/wordpress/blob/master/latest/apache/docker-entrypoint.sh
# for the canonical reference implementation.
#
# Bounded polling: aborts with a loud error after MAX_WAIT_SECONDS (default
# 300s ≈ install takes 2-3min in practice, 5x headroom). Prevents stuck
# containers when upstream install genuinely fails. Override via the
# PS_POST_INSTALL_MAX_WAIT_SECONDS env var.
#
# This wrapper does NOT replace `pnpm dev:stack:seed-prestashop`: that
# command stays as the force-reseed affordance for operators who want to
# re-run the scripts mid-development without restarting the container.
#
# Cosmetic note: the background subshell exits cleanly after running the
# scripts and shows up as `<defunct>` in `ps` until the container is
# restarted. No resource leak; not worth pulling in `tini` for a dev
# container. (Postgres / WordPress / MySQL official images skip `tini`
# for the same reason.)
set -e

MAX_WAIT_SECONDS=${PS_POST_INSTALL_MAX_WAIT_SECONDS:-300}
SCRIPT_DIR=/tmp/post-install-scripts

# Background subshell: poll for install completion, then run the scripts.
# Runs as a child of PID 1 (apache).
(
  # Phase 1: wait for the upstream image to populate the volume + trigger
  # the installer (install/ appears, OR .env appears in the warm-boot case
  # where the volume is already initialised). Bounded by 60s — generous for
  # a fresh-volume copy; on warm boot, .env is already there and the loop
  # falls through immediately. Without this phase, a fresh-volume cold start
  # races: the wrapper sees an empty /var/www/html/, concludes (incorrectly)
  # that the install is complete, and runs the post-install scripts against
  # an unbootstrapped shop.
  echo '* [ps-post-install] waiting for PS image to populate the volume...'
  waited=0
  while [ ! -d /var/www/html/install ] && [ ! -f /var/www/html/.env ]; do
    if [ "$waited" -ge 60 ]; then
      echo '* [ps-post-install] phase 1 timed out at 60s — proceeding to phase 2 anyway' >&2
      break
    fi
    sleep 2
    waited=$((waited + 2))
  done

  # Phase 2: wait for the installer to finish (install/ removed). Bounded
  # by MAX_WAIT_SECONDS to prevent stuck containers when upstream install
  # genuinely fails.
  echo '* [ps-post-install] waiting for PS auto-install to complete...'
  waited=0
  while [ -d /var/www/html/install ]; do
    if [ "$waited" -ge "$MAX_WAIT_SECONDS" ]; then
      echo "* [ps-post-install] FATAL: install/ still present after ${MAX_WAIT_SECONDS}s — aborting (post-install scripts will NOT run; check upstream install logs)" >&2
      exit 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  echo "* [ps-post-install] install complete (waited ${waited}s)"

  # Brief settle: PS removes install/ before the Symfony cache layer is
  # fully warm. 5s is enough for the warmup to converge in practice;
  # avoids a class of "Cache::clean() during warmup" errors when the
  # post-install scripts call ObjectModel APIs immediately after.
  sleep 5

  echo '* [ps-post-install] running post-install scripts...'
  for f in "$SCRIPT_DIR"/*.sh; do
    [ -f "$f" ] || continue
    echo "* [ps-post-install] --- $(basename "$f") ---"
    if ! sh "$f"; then
      echo "* [ps-post-install] $(basename "$f") exited non-zero — aborting chain" >&2
      exit 1
    fi
  done
  echo '* [ps-post-install] post-install scripts complete.'
) &

# Hand off to apache as PID 1 (matches upstream behaviour: docker-php-entrypoint
# is a 7-line shim whose only purpose is rewriting `-XYZ`-style args into
# `apache2-foreground -XYZ` — we're calling apache directly, so the shim is
# a no-op we can skip).
exec apache2-foreground
