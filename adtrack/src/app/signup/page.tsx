import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { loadPresets } from '@/lib/presets';
import { Messages } from '../messages';
import { WorkspaceFields } from '../workspace-fields';
import { signup } from './actions';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function SignupPage({ searchParams }: Props) {
  const { error, email = '', ...draft } = await searchParams;
  const presets = await loadPresets(await createClient());
  return (
    <main className="narrow">
      <h1>사업장 만들기</h1>
      <form action={signup} className="card">
        <Messages error={error} />
        <label htmlFor="email">이메일</label>
        <input id="email" name="email" type="email" autoComplete="email" defaultValue={email} required />
        <label htmlFor="password">비밀번호 <span className="hint">8자 이상</span></label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        <WorkspaceFields presets={presets} draft={draft} />
        <button className="full">가입하고 시작하기</button>
      </form>
      <p className="muted">
        이미 계정이 있으세요? <Link href="/login">로그인</Link>
      </p>
    </main>
  );
}
