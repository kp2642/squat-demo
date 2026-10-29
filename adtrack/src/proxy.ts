import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { TEST_AUTH_COOKIE, testAuthEnabled } from './lib/test-auth';

// 요청마다 Supabase 세션 쿠키를 갱신하고, 로그인하지 않은 사용자를 로그인 화면으로 보낸다.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // 브라우저 테스트 로그인(서명 확인은 화면에서)
  if (testAuthEnabled() && request.cookies.has(TEST_AUTH_COOKIE)) return response;

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!user && (path.startsWith('/app') || path.startsWith('/onboarding'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // 추적 코드(/t/)와 수집 API 는 고객 홈페이지에서 오는 요청이라 로그인 세션이 필요 없다
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/collect|t/).*)'],
};
