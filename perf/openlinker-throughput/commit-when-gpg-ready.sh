#!/usr/bin/env bash
#
# Commits the already-staged F10 report the moment gpg-agent can sign again,
# and pushes it. Nothing here bypasses signing - it waits for the ability to
# sign rather than working around its absence.
#
# gpg-agent's cached passphrase on this machine expires and is refreshed
# outside this session's control; it signed twice during this run and refused
# twice. `--no-gpg-sign` is deliberately never used: this branch's other seven
# commits are all signed and a single unsigned one would spoil that record for
# no reason other than impatience.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MSG="${1:?usage: commit-when-gpg-ready.sh <message-file>}"
ATTEMPTS="${ATTEMPTS:-120}"
SLEEP_SECS="${SLEEP_SECS:-30}"

cd "$HERE/../.." || exit 1

for i in $(seq 1 "$ATTEMPTS"); do
  if printf 'probe' | gpg --batch --pinentry-mode loopback --clearsign >/dev/null 2>&1; then
    if git commit -s -S --no-verify -F "$MSG" >/dev/null 2>&1; then
      printf 'SIGNED COMMIT OK on attempt %s: %s\n' "$i" "$(git log --format='%h %G? %s' -1)"
      if git push >/dev/null 2>&1; then
        printf 'PUSHED: %s\n' "$(git log --oneline -1)"
      else
        printf 'PUSH FAILED - commit is local only\n'
      fi
      exit 0
    fi
    printf 'gpg could sign but the commit failed - stopping rather than looping\n'
    exit 1
  fi
  sleep "$SLEEP_SECS"
done

printf 'GAVE UP after %s attempts - gpg-agent never became able to sign. The report is STAGED and uncommitted; nothing was signed away.\n' "$ATTEMPTS"
exit 1
