import Link from 'next/link';
import { requireMember } from '@/lib/session';
import { searchArgs, toView, type InboxOptions, type LeadRow } from '@/lib/leads';
import { STATUSES, statusLabel } from '@/lib/labels';
import { Messages } from '../../messages';
import { LeadCard } from './lead-card';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const PAGE_SIZE = 30;

export default async function InquiriesPage({ searchParams }: Props) {
  const params = await searchParams;
  const { status = '', channel = '', q = '', error, notice } = params;
  const page = Math.max(1, Number(params.page) || 1);
  const { db, workspace } = await requireMember();

  const [list, options] = await Promise.all([
    db.rpc<{ total: number; items: LeadRow[] }>('inbox_list', {
      p_status: STATUSES.includes(status as never) ? status : null,
      p_channel: channel || null,
      ...searchArgs(q),
      p_limit: PAGE_SIZE * page,
      p_offset: 0,
    }),
    db.rpc<InboxOptions>('inbox_options'),
  ]);

  const link = (next: Record<string, string>) => {
    const p = new URLSearchParams({ status, channel, q, ...next });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/app/inquiries${p.size ? `?${p}` : ''}`;
  };

  return (
    <>
      <div className="page-head">
        <h1>문의함</h1>
        <Link href="/app/inquiries/new" className="button">+ 직접 등록</Link>
      </div>
      <Messages error={error} notice={notice} />

      <nav className="status-tabs" aria-label="상태">
        <Link href={link({ status: '', page: '' })} className={!status ? 'active' : undefined}>전체</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={link({ status: s, page: '' })} className={status === s ? 'active' : undefined}>
            {statusLabel(s, workspace.contract_term)}
          </Link>
        ))}
      </nav>

      <form className="filters" action="/app/inquiries">
        {status && <input type="hidden" name="status" value={status} />}
        <select name="channel" defaultValue={channel} aria-label="채널">
          <option value="">모든 채널</option>
          {options.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">출처 미확인</option>
        </select>
        <button className="secondary">적용</button>
        <input name="q" type="search" defaultValue={q} placeholder="이름, 전화번호 또는 뒷자리 4개" aria-label="검색" />
      </form>

      <p className="muted small">{list.total.toLocaleString('ko-KR')}건</p>
      {list.items.map((row) => (
        <LeadCard key={row.id} lead={toView(row)} contractTerm={workspace.contract_term} avgAmount={workspace.avg_contract_amount} />
      ))}
      {list.items.length === 0 && (
        <div className="card muted">
          {q ? '찾는 문의가 없어요. 이름은 정확히 같은 이름만 찾을 수 있어요.' : '아직 문의가 없어요.'}
        </div>
      )}
      {list.total > list.items.length && (
        <Link href={link({ page: String(page + 1) })} className="button secondary full" style={{ textAlign: 'center' }}>
          더 보기
        </Link>
      )}
    </>
  );
}
