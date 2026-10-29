import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 로그인 없이 들어오는 요청(추적 코드)이 부르는 DB 함수 호출.
// DATABASE_URL 이 있으면 PostgreSQL 에 직접(로컬·테스트), 없으면 Supabase service_role 키로 부른다.

type Args = Record<string, unknown>;

let pool: import('pg').Pool | null = null;
let admin: SupabaseClient | null = null;

export async function pgPool() {
  if (!pool) {
    const pg = await import('pg');
    pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return pool;
}

// select public.fn(a => $1, b => $2) 꼴의 호출문과 값
export function rpcSql(fn: string, args: Args): { sql: string; values: unknown[] } {
  if (!/^[a-z_]+$/.test(fn)) throw new Error(`잘못된 함수 이름: ${fn}`);
  const names = Object.keys(args).filter((n) => args[n] !== undefined);
  if (names.some((n) => !/^p_[a-z0-9_]+$/.test(n))) throw new Error(`잘못된 인자 이름: ${names}`);
  return {
    sql: `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as result`,
    values: names.map((n) => {
      const v = args[n];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    }),
  };
}

export async function rpc<T = unknown>(fn: string, args: Args): Promise<T> {
  if (process.env.DATABASE_URL) {
    const { sql, values } = rpcSql(fn, args);
    const { rows } = await (await pgPool()).query(sql, values);
    return rows[0].result as T;
  }

  if (!admin) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 가 필요해요');
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
  }
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
