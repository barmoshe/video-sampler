#!/usr/bin/env bash
# Render whole pack clips (frames only; pack.py muxes them):
#   bash tools/library/render/render.sh OUT_ROOT id [id ...]
# The bb kit is found beside this repo (../bar_builds/.claude/scripts/blender) or at $BB_KIT. EEVEE renders about
# 2 s a frame on an Intel MacBook GPU; keep one batch under ~25 min if a harness stops long jobs.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
KIT="${BB_KIT:-$(cd "$HERE/../../../.." && pwd)/bar_builds/.claude/scripts/blender}"
OUT="$1"; shift
mkdir -p "$OUT"
for id in "$@"; do
  start=$(date +%s)
  if bash "$KIT/run.sh" "$HERE/scene.py" --id "$id" --out "$OUT/$id" > "$OUT/$id.log" 2>&1; then
    echo "ok   $id $(( $(date +%s) - start )) s"
  else
    echo "FAIL $id"; tail -5 "$OUT/$id.log"
  fi
done
