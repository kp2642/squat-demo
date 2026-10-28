import { NextResponse, type NextRequest } from 'next/server';
import { collect, type CollectPayload } from '@/lib/collect';

// 추적 코드의 수집 API. 고객 홈페이지(다른 도메인)에서 sendBeacon 으로 부른다.
// 요청한 홈페이지가 추적 키의 사업장에 등록된 도메인인지는 DB 함수(collect_site)가 확인한다.

const MAX_BODY = 16 * 1024;

function cors(request: NextRequest) {
  return {
    'Access-Control-Allow-Origin': request.headers.get('origin') ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

export async function POST(request: NextRequest) {
  const headers = cors(request);
  const body = await request.text();
  if (body.length > MAX_BODY) return NextResponse.json({ ok: false, reason: 'too_large' }, { status: 413, headers });

  let payload: CollectPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400, headers });
  }

  // 브라우저가 붙이는 Origin 을 우선 믿고, 없을 때만 본문의 호스트를 쓴다
  let host = typeof payload.h === 'string' ? payload.h : '';
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') {
    try {
      host = new URL(origin).hostname;
    } catch {
      /* 본문 값 사용 */
    }
  }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';

  try {
    const result = await collect(payload, { host, ip });
    return NextResponse.json(result, { status: result.ok ? 200 : 422, headers });
  } catch (err) {
    console.error('collect failed', err);
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500, headers });
  }
}
