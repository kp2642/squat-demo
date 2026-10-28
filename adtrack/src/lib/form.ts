import { redirect } from 'next/navigation';

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

// 오류 메시지를 주소에 실어 같은 화면으로 돌려보낸다.
export function back(path: string, params: Record<string, string>): never {
  const q = new URLSearchParams(params).toString();
  redirect(q ? `${path}${path.includes('?') ? '&' : '?'}${q}` : path);
}

// Supabase 오류를 화면에 보여줄 문장으로
export function errorMessage(err: { message?: string; code?: string } | null): string {
  if (!err) return '알 수 없는 오류가 났어요';
  const m = err.message ?? '';
  if (m.includes('Invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않아요';
  if (m.includes('User already registered')) return '이미 가입된 이메일이에요. 로그인해 주세요';
  if (m.includes('Password should be')) return '비밀번호는 8자 이상으로 정해 주세요';
  if (m.includes('Email not confirmed')) return '메일함에서 가입 확인 링크를 먼저 눌러 주세요';
  if (err.code === '23505' && m.includes('duplicate key')) return '이미 있는 항목이에요';
  return m;
}

// 로그인 후 돌아갈 주소. 다른 사이트로 보내지 않도록 이 사이트 안의 경로만 허용한다.
export function safeNext(next: string, fallback = '/app'): string {
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}
