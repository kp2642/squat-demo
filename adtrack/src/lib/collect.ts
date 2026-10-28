import { attribute, chooseTouch, TRACKED_TAGS, type Touch } from './attribution';
import { encrypt, ipHash, phoneHash } from './crypto';
import { maskPhone, phoneDigits } from './phone';
import { rpc } from './server-db';

// 추적 코드가 보내는 내용 (tracker/tracker.js 의 send)
export type CollectPayload = {
  type?: unknown;
  k?: unknown; // 추적 키
  h?: unknown; // 홈페이지 호스트
  v?: unknown; // 방문자 ID
  touch?: unknown;
  f?: unknown; // 첫 유입
  l?: unknown; // 마지막 광고 유입
  d?: unknown; // 폼 값 { name, phone, itype }
  ty?: unknown; // 문의 완료 페이지 방식
};

export type CollectResult = { ok: boolean; reason?: string; lead_id?: string; merged?: boolean };

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// 브라우저가 보낸 값은 믿지 않고 필요한 모양으로만 다시 만든다
export function sanitizeTouch(raw: unknown): Touch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const t: Record<string, string> = {};
  const tags = (r.t && typeof r.t === 'object' ? r.t : {}) as Record<string, unknown>;
  for (const key of TRACKED_TAGS) {
    const v = text(tags[key], 200);
    if (v) t[key] = v;
  }
  const touch: Touch = { t };
  const ref = text(r.r, 300);
  if (ref) touch.r = ref;
  const page = text(r.p, 200);
  if (page) touch.p = page;
  if (typeof r.ts === 'number' && Number.isFinite(r.ts)) touch.ts = Math.floor(r.ts);
  return touch;
}

export async function collect(payload: CollectPayload, origin: { host: string; ip: string }): Promise<CollectResult> {
  const key = text(payload.k, 64);
  if (!/^tk_[0-9a-f]{32}$/.test(key)) return { ok: false, reason: 'bad_key' };
  const host = origin.host;
  const visitor = text(payload.v, 64) || 'unknown';

  switch (payload.type) {
    case 'hello':
      return rpc('collect_hello', { p_tracking_key: key, p_host: host });

    case 'visit': {
      const touch = sanitizeTouch(payload.touch);
      if (!touch || !Object.keys(touch.t ?? {}).length) return { ok: false, reason: 'no_tags' };
      return rpc('collect_visit', {
        p_tracking_key: key, p_host: host, p_visitor_id: visitor,
        p_tags: touch.t, p_referrer: touch.r ?? null, p_landing: touch.p ?? null,
      });
    }

    case 'lead': {
      const form = (payload.d && typeof payload.d === 'object' ? payload.d : {}) as Record<string, unknown>;
      const thankYou = payload.ty === 1 || payload.ty === true;
      const phoneRaw = text(form.phone, 30);
      const digits = phoneDigits(phoneRaw);
      if (!digits && !thankYou) return { ok: false, reason: 'no_phone' };
      const name = text(form.name, 50);

      const first = sanitizeTouch(payload.f);
      const last = sanitizeTouch(payload.l);
      const touch = chooseTouch(first, last);
      const source = attribute(touch);

      return rpc('collect_lead', {
        p_tracking_key: key,
        p_host: host,
        p_visitor_id: visitor,
        p_ip_hash: ipHash(origin.ip),
        p_lead: {
          name_enc: name ? encrypt(name) : null,
          phone_enc: digits ? encrypt(phoneRaw) : null,
          phone_hash: digits ? phoneHash(digits) : null,
          phone_masked: digits ? maskPhone(digits) : null,
          inquiry_type: text(form.itype, 50) || null,
          source,
          first_touch: first,
          last_touch: touch,
        },
      });
    }

    default:
      return { ok: false, reason: 'bad_type' };
  }
}
