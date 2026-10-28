import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/form';

// 가입 확인 메일의 링크가 도착하는 곳. 세션을 만든 뒤 next 로 보낸다.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get('next') ?? '', '/app');
  const supabase = await createClient();

  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error('링크가 올바르지 않아요') };

  const url = request.nextUrl.clone();
  url.search = '';
  if (error) {
    url.pathname = '/login';
    url.searchParams.set('error', '확인 링크가 만료되었거나 이미 사용되었어요. 로그인해 주세요');
    url.searchParams.set('next', next);
  } else {
    url.pathname = next.split('?')[0];
  }
  return NextResponse.redirect(url);
}
