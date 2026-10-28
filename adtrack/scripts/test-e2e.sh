#!/usr/bin/env bash
# 추적 코드 브라우저 테스트: 테스트용 홈페이지 3종 × 꼬리표 7가지
# 서비스는 빌드된 상태여야 한다 (npm run build).
set -euo pipefail
cd "$(dirname "$0")/.."
exec bash scripts/with-db.sh node --test --test-concurrency=1 'tests/e2e/*.test.mjs'
