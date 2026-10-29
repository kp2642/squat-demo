import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from './supabase/server';
import { TEST_AUTH_COOKIE, testAuthEnabled, testAuthUserId } from './test-auth';
import { userDb } from './user-db';

export type Role = 'admin' | 'staff';

export type Workspace = {
  id: string;
  name: string;
  industry: string;
  contract_term: string;
  avg_contract_amount: number;
  roas_high: number;
  roas_low: number;
  tracking_key: string;
  thank_you_url: string | null;
};

export type Member = { id: string; email: string; name: string; role: Role };

// 로그인한 사용자 id. 브라우저 테스트에서는 서명된 테스트 쿠키를 쓴다.
export async function currentUserId(supabase: SupabaseClient): Promise<string | null> {
  if (testAuthEnabled()) return testAuthUserId((await cookies()).get(TEST_AUTH_COOKIE)?.value);
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// 로그인했고 사업장에 속한 사용자. 아니면 로그인·사업장 만들기 화면으로 보낸다.
export async function requireMember() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect('/login');

  const db = userDb(supabase, userId);
  const ctx = await db.rpc<{ member: Member; workspace: Workspace } | null>('my_context');
  if (!ctx) redirect('/onboarding');

  return { supabase, db, userId, member: ctx.member, workspace: ctx.workspace };
}

export async function requireAdmin() {
  const ctx = await requireMember();
  if (ctx.member.role !== 'admin') redirect('/app/inquiries');
  return ctx;
}
