#!/usr/bin/env bash
# deploy/air-fallback.sh — air 맥 fallback 가드 (T9)
#
# Pro 다운 시에만 서버를 띄운다. PRO_HEALTH_URL 이 설정돼 있으면 Pro 를 먼저
# 헬스체크해 살아있으면 기동을 거부(이중 writer 방지).
#
# 환경변수:
#   PRO_HEALTH_URL  — Pro 서버 health URL
#                     예) http://<pro-tailscale-ip>:7080/api/health
#                         https://pro-macname.tailnet.ts.net/api/health
#   VAULT_DIR       — brain 경로 (plist 에서 주입)
#   PORT            — 서버 포트 (기본 7080)
#
# 호출: launchd 가 이 스크립트를 직접 실행한다 (com.goodsoob.memory.air.plist).

set -uo pipefail
# ⚠️ -e 미사용: curl 헬스체크 실패(exit 7·22 등)를 오류가 아닌 정상 분기로 다뤄야 한다.

LOG_PREFIX="[air-fallback $(date '+%Y-%m-%d %H:%M:%S')]"

# ── Step 1: Pro 헬스체크 ───────────────────────────────────────────────────────
if [[ -n "${PRO_HEALTH_URL:-}" ]]; then
  echo "$LOG_PREFIX PRO_HEALTH_URL=$PRO_HEALTH_URL — Pro 헬스체크 시작"
  if curl --max-time 3 -fsS "$PRO_HEALTH_URL" > /dev/null 2>&1; then
    echo "$LOG_PREFIX Pro alive at $PRO_HEALTH_URL — air fallback 거부 (이중 writer 방지)"
    exit 0
  else
    echo "$LOG_PREFIX Pro 응답 없음(다운 또는 도달 불가) — air fallback 기동 진행"
  fi
else
  echo "$LOG_PREFIX ⚠️  PRO_HEALTH_URL 미설정 — 헬스체크 없이 기동(수동 fallback 가정)"
fi

# ── Step 2: 서버 기동 ─────────────────────────────────────────────────────────
# Pro plist(com.goodsoob.memory.plist)와 동일한 bun 절대경로·인자 사용.
BUN=/opt/homebrew/bin/bun
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$SCRIPT_DIR/server/index.ts"

echo "$LOG_PREFIX 서버 기동: $BUN $SERVER (VAULT_DIR=${VAULT_DIR:-미설정})"
exec "$BUN" "$SERVER"
