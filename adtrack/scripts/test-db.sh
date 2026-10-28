#!/usr/bin/env bash
# 데이터 분리 자동 테스트.
# DATABASE_URL 이 있으면 그 DB 를 쓰고(CI), 없으면 임시 PostgreSQL 을 띄웠다가 지운다.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${DATABASE_URL:-}" ]]; then
  PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  [[ -x "$PG_BIN/initdb" ]] || { echo "PostgreSQL 이 없어요. DATABASE_URL 을 지정하거나 PG_BIN 을 설정하세요." >&2; exit 1; }
  TMP="$(mktemp -d)"
  RUN_AS=()
  if [[ "$(id -u)" == 0 ]]; then
    chown -R postgres "$TMP"
    RUN_AS=(runuser -u postgres --)
  fi
  PORT="${PGPORT_TEST:-55432}"
  "${RUN_AS[@]}" "$PG_BIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
  "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=localhost" -l "$TMP/log" -w start >/dev/null
  trap '"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null; rm -rf "$TMP"' EXIT
  export DATABASE_URL="postgres://postgres@localhost:$PORT/postgres"
fi

psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f tests/db/supabase-shim.sql
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done

node --test 'tests/db/*.test.mjs'
