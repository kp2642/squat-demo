#!/usr/bin/env bash
# 마이그레이션을 적용한 PostgreSQL 을 준비하고 DATABASE_URL 을 넘겨 명령을 실행한다.
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
else
  # 주어진 서버에 매번 새 테스트 DB 를 만들고 끝나면 지운다
  BASE_URL="$DATABASE_URL"
  DB_NAME="adtrack_test_$$_$RANDOM"
  psql "$BASE_URL" -q -c "create database $DB_NAME"
  trap 'psql "$BASE_URL" -q -c "drop database if exists $DB_NAME with (force)"' EXIT
  export DATABASE_URL="${BASE_URL%/*}/$DB_NAME"
fi

psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f tests/db/supabase-shim.sql
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done

"$@"
