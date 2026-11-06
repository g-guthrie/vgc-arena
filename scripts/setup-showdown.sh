#!/usr/bin/env bash
# Fetch and build the pinned Pokemon Showdown simulator. Results are only
# comparable across runs that use the same commit, so change it deliberately.
set -euo pipefail
SHOWDOWN_COMMIT="${SHOWDOWN_COMMIT:-567c1cedddeaa2f35576005d3bfd526cf4f8a13e}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor/pokemon-showdown"
if [ ! -d "$DIR/.git" ]; then
  git clone https://github.com/smogon/pokemon-showdown.git "$DIR"
fi
cd "$DIR"
git fetch --depth 1 origin "$SHOWDOWN_COMMIT" 2>/dev/null || git fetch origin
git checkout -q "$SHOWDOWN_COMMIT"
npm install --omit=optional --no-audit --no-fund
node build
echo "Showdown $(git rev-parse --short HEAD) built."
