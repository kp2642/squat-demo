import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/session';
import { toView, type InboxOptions, type LeadRow } from '@/lib/leads';
import type { Touch } from '@/lib/attribution';
import {
  ATTRIBUTION_LABELS, EVENT_LABELS, FAIL_REASONS, METHOD_LABELS, STATUSES, formatTime, formatWon, statusLabel,
} from '@/lib/labels';
import { Messages } from '../../../messages';
import { ConfirmButton } from '../../confirm-button';
import { deleteLead, updateAsked, updateChannel, updateContact, updateStatusForm } from '../actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

type Detail = LeadRow & {
  first_touch: Touch | null;
  last_touch: Touch | null;
  touch_list: { method: string; channel_name: string | null; evidence: string | null; created_at: string }[];
  events: { field: string; old_value: string | null; new_value: string | null; created_at: string; user_name: string | null }[];
};

function describeTouch(t: Touch | null): string {
  if (!t) return '-';
  const tags = Object.entries(t.t ?? {}).map(([k, v]) => `${k}=${v}`).join(', ');
  const parts = [tags, t.r && `유입 주소 ${t.r}`, t.p && `도착 ${t.p}`].filter(Boolean);
  const when = t.ts ? formatTime(new Date(t.ts * 1000).toISOString()) : '';
  return `${parts.join(' · ') || '꼬리표·유입 주소 없음'}${when ? ` (${when})` : ''}`;
}

export default async function LeadDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db, member, workspace } = await requireMember();
  const [row, options] = await Promise.all([
    db.rpc<Detail | null>('lead_detail', { p_id: id }),
    db.rpc<InboxOptions>('inbox_options'),
  ]);
  if (!row) notFound();
  const lead = toView(row);
  const term = workspace.contract_term;
  const valueLabel = (field: string, v: string | null) => {
    if (v == null) return '없음';
    if (field === 'status') return statusLabel(v as never, term);
    if (field === 'attribution') return ATTRIBUTION_LABELS[v] ?? v;
    if (field === 'contract_amount') return formatWon(Number(v));
    if (field === 'created') return METHOD_LABELS[v] ?? v;
    return v;
  };
  const channelOptions = options.channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.hidden ? ' (숨김)' : ''}</option>);

  return (
    <>
      <p><Link href="/app/inquiries">← 문의함</Link></p>
      <h1>{lead.name || '이름 없음'} <span className={`status status-${lead.status}`}>{statusLabel(lead.status, term)}</span></h1>
      <Messages error={error} notice={notice} />

      <section className="card">
        <dl className="facts">
          <dt>연락처</dt>
          <dd>{lead.phone ? <a href={`tel:${lead.phone.replace(/\D/g, '')}`}>{lead.phone}</a> : '없음'}</dd>
          <dt>문의</dt>
          <dd>{METHOD_LABELS[lead.method]} · {formatTime(lead.created_at)}</dd>
          <dt>출처</dt>
          <dd>
            {lead.channel_name ?? '출처 미확인'}{' '}
            <span className={`badge attr-${lead.attribution}`}>{ATTRIBUTION_LABELS[lead.attribution]}</span>
          </dd>
          {(lead.keyword || lead.campaign || lead.ad_group) && (
            <><dt>광고</dt><dd>{[lead.keyword && `키워드 ${lead.keyword}`, lead.campaign && `캠페인 ${lead.campaign}`, lead.ad_group && `광고그룹 ${lead.ad_group}`].filter(Boolean).join(' · ')}</dd></>
          )}
          <dt>판별 근거</dt>
          <dd>{lead.evidence ?? '-'}</dd>
          {lead.coupon_code && <><dt>쿠폰 문구</dt><dd>{lead.coupon_code}</dd></>}
          <dt>고객 응답</dt>
          <dd>{lead.asked_channel_name ?? '-'}</dd>
          {row.first_touch && <><dt>첫 유입</dt><dd className="small">{describeTouch(row.first_touch)}</dd></>}
          {row.last_touch && <><dt>마지막 광고 유입</dt><dd className="small">{describeTouch(row.last_touch)}</dd></>}
          {lead.status === 'contracted' && <><dt>{term} 금액</dt><dd>{formatWon(lead.contract_amount)}</dd></>}
          {lead.fail_reason && <><dt>실패 사유</dt><dd>{lead.fail_reason}</dd></>}
        </dl>
      </section>

      <section className="card">
        <h2>상태</h2>
        <form action={updateStatusForm}>
          <input type="hidden" name="id" value={lead.id} />
          <div className="filters">
            <select name="status" defaultValue={lead.status} aria-label="상태">
              {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s, term)}</option>)}
            </select>
            <input name="amount" inputMode="numeric" aria-label={`${term} 금액`} placeholder={`${term} 금액`}
              defaultValue={(lead.contract_amount ?? workspace.avg_contract_amount).toLocaleString('ko-KR')} style={{ gridColumn: 'auto' }} />
            <select name="fail_reason" defaultValue={lead.fail_reason ?? ''} aria-label="실패 사유">
              <option value="">실패 사유</option>
              {FAIL_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
            <button>저장</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>금액은 {term}일 때만, 실패 사유는 실패일 때만 저장돼요.</p>
        </form>
      </section>

      <section className="card">
        <h2>출처</h2>
        <form action={updateChannel}>
          <input type="hidden" name="id" value={lead.id} />
          <label htmlFor="channel">출처 바꾸기 <span className="hint">바꾸면 ‘직접 선택’으로 표시되고 원래 값은 기록에 남아요</span></label>
          <div className="row">
            <select id="channel" name="channel_id" defaultValue={lead.channel_id ?? ''}>
              <option value="">출처 미확인</option>
              {channelOptions}
            </select>
            <button>저장</button>
          </div>
        </form>
        <form action={updateAsked}>
          <input type="hidden" name="id" value={lead.id} />
          <label htmlFor="asked">고객 응답 <span className="hint">‘어떻게 알고 오셨어요?’ 답. 출처는 바뀌지 않아요</span></label>
          <div className="row">
            <select id="asked" name="channel_id" defaultValue={lead.asked_channel_id ?? ''}>
              <option value="">없음</option>
              {channelOptions}
            </select>
            <button>저장</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>고객 정보</h2>
        <form action={updateContact}>
          <input type="hidden" name="id" value={lead.id} />
          <label htmlFor="name">이름</label>
          <input id="name" name="name" defaultValue={lead.name ?? ''} maxLength={50} autoComplete="off" />
          <label htmlFor="phone">연락처</label>
          <input id="phone" name="phone" type="tel" defaultValue={lead.phone ?? ''} autoComplete="off" />
          <label htmlFor="inquiry_type">상담 유형</label>
          <select id="inquiry_type" name="inquiry_type" defaultValue={lead.inquiry_type ?? ''}>
            <option value="">없음</option>
            {lead.inquiry_type && !options.inquiry_types.includes(lead.inquiry_type) && <option>{lead.inquiry_type}</option>}
            {options.inquiry_types.map((t) => <option key={t}>{t}</option>)}
          </select>
          <button className="full">저장</button>
        </form>
      </section>

      {row.touch_list.length > 0 && (
        <section className="card">
          <h2>다시 연락 ({row.touch_list.length})</h2>
          <ul className="list">
            {row.touch_list.map((t, i) => (
              <li key={i}>
                <span>{METHOD_LABELS[t.method]} · {t.channel_name ?? '출처 미확인'}<br /><span className="muted small">{t.evidence}</span></span>
                <span className="muted small">{formatTime(t.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>변경 기록</h2>
        {row.events.length === 0 ? <p className="muted">아직 없어요</p> : (
          <ul className="list" data-testid="events">
            {row.events.map((e, i) => (
              <li key={i}>
                <span>
                  {EVENT_LABELS[e.field] ?? e.field}
                  {e.field === 'created' ? ` (${valueLabel(e.field, e.new_value)})`
                    : e.field === 'name' ? ' 수정'
                    : `: ${valueLabel(e.field, e.old_value)} → ${valueLabel(e.field, e.new_value)}`}
                  <br /><span className="muted small">{e.user_name ?? '삭제된 사용자'}</span>
                </span>
                <span className="muted small">{formatTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {member.role === 'admin' && (
        <form action={deleteLead}>
          <input type="hidden" name="id" value={lead.id} />
          <ConfirmButton className="danger" message="이 문의와 변경 기록을 모두 지울까요? 되돌릴 수 없어요.">이 문의 지우기</ConfirmButton>
        </form>
      )}
    </>
  );
}
