import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Messages } from '../../messages';
import { acceptInvite, signupFromInvite } from './actions';

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

type Invitation = { workspace_name: string; email: string; role: 'admin' | 'staff'; expired: boolean; accepted: boolean };

export default async function InvitePage({ params, searchParams }: Props) {
  const { token } = await params;
  const { error, notice, name = '' } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_invitation', { p_token: token });
  const invite = (data as Invitation[] | null)?.[0];
  const { data: { user } } = await supabase.auth.getUser();

  if (!invite || invite.expired || invite.accepted) {
    return (
      <main className="narrow">
        <h1>초대 링크</h1>
        <div className="card">
          <p>{!invite ? '초대를 찾을 수 없어요.' : invite.accepted ? '이미 사용된 초대예요.' : '만료된 초대예요.'} 관리자에게 새 초대 링크를 요청해 주세요.</p>
          {user && <Link href="/app">내 화면으로</Link>}
        </div>
      </main>
    );
  }

  const roleName = invite.role === 'admin' ? '관리자' : '직원';
  const self = `/invite/${token}`;
  return (
    <main className="narrow">
      <h1>{invite.workspace_name}</h1>
      <p className="muted">{invite.email} 님을 {roleName}(으)로 초대했어요.</p>
      <div className="card">
        <Messages error={error} notice={notice} />
        {user && user.email?.toLowerCase() === invite.email ? (
          <form action={acceptInvite}>
            <input type="hidden" name="token" value={token} />
            <label htmlFor="name">내 이름</label>
            <input id="name" name="name" defaultValue={user.user_metadata?.name ?? ''} maxLength={50} />
            <button className="full">초대 수락하기</button>
          </form>
        ) : user ? (
          <>
            <p>지금 {user.email} 계정으로 로그인되어 있어요. 초대받은 {invite.email} 계정으로 다시 로그인해 주세요.</p>
            <form action={`/auth/signout?next=${encodeURIComponent(self)}`} method="post">
              <button className="full">로그아웃</button>
            </form>
          </>
        ) : (
          <>
            <form action={signupFromInvite}>
              <input type="hidden" name="token" value={token} />
              <label htmlFor="email">이메일</label>
              <input id="email" value={invite.email} disabled />
              <label htmlFor="name">내 이름</label>
              <input id="name" name="name" defaultValue={name} autoComplete="name" maxLength={50} required />
              <label htmlFor="password">비밀번호 <span className="hint">8자 이상</span></label>
              <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
              <button className="full">가입하고 참여하기</button>
            </form>
            <p className="muted">
              이미 계정이 있으면{' '}
              <Link href={`/login?${new URLSearchParams({ email: invite.email, next: self })}`}>로그인</Link> 후 수락해 주세요.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
