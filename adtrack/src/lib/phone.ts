// 한국 전화번호. +82 10-1234-5678 → 01012345678
export function phoneDigits(input: string | undefined | null): string | null {
  let d = (input ?? '').replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 11) d = '0' + d.slice(2);
  return /^0\d{8,10}$/.test(d) ? d : null;
}

// 화면 표시용: 가운데를 가린다. 010-****-5678, 02-***-5678
export function maskPhone(digits: string): string {
  const head = digits.startsWith('02') ? 2 : 3;
  const tail = 4;
  const mid = digits.length - head - tail;
  return `${digits.slice(0, head)}-${'*'.repeat(Math.max(mid, 0))}-${digits.slice(-tail)}`;
}
