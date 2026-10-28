import { requireAdmin } from '@/lib/session';

export default async function SpendPage() {
  await requireAdmin();
  return (
    <>
      <h1>광고비</h1>
      <div className="card muted">채널·월별 광고비 입력과 네이버 키워드 CSV 올리기는 4단계(광고비)에서 만들어요.</div>
    </>
  );
}
