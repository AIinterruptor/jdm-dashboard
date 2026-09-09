#!/usr/bin/env bash
# Deploy the dashboard to Cloudflare Pages (project: state-of-the-nationph, https://state-of-the-nationph.pages.dev)
# Usage:  CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... scripts/deploy-pages.sh
# Builds a clean upload directory (index.html, config/, _headers) so worker source, docs and scratch files
# are never published, then does a wrangler direct upload. No build step — index.html is deployed as-is.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${TMPDIR:-/tmp}/jdm-pages-dist"
rm -rf "$DIST" && mkdir -p "$DIST/config"
cp "$ROOT/index.html" "$DIST/"
cp "$ROOT/_headers" "$DIST/"
# Link-preview image. Facebook/Twitter fetch this by absolute URL, so it must be
# published at the site root or the preview card renders with no image.
cp "$ROOT/og-image.png" "$DIST/"
# Service worker. MUST be served from the site root as a real same-origin
# file: browsers refuse to register one from a blob: URL, and its scope
# cannot be broader than its own path.
cp "$ROOT/sw.js" "$DIST/"
cp "$ROOT/config/"*.js "$DIST/config/"
VERSION="$(grep -o 'COMMAND CENTER v[0-9.]*</title>' "$ROOT/index.html" | grep -o 'v[0-9.]*')"
echo "Deploying $VERSION from $DIST"
npx wrangler pages deploy "$DIST" --project-name state-of-the-nationph --branch main --commit-dirty=true --commit-message "deploy $VERSION"
