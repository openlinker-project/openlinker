#!/usr/bin/env bash
#
# Watches for a peer writing onto the stand while F10 holds the lock (#2978).
#
# !! THIS DETECTOR IS KNOWN-WRONG AND IS NOT USED BY ANY SCENARIO. !!
#
# It is kept, labelled, rather than deleted, because the way it failed is
# worth more than the check it was trying to make.
#
# It classifies every job row it did not personally mint as foreign. That is
# wrong on a system whose entire job is to enqueue further work in response to
# work: one order on the measured path produces roughly three more jobs -
# `master.inventory.syncByExternalId` against the destination whose stock the
# order consumed, then `inventory.propagateToMarketplaces`, then one
# `marketplace.offerQuantity.update` per marketplace connection. Every one of
# those carries an `inventory:`- or `order:`-prefixed key that this filter
# calls somebody else's.
#
# Run against a completely clean stand it reported "PEER CONTAMINATION" within
# ninety seconds, and an earlier window had already been thrown away on the
# same misreading made by hand. A detector that cannot tell the system's own
# consequences from a third party's writes will cry contamination on a healthy
# run - and will be believed, unless somebody opens its output and traces one
# of the rows back to the order that caused it.
#
# Anything reviving this needs an allow-list built from the CAUSAL keys the
# handlers actually mint (see `inventory-propagate-to-marketplaces.handler.ts`
# and the order-ingestion path), not from a prefix this script happens to use.
#
# This exists because it happened: a peer scenario enqueued
# `inventory.propagateToMarketplaces` fan-out children onto the connection
# under measurement, inside a held window, and was caught only by a "why is
# this queue not draining" look at the job table. The stand lock arbitrates
# scenarios that take it and is blind to one that does not, so the signal has
# to be the rows themselves.
#
# Emits one line per detection and exits when the F10 scenario process is gone,
# so it cannot outlive the run it is watching. It changes nothing - a window it
# flags still has to be discarded by a human decision, because "was this window
# contaminated" is not a question a watcher should answer by itself.
set -euo pipefail

WINDOW_MINUTES="${WINDOW_MINUTES:-2}"
POLL_SECS="${POLL_SECS:-45}"

# Keys this run mints itself. Anything else appearing on the stand during a
# held window is somebody else's.
OWN_PREFIXES="marketplace:%|f10:%"

peer_rows() {
  docker exec -i lab-postgres psql -U postgres -d openlinker -qtAX -c \
    "SELECT COUNT(*) FROM sync_jobs
     WHERE \"createdAt\" > NOW() - interval '${WINDOW_MINUTES} minutes'
       AND \"idempotencyKey\" NOT LIKE 'marketplace:%'
       AND \"idempotencyKey\" NOT LIKE 'f10:%'" 2>/dev/null | tr -d '[:space:]'
}

while true; do
  if ! pgrep -f 'f10-dependency-failure.sh' >/dev/null 2>&1; then
    printf 'F10 scenario process is gone - contamination watch ending at %s\n' "$(date -u +%H:%M:%SZ)"
    exit 0
  fi
  n="$(peer_rows || printf '')"
  case "${n:-}" in
    ''|0) : ;;
    *) printf 'PEER CONTAMINATION at %s: %s job row(s) not minted by this run were created on the stand in the last %s minutes\n' \
         "$(date -u +%H:%M:%SZ)" "$n" "$WINDOW_MINUTES" ;;
  esac
  sleep "$POLL_SECS"
done
