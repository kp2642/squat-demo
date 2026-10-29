import type { SupabaseClient } from '@supabase/supabase-js';
import { pgPool, rpcSql } from './server-db';
import { testAuthEnabled } from './test-auth';

// 로그인한 사용자 권한으로 DB 함수를 부른다. 행 단위 보안이 그대로 적용된다.
// 평소에는 Supabase(사용자 세션), 브라우저 테스트에서는 PostgreSQL 에 직접 붙어 같은 역할·사용자로 실행한다.
export type UserDb = {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
};

export function userDb(supabase: SupabaseClient, userId: string): UserDb {
  if (testAuthEnabled()) {
    return {
      async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
        const { sql, values } = await rpcSql(fn, args);
        const client = await (await pgPool()).connect();
        try {
          await client.query('begin');
          await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
          await client.query('set local role authenticated');
          const { rows } = await client.query(sql, values);
          await client.query('commit');
          return rows[0].result as T;
        } catch (err) {
          await client.query('rollback').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
    };
  }
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw new Error(error.message);
      return data as T;
    },
  };
}
