import { type NextRequest } from 'next/server';
import { TRACKER_JS } from '@/generated/tracker';
import { rpc } from '@/lib/server-db';

// 홈페이지에 넣는 추적 코드: <script async src="https://<서비스>/t/<추적키>.js"></script>
// 사업장 설정(문의 완료 페이지 등)을 넣어서 내려주고, CDN 에서 5분 캐시한다.
export async function GET(request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const key = /^(tk_[0-9a-f]{32})\.js$/.exec(file)?.[1];
  const config = key ? await rpc<{ thankYouUrl: string | null; fields?: unknown } | null>('tracker_config', { p_tracking_key: key }) : null;
  if (!key || !config) {
    return new Response('/* 추적 키를 찾을 수 없어요 */', {
      status: 404,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
    });
  }

  const cfg = { k: key, e: `${request.nextUrl.origin}/api/collect`, ...config };
  // </script> 같은 글자가 설정에 들어 있어도 스크립트가 깨지지 않게
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return new Response(TRACKER_JS.replace('__ATK_CONFIG__', json), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
