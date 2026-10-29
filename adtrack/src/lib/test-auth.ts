import { createHmac, timingSafeEqual } from 'node:crypto';

// 브라우저 테스트 전용 로그인. Supabase Auth 없이 로컬 PostgreSQL 로 화면을 확인할 때만 쓴다.
// ADTRACK_TEST_AUTH_SECRET 과 DATABASE_URL 이 모두 있어야 켜지고, Vercel 에서는 절대 켜지지 않는다.
export const TEST_AUTH_COOKIE = 'adtrack_test_user';

export function testAuthEnabled(): boolean {
  return Boolean(process.env.ADTRACK_TEST_AUTH_SECRET && process.env.DATABASE_URL && !process.env.VERCEL);
}

function sign(userId: string): string {
  return createHmac('sha256', process.env.ADTRACK_TEST_AUTH_SECRET!).update(userId).digest('base64url');
}

// 쿠키 값: <user id>.<서명>
export function testAuthCookieValue(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

export function testAuthUserId(cookieValue: string | undefined): string | null {
  if (!testAuthEnabled() || !cookieValue) return null;
  const [userId, signature] = cookieValue.split('.');
  if (!userId || !signature) return null;
  const expected = Buffer.from(sign(userId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null;
}
