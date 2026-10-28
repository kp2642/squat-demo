import { requireMember } from '@/lib/session';

export default async function InquiriesPage() {
  await requireMember();
  return (
    <>
      <h1>문의함</h1>
      <div className="card muted">홈페이지 문의는 2단계(추적 코드), 목록·상태 변경·직접 등록은 3단계(문의함)에서 만들어요.</div>
    </>
  );
}
