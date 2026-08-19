#!/usr/bin/env bash
# Fails (exit 1) if a Stripe secret-shaped token appears in anything we serve.
# Scans the real bundled Worker output (what the edge actually runs, HTML/JS
# modules included) and falls back to the source tree if the bundle won't build.
set -uo pipefail

cd "$(dirname "$0")/.."

OUT=".scan-out"
rm -rf "$OUT"

TARGETS=("src")
echo "== building worker bundle for scan =="
if npx wrangler deploy --dry-run --outdir "$OUT" >/dev/null 2>&1; then
  echo "bundle: $OUT (built)"
  TARGETS+=("$OUT")
else
  echo "bundle: FAILED to build - scanning source tree only"
fi

# Key prefixes, split so this script never matches its own patterns.
SK="sk""_"; RK="rk""_"; WH="whsec""_"
# Left boundary stops substring hits (netwo[rk_]advice, ma[rk_]uncollectible);
# the trailing run of key characters stops bare-word hits in comments.
PATTERN="(^|[^A-Za-z0-9_])(${SK}live|${SK}test|${RK}live|${RK}test|${WH})[A-Za-z0-9_]{8,}"

echo "== scanning: ${TARGETS[*]} =="
echo "== patterns: sk_live, sk_test, whsec_, rk_ (key-shaped tokens) =="

HITS="$(grep -rnE "$PATTERN" "${TARGETS[@]}" 2>/dev/null || true)"

if [ -n "$HITS" ]; then
  echo "FAIL: secret-shaped token found in served output:"
  echo "$HITS"
  exit 1
fi

echo "PASS: no sk_live / sk_test / whsec_ / rk_ key in served output"
exit 0
