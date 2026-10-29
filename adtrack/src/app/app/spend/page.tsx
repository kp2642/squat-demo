import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { currentMonth, firstDay, isMonth, monthLabel, shiftMonth } from '@/lib/month';
import { formatWon } from '@/lib/labels';
import { Messages } from '../../messages';
import { ConfirmButton } from '../confirm-button';
import { addChannel, copyPrevMonth, deleteKeyword, saveKeyword, saveSpend, updateChannel, uploadKeywordCsv } from './actions';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

type SpendChannel = {
  id: string; name: string; kind: 'paid' | 'free'; code: string | null; hidden: boolean; utm_sources: string[];
  amount: number | null; prev_amount: number | null;
};
type SpendMonth = {
  channels: SpendChannel[];
  keywords: { keyword: string; amount: number; clicks: number | null; impressions: number | null }[];
  keyword_total: number;
  prev_total: number;
};

const won = (n: number | null) => (n == null ? '' : n.toLocaleString('ko-KR'));

export default async function SpendPage({ searchParams }: Props) {
  const params = await searchParams;
  const month = isMonth(params.month) ? params.month : currentMonth();
  const { db } = await requireAdmin();
  const data = await db.rpc<SpendMonth>('spend_month', { p_month: firstDay(month) });
  const visible = data.channels.filter((c) => !c.hidden);
  const hidden = data.channels.filter((c) => c.hidden);
  const total = data.channels.reduce((s, c) => s + (c.amount ?? 0), 0);
  const hasNaver = visible.some((c) => c.code === 'naver_sa');
  const monthField = <input type="hidden" name="month" value={month} />;

  return (
    <>
      <div className="page-head">
        <h1>광고비</h1>
        <nav className="row month-nav" aria-label="달 바꾸기">
          <Link href={`/app/spend?month=${shiftMonth(month, -1)}`} aria-label="지난 달">←</Link>
          <strong>{monthLabel(month)}</strong>
          <Link href={`/app/spend?month=${shiftMonth(month, 1)}`} aria-label="다음 달">→</Link>
        </nav>
      </div>
      <Messages error={params.error} notice={params.notice} />

      <section className="card">
        <h2>채널별 광고비 <span className="muted small">합계 {formatWon(total)}</span></h2>
        <form action={saveSpend}>
          {monthField}
          <ul className="list">
            {visible.map((c) => (
              <li key={c.id}>
                <label htmlFor={`amount-${c.id}`} style={{ margin: 0, fontWeight: 500 }}>
                  {c.name}
                  {c.prev_amount != null && <><br /><span className="hint">지난 달 {formatWon(c.prev_amount)}</span></>}
                </label>
                <input id={`amount-${c.id}`} name={`amount:${c.id}`} inputMode="numeric" defaultValue={won(c.amount)} aria-label={`${c.name} 광고비`}
                  placeholder={c.kind === 'free' ? '없음' : '0'} className="amount-input" />
              </li>
            ))}
          </ul>
          <p className="muted small">광고비가 없는 채널은 성과 화면에서 ‘무료 유입’으로 보여요. 블로그 체험단비처럼 쓴 돈이 있으면 적어 주세요.</p>
          <button className="full">저장</button>
        </form>
        {data.prev_total > 0 && (
          <form action={copyPrevMonth} style={{ marginTop: 8 }}>
            {monthField}
            <button className="secondary full">지난 달 금액 복사 ({formatWon(data.prev_total)})</button>
          </form>
        )}
      </section>

      {hasNaver && (
        <section className="card">
          <h2>네이버 키워드별 광고비 <span className="muted small">합계 {formatWon(data.keyword_total)}</span></h2>
          <form action={uploadKeywordCsv}>
            {monthField}
            <label htmlFor="csv">
              키워드 보고서 CSV 올리기{' '}
              <span className="hint">네이버 광고센터 → 보고서에서 {monthLabel(month)} 한 달, 키워드별로 받은 CSV. 올리면 이 달 키워드가 파일 내용으로 바뀌어요.</span>
            </label>
            <input id="csv" name="file" type="file" accept=".csv,text/csv" required />
            <label className="chip" style={{ marginTop: 8 }}>
              <input type="checkbox" name="set_channel" defaultChecked /> 네이버 검색광고 월 광고비도 키워드 합계로 맞추기
            </label>
            <button className="full">올리기</button>
          </form>

          {data.keywords.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table className="table">
                <thead><tr><th>키워드</th><th className="num">클릭</th><th className="num">광고비</th><th /></tr></thead>
                <tbody>
                  {data.keywords.map((k) => (
                    <tr key={k.keyword}>
                      <td>{k.keyword}</td>
                      <td className="num">{k.clicks?.toLocaleString('ko-KR') ?? '-'}</td>
                      <td className="num">{won(k.amount)}</td>
                      <td>
                        <form action={deleteKeyword}>
                          {monthField}
                          <input type="hidden" name="keyword" value={k.keyword} />
                          <button className="danger" aria-label={`${k.keyword} 지우기`}>×</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details style={{ marginTop: 12 }}>
            <summary>키워드 직접 입력</summary>
            <form action={saveKeyword} className="filters" style={{ marginTop: 8 }}>
              {monthField}
              <input name="keyword" placeholder="키워드" aria-label="키워드" required maxLength={100} style={{ gridColumn: '1 / -1' }} />
              <input name="amount" inputMode="numeric" placeholder="광고비" aria-label="키워드 광고비" required style={{ gridColumn: 'auto' }} />
              <input name="clicks" inputMode="numeric" placeholder="클릭 수 (선택)" aria-label="클릭 수" style={{ gridColumn: 'auto' }} />
              <button style={{ gridColumn: '1 / -1' }}>저장</button>
            </form>
          </details>
          {data.keywords.length > 0 && (
            <form action={deleteKeyword} style={{ marginTop: 12 }}>
              {monthField}
              <ConfirmButton className="danger" message={`${monthLabel(month)} 키워드 광고비를 모두 지울까요?`}>이 달 키워드 모두 지우기</ConfirmButton>
            </form>
          )}
        </section>
      )}

      <section className="card">
        <h2>채널 관리</h2>
        <p className="muted small">utm_source 값은 광고 주소의 utm_source 와 같은 값을 적어요. 여러 개는 쉼표로. 기본 채널은 지울 수 없고 숨길 수 있어요.</p>
        {[...visible, ...hidden].map((c) => (
          <details key={c.id} className="channel-edit">
            <summary>
              {c.name} {c.hidden && <span className="badge">숨김</span>} <span className="badge">{c.kind === 'paid' ? '유료' : '무료'}</span>
            </summary>
            <form action={updateChannel}>
              {monthField}
              <input type="hidden" name="id" value={c.id} />
              <label htmlFor={`name-${c.id}`}>이름</label>
              <input id={`name-${c.id}`} name="name" defaultValue={c.name} maxLength={30} required />
              <label htmlFor={`kind-${c.id}`}>종류</label>
              <select id={`kind-${c.id}`} name="kind" defaultValue={c.kind}>
                <option value="paid">유료</option>
                <option value="free">무료</option>
              </select>
              <label htmlFor={`utm-${c.id}`}>utm_source 값</label>
              <input id={`utm-${c.id}`} name="utm_sources" defaultValue={c.utm_sources.join(', ')} />
              <label className="chip" style={{ marginTop: 8 }}>
                <input type="checkbox" name="hidden" defaultChecked={c.hidden} /> 숨기기 (문의 등록·광고비 입력에서 빠짐)
              </label>
              <button className="full">저장</button>
            </form>
          </details>
        ))}
        <form action={addChannel} style={{ marginTop: 12 }}>
          {monthField}
          <label htmlFor="new-channel">채널 추가</label>
          <div className="row">
            <input id="new-channel" name="name" placeholder="예: 당근 광고" maxLength={30} required />
            <select name="kind" aria-label="종류" style={{ flex: '0 0 auto', width: 'auto' }}>
              <option value="paid">유료</option>
              <option value="free">무료</option>
            </select>
          </div>
          <input name="utm_sources" placeholder="utm_source 값 (선택, 예: daangn)" aria-label="새 채널 utm_source 값" style={{ marginTop: 8 }} />
          <button className="full">추가</button>
        </form>
      </section>
    </>
  );
}
