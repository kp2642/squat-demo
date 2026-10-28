import Link from 'next/link';
import { Messages } from '../messages';
import { login } from './actions';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const { error, notice, email = '', next = '/app' } = await searchParams;
  return (
    <main className="narrow">
      <h1>로그인</h1>
      <form action={login} className="card">
        <Messages error={error} notice={notice} />
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email">이메일</label>
        <input id="email" name="email" type="email" autoComplete="email" defaultValue={email} required />
        <label htmlFor="password">비밀번호</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <button className="full">로그인</button>
      </form>
      <p className="muted">
        처음이세요? <Link href="/signup">사업장 만들기</Link>
        <br />
        직원은 관리자가 보낸 초대 링크로 가입해요.
      </p>
    </main>
  );
}
