import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { computePerformance, percent, won, type Badge, type RawPerformance, type Row } from '@/lib/performance';
import { coversWholeMonths, periodLabel, resolvePeriod, type PeriodKey } from '@/lib/period';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const PERIODS: [PeriodKey, string][] = [['this', '이번 달'], ['last', '지난 달'], ['30d', '최근 30일'], ['custom', '직접 지정']];
const BADGE_CLASS: Record<Badge, string> = {
  '확대 검토': 'verdict-good', '유지': 'verdict-neutral', '점검 필요': 'verdict-warn', '무료 유입': 'verdict-free', '표본 부족': 'verdict-free',
};

function Tile({ id, label, value, sub }: { id: string; label: string; value: string; sub?: string }) {
  return (
    <div className="tile" data-testid={`sum-${id}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

function RoasCell({ row, max }: { row: Row; max: number }) {
  if (row.roas == null) return <td className="num">-</td>;
  const width = max > 0 ? Math.max(2, Math.min(100, (row.roas / max) * 100)) : 0;
  return (
    <td className="roas-cell">
      <span className="roas-bar" style={{ width: `${width}%` }} aria-hidden />
      <span className="num">{percent(row.roas)}</span>
    </td>
  );
}

function Table({ rows, first, term, testid }: { rows: Row[]; first: string; term: string; testid: string }) {
  const max = Math.max(0, ...rows.map((r) => r.roas ?? 0));
  return (
    <>
      {/* 넓은 화면: 표 */}
      <div className="table-wrap wide-only">
        <table className="table perf-table" data-testid={testid}>
          <thead>
            <tr>
              <th>{first}</th><th className="num">광고비</th><th className="num">문의</th><th className="num">{term}</th>
              <th className="num">전환율</th><th className="num">문의당 비용</th><th className="num">{term}당 비용</th>
              <th className="num">매출</th><th>ROAS</th><th>판단</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id ?? r.name} data-row={r.name}>
                <th scope="row">{r.name}</th>
                <td className="num">{won(r.spend)}</td>
                <td className="num">{r.leads.toLocaleString('ko-KR')}</td>
                <td className="num">{r.contracts.toLocaleString('ko-KR')}</td>
                <td className="num">{percent(r.conversion, 1)}</td>
                <td className="num">{won(r.cpl)}</td>
                <td className="num">{won(r.cpa)}</td>
                <td className="num">{won(r.revenue)}</td>
                <RoasCell row={r} max={max} />
                <td><span className={`verdict ${BADGE_CLASS[r.badge]}`}>{r.badge}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 휴대폰: 채널마다 카드, ROAS 와 판단을 맨 위에 */}
      <ul className="perf-cards narrow-only" data-testid={`${testid}-cards`}>
        {rows.map((r) => (
          <li key={r.id ?? r.name} data-row={r.name}>
            <div className="perf-card-head">
              <strong>{r.name}</strong>
              <span className={`verdict ${BADGE_CLASS[r.badge]}`}>{r.badge}</span>
            </div>
            <div className="perf-card-roas">
              <span className="roas-track">{r.roas != null && <span className="roas-bar-inline" style={{ width: `${max > 0 ? Math.max(2, Math.min(100, (r.roas / max) * 100)) : 0}%` }} />}</span>
              <span>{r.roas == null ? '광고비 없음' : `ROAS ${percent(r.roas)}`}</span>
            </div>
            <dl className="perf-card-grid">
              <dt>광고비</dt><dd>{won(r.spend)}</dd>
              <dt>매출</dt><dd>{won(r.revenue)}</dd>
              <dt>문의 · {term}</dt><dd>{r.leads} · {r.contracts} ({percent(r.conversion, 1)})</dd>
              <dt>문의당 · {term}당</dt><dd>{r.cpl == null && r.cpa == null ? '-' : `${won(r.cpl)} · ${won(r.cpa)}`}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

export default async function PerformancePage({ searchParams }: Props) {
  const params = await searchParams;
  const { db, workspace } = await requireAdmin();
  const period = resolvePeriod(params);
  const p = computePerformance(await db.rpc<RawPerformance>('performance', { p_from: period.from, p_to: period.to }));
  const t = p.total;
  const term = p.contractTerm;
  const a = p.attribution;
  const pct = (n: number) => (t.leads ? percent((n / t.leads) * 100) : '0%');

  return (
    <>
      <h1>성과</h1>
      <nav className="status-tabs" aria-label="기간">
        {PERIODS.filter(([k]) => k !== 'custom').map(([k, label]) => (
          <Link key={k} href={k === 'this' ? '/app' : `/app?period=${k}`} className={period.key === k ? 'active' : undefined}>{label}</Link>
        ))}
      </nav>
      <form className="row period-form" action="/app">
        <input type="hidden" name="period" value="custom" />
        <input type="date" name="from" defaultValue={period.from} aria-label="시작일" required />
        <span className="muted">~</span>
        <input type="date" name="to" defaultValue={period.to} aria-label="종료일" required />
        <button className="secondary">보기</button>
      </form>
      <p className="muted small" data-testid="period">
        {periodLabel(p.from, p.to)} 에 등록된 문의 기준
        {!coversWholeMonths(p.from, p.to) && ' · 광고비는 월 금액을 기간에 든 일수만큼 나눠 계산'}
      </p>

      {p.stale > 0 && (
        <p className="error" data-testid="stale">
          {term}·실패 결과가 아직 입력되지 않은 7일 지난 문의가 {p.stale}건 있어요. 입력이 빠지면 ROAS 가 낮게 나와요.{' '}
          <Link href="/app/inquiries?status=new">문의함에서 입력</Link>
        </p>
      )}

      <section className="tiles">
        <Tile id="spend" label="광고비" value={won(t.spend)} />
        <Tile id="leads" label="문의" value={`${t.leads.toLocaleString('ko-KR')}건`} sub={`전환율 ${percent(t.conversion, 1)}`} />
        <Tile id="contracts" label={term} value={`${t.contracts.toLocaleString('ko-KR')}건`} />
        <Tile id="revenue" label={`${term} 매출`} value={won(t.revenue)} />
        <Tile id="roas" label="ROAS" value={percent(t.roas)} sub={t.roas == null ? '광고비 없음' : `광고비 1원당 ${(t.roas / 100).toFixed(1)}원`} />
        <Tile id="cpl" label="문의당 비용" value={won(t.cpl)} />
        <Tile id="cpa" label={`${term}당 비용`} value={won(t.cpa)} />
      </section>

      <section className="card suggestion" data-testid="suggestion">
        {p.suggestion ?? '표본(문의 5건 이상)이 쌓인 유료 채널이 두 개 이상이면 예산을 옮길 곳을 제안해 드려요.'}
      </section>

      <section className="card">
        <h2>채널별</h2>
        {p.channels.length ? <Table rows={p.channels} first="채널" term={term} testid="channels" /> : <p className="muted">이 기간에는 문의도 광고비도 없어요.</p>}
        <p className="muted small" style={{ marginBottom: 0 }}>
          판단: ROAS {workspace.roas_high}% 이상 확대 검토 · {workspace.roas_low}~{workspace.roas_high}% 유지 · {workspace.roas_low}% 미만 점검 필요.
          문의 5건 미만은 표본 부족, 광고비 없는 채널은 무료 유입. 기준은 설치 탭에서 바꿀 수 있어요.
        </p>
      </section>

      {p.keywords.length > 0 && (
        <section className="card">
          <h2>네이버 키워드별</h2>
          <Table rows={p.keywords} first="키워드" term={term} testid="keywords" />
        </section>
      )}

      <section className="card" data-testid="attribution">
        <h2>출처 판별</h2>
        <dl className="facts">
          <dt>자동 (추적 코드)</dt><dd>{a.auto}건 · {pct(a.auto)}</dd>
          <dt>쿠폰 문구</dt><dd>{a.coupon}건 · {pct(a.coupon)}</dd>
          <dt>고객 응답</dt><dd>{a.asked}건 · {pct(a.asked)} <span className="muted small">(고객 기억이라 틀릴 수 있어요)</span></dd>
          <dt>직원 직접 선택</dt><dd>{a.manual}건 · {pct(a.manual)}</dd>
          <dt>출처 미확인</dt><dd>{a.unknown}건 · {pct(a.unknown)}</dd>
        </dl>
      </section>
    </>
  );
}
