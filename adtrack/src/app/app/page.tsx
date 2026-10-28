import { requireAdmin } from '@/lib/session';

export default async function PerformancePage() {
  await requireAdmin();
  return (
    <>
      <h1>성과</h1>
      <div className="card muted">채널별 광고비·문의·계약·ROAS 는 5단계(성과 화면)에서 채워져요.</div>
    </>
  );
}
