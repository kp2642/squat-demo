import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

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

// 로그인했고 사업장에 속한 사용자. 아니면 로그인·사업장 만들기 화면으로 보낸다.
export async function requireMember() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: member } = await supabase
    .from('users')
    .select('id, email, name, role')
    .eq('id', user.id)
    .maybeSingle<Member>();
  if (!member) redirect('/onboarding');

  const { data: workspace } = await supabase.from('workspaces').select('*').single<Workspace>();
  if (!workspace) redirect('/onboarding');

  return { supabase, user, member, workspace };
}

export async function requireAdmin() {
  const ctx = await requireMember();
  if (ctx.member.role !== 'admin') redirect('/app/inquiries');
  return ctx;
}
