#!/usr/bin/env bash
# Fixture Purity Guard
#
# Asserts that shared-fixture modules stay free of framework imports so
# they can be safely consumed by multiple runtimes (Node + browser via
# Vite). A violation here would quietly pull NestJS or backend-only helpers
# into the web bundle.
#
# Currently guards:
#   - libs/core/src/ai/application/internal/render-template.fixtures.ts
#     (shared between the core render-template.spec.ts and the FE
#     render-template.test.ts — see #341).
#
# Exits non-zero on violation so `pnpm lint` fails.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT_DIR/libs/core/src/ai/application/internal/render-template.fixtures.ts"

if [[ ! -f "$FILE" ]]; then
  echo "fixture-purity: expected $FILE to exist" >&2
  exit 1
fi

# Forbidden import origins. The fixtures file may import only from the
# domain types module inside the same bounded context.
FORBIDDEN_PATTERNS=(
  "from '@nestjs/"
  "from '@openlinker/shared"
  "from 'typeorm"
  "from '@openlinker/integrations"
  "from '@openlinker/api"
)

VIOLATIONS=0
for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  if grep -n "$pattern" "$FILE" >/dev/null 2>&1; then
    echo "fixture-purity: forbidden import '$pattern' found in render-template.fixtures.ts:" >&2
    grep -n "$pattern" "$FILE" >&2
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [[ $VIOLATIONS -gt 0 ]]; then
  echo "fixture-purity: $VIOLATIONS violation(s). Shared fixtures must stay framework-free." >&2
  exit 1
fi

echo "fixture-purity: OK"
