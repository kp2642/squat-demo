#!/usr/bin/env bash
# 데이터 분리·수집 함수 테스트
set -euo pipefail
cd "$(dirname "$0")/.."
exec bash scripts/with-db.sh node --test --test-concurrency=1 'tests/db/*.test.mjs'
