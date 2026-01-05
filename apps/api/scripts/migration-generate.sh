#!/bin/bash
# Wrapper script for TypeORM migration:generate
# Filters out -- separator and passes remaining arguments to TypeORM CLI

# Set NODE_OPTIONS for TypeScript support
export NODE_OPTIONS='-r ts-node/register -r tsconfig-paths/register'

# Filter out -- separator if present
args=()
for arg in "$@"; do
  if [ "$arg" != "--" ]; then
    args+=("$arg")
  fi
done

# Run TypeORM CLI with filtered arguments
exec node_modules/.bin/typeorm migration:generate -d src/database/data-source.ts "${args[@]}"






