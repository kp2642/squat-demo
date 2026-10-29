import { decrypt, encrypt as encryptValue, nameHash, phoneHash } from './crypto';
import { maskPhone, phoneDigits } from './phone';
import type { LeadStatus } from './labels';

// DB 함수 lead_json 이 돌려주는 문의
export type LeadRow = {
  id: string;
  status: LeadStatus;
  contract_amount: number | null;
  fail_reason: string | null;
  method: string;
  inquiry_type: string | null;
  name_enc: string | null;
  phone_enc: string | null;
  phone_masked: string | null;
  channel_id: string | null;
  channel_name: string | null;
  channel_code: string | null;
  asked_channel_id: string | null;
  asked_channel_name: string | null;
  attribution: string;
  evidence: string | null;
  keyword: string | null;
  campaign: string | null;
  ad_group: string | null;
  coupon_code: string | null;
  touches: number;
  last_touch_at: string | null;
  created_at: string;
};

// 화면(클라이언트 컴포넌트 포함)으로 넘기는 모양. 이름·연락처는 서버에서 풀어서 넘긴다.
export type LeadView = Omit<LeadRow, 'name_enc' | 'phone_enc'> & {
  name: string | null;
  phone: string | null;
};

function safeDecrypt(value: string | null): string | null {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return '(읽을 수 없음)';
  }
}

export function formatPhone(raw: string | null): string | null {
  if (!raw) return null;
  const d = phoneDigits(raw);
  if (!d) return raw;
  const head = d.startsWith('02') ? 2 : 3;
  return `${d.slice(0, head)}-${d.slice(head, d.length - 4)}-${d.slice(-4)}`;
}

export function toView(row: LeadRow): LeadView {
  const { name_enc, phone_enc, ...rest } = row;
  return { ...rest, name: safeDecrypt(name_enc), phone: formatPhone(safeDecrypt(phone_enc)) };
}

// 검색어 → inbox_list 검색 인자. 번호 전체, 뒷자리 4개, 이름(정확히 같은 이름) 중 하나.
export function searchArgs(q: string): Record<string, string> {
  const query = q.trim();
  if (!query) return {};
  const digits = phoneDigits(query);
  if (digits) return { p_phone_hash: phoneHash(digits) };
  if (/^\d{4}$/.test(query)) return { p_last4: query };
  return { p_name_hash: nameHash(query) };
}

// 직접 입력한 이름·연락처를 저장용 값으로
export function contactArgs(name: string, phone: string) {
  const digits = phoneDigits(phone);
  return {
    digits,
    args: {
      p_name_enc: name ? encryptValue(name) : null,
      p_name_hash: name ? nameHash(name) : null,
      p_phone_enc: digits ? encryptValue(formatPhone(phone)!) : null,
      p_phone_hash: digits ? phoneHash(digits) : null,
      p_phone_masked: digits ? maskPhone(digits) : null,
    },
  };
}


// DB 함수 inbox_options
export type InboxChannel = { id: string; name: string; kind: string; code: string | null; hidden: boolean; coupon_codes: string[] };
export type InboxOptions = { channels: InboxChannel[]; inquiry_types: string[] };
