// 화면에 보이는 이름들 (클라이언트에서도 쓰므로 서버 전용 코드를 넣지 않는다)

export type LeadStatus = 'new' | 'consulting' | 'contracted' | 'failed';
export const STATUSES: LeadStatus[] = ['new', 'consulting', 'contracted', 'failed'];

// '계약' 자리는 업종의 계약 용어(수임·결제·등록…)로 바뀐다
export function statusLabel(status: LeadStatus, contractTerm: string): string {
  return { new: '새 문의', consulting: '상담중', contracted: contractTerm, failed: '실패' }[status];
}

export const FAIL_REASONS = ['가격', '연락 안 됨', '다른 곳 선택', '기타'] as const;

export const METHOD_LABELS: Record<string, string> = { form: '홈페이지', call: '전화', walkin: '방문', etc: '기타' };

export const ATTRIBUTION_LABELS: Record<string, string> = {
  auto: '자동',
  coupon: '쿠폰 문구',
  asked: '고객 응답',
  manual: '직접 선택',
  unknown: '출처 미확인',
};

export const EVENT_LABELS: Record<string, string> = {
  created: '직접 등록',
  status: '상태',
  contract_amount: '금액',
  fail_reason: '실패 사유',
  channel: '출처',
  attribution: '판별 방식',
  asked_channel: '고객 응답',
  name: '이름',
  phone: '연락처',
  inquiry_type: '상담 유형',
};

export function formatWon(n: number | null | undefined): string {
  return n == null ? '-' : `${Number(n).toLocaleString('ko-KR')}원`;
}

const KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
export function formatTime(iso: string): string {
  return KST.format(new Date(iso));
}
