import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadPresets } from '@/lib/presets';
import { Messages } from '../messages';
import { WorkspaceFields, type WorkspaceDraft } from '../workspace-fields';
import { createWorkspace } from './actions';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

// 로그인은 했지만 아직 사업장이 없는 사용자 (메일 확인을 거쳐 들어온 경우 등)
export default async function OnboardingPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: member } = await supabase.from('users').select('id').eq('id', user.id).maybeSingle();
  if (member) redirect('/app');

  const meta = user.user_metadata ?? {};
  const draft: WorkspaceDraft = { name: meta.name, ...(meta.pending_workspace ?? {}) };
  const presets = await loadPresets(supabase);
  return (
    <main className="narrow">
      <h1>사업장 만들기</h1>
      <form action={createWorkspace} className="card">
        <Messages error={error} />
        <p className="muted">{user.email} 계정으로 새 사업장을 만들어요. 직원이라면 관리자에게 초대 링크를 받아 주세요.</p>
        <WorkspaceFields presets={presets} draft={draft} />
        <button className="full">사업장 만들기</button>
      </form>
      <form action="/auth/signout" method="post">
        <button className="secondary">다른 계정으로 로그인</button>
      </form>
    </main>
  );
}
