#!/usr/bin/env bash
#
# Sync shared types into vtex-io-adapter
#
# Source of truth: packages/shared/types/*.ts
# Target: packages/vtex-io-adapter/node/types/shared.ts
#
# Run: npm run sync-types (from repo root)
# Runs automatically before: vtex link

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SHARED_DIR="$ROOT_DIR/packages/shared/types"
TARGET="$ROOT_DIR/packages/vtex-io-adapter/node/types/shared.ts"

# Verify source exists
if [ ! -d "$SHARED_DIR" ]; then
  echo "ERROR: shared types directory not found at $SHARED_DIR"
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"

# Build the merged file
cat > "$TARGET" << 'HEADER'
/**
 * Shared ACG Types
 *
 * AUTO-GENERATED — DO NOT EDIT MANUALLY
 * Source of truth: packages/shared/types/
 * Run "npm run sync-types" to regenerate.
 */

HEADER

# Concatenate each source file, stripping imports between them
for file in product.ts cart.ts intelligence.ts checkout.ts; do
  src="$SHARED_DIR/$file"
  if [ ! -f "$src" ]; then
    echo "WARNING: $src not found, skipping"
    continue
  fi
  echo "// ─── from $file ───" >> "$TARGET"
  echo "" >> "$TARGET"
  # Strip lines that import from sibling files (e.g. import { X } from './product')
  grep -v "^import.*from '\.\/" "$src" >> "$TARGET"
  echo "" >> "$TARGET"
done

echo "Synced shared types → $TARGET"
