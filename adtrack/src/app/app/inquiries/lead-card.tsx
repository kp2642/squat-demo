'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { LeadView } from '@/lib/leads';
import {
  ATTRIBUTION_LABELS, FAIL_REASONS, METHOD_LABELS, formatTime, formatWon, statusLabel, type LeadStatus,
} from '@/lib/labels';
import { setLeadStatus } from './actions';

type Props = { lead: LeadView; contractTerm: string; avgAmount: number };

// 문의함 카드. 휴대폰에서 '계약 + 금액'을 두 번 탭으로 끝낼 수 있게:
// 계약 탭 → 업종 평균 금액이 채워진 칸이 열림 → 저장 탭
export function LeadCard({ lead: initial, contractTerm, avgAmount }: Props) {
  const [lead, setLead] = useState(initial);
  const [panel, setPanel] = useState<'contract' | 'fail' | null>(null);
  const [amount, setAmount] = useState(() => (initial.contract_amount ?? avgAmount).toLocaleString('ko-KR'));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(status: LeadStatus, opts: { amount?: number | null; reason?: string } = {}) {
    setError(null);
    startTransition(async () => {
      const result = await setLeadStatus(lead.id, status, opts.amount, opts.reason ?? null);
      if (result.error) setError(result.error);
      if (result.lead) {
        setLead(result.lead);
        setPanel(null);
      }
    });
  }

  function saveContract() {
    const n = Number(amount.replace(/[,\s원]/g, ''));
    if (!amount.trim() || !Number.isSafeInteger(n) || n < 0) {
      setError('금액을 숫자로 적어 주세요');
      return;
    }
    save('contracted', { amount: n });
  }

  const source = lead.channel_name ?? '출처 미확인';
  const detail = [lead.keyword, lead.campaign].filter(Boolean).join(' · ');

  return (
    <article className="card lead-card" data-testid="lead-card" data-lead-id={lead.id} aria-busy={pending}>
      <div className="lead-head">
        <strong>{lead.name || '이름 없음'}</strong>
        <span className={`status status-${lead.status}`}>{statusLabel(lead.status, contractTerm)}</span>
      </div>
      {lead.phone ? (
        <details className="phone">
          <summary>{lead.phone_masked}</summary>
          <a href={`tel:${lead.phone.replace(/\D/g, '')}`}>{lead.phone} 전화 걸기</a>
        </details>
      ) : (
        <div className="muted">연락처 없음</div>
      )}
      <div className="muted small">
        {[METHOD_LABELS[lead.method], lead.inquiry_type, formatTime(lead.created_at)].filter(Boolean).join(' · ')}
      </div>
      <div className="lead-source">
        <span>{source}</span>
        {detail && <span className="muted"> · {detail}</span>}{' '}
        <span className={`badge attr-${lead.attribution}`}>{ATTRIBUTION_LABELS[lead.attribution]}</span>
      </div>
      {lead.evidence && <div className="muted small">근거: {lead.evidence}</div>}
      {lead.asked_channel_name && lead.asked_channel_name !== lead.channel_name && (
        <div className="muted small">고객 응답: {lead.asked_channel_name}</div>
      )}
      {lead.touches > 0 && <div className="muted small">다시 연락 {lead.touches}회</div>}
      {lead.status === 'contracted' && <div className="amount">{contractTerm} {formatWon(lead.contract_amount)}</div>}
      {lead.status === 'failed' && lead.fail_reason && <div className="muted small">실패 사유: {lead.fail_reason}</div>}

      <div className="status-buttons" role="group" aria-label="상태 바꾸기">
        <button type="button" className="secondary" aria-pressed={lead.status === 'consulting'} disabled={pending}
          onClick={() => { setPanel(null); save('consulting'); }}>
          상담중
        </button>
        <button type="button" className="secondary" aria-pressed={lead.status === 'contracted'} disabled={pending}
          onClick={() => setPanel(panel === 'contract' ? null : 'contract')}>
          {contractTerm}
        </button>
        <button type="button" className="secondary" aria-pressed={lead.status === 'failed'} disabled={pending}
          onClick={() => setPanel(panel === 'fail' ? null : 'fail')}>
          실패
        </button>
      </div>

      {panel === 'contract' && (
        <div className="row panel">
          <input aria-label={`${contractTerm} 금액`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="muted">원</span>
          <button type="button" disabled={pending} onClick={saveContract}>저장</button>
        </div>
      )}
      {panel === 'fail' && (
        <div className="chips panel" role="group" aria-label="실패 사유">
          {FAIL_REASONS.map((r) => (
            <button key={r} type="button" className="secondary" disabled={pending} onClick={() => save('failed', { reason: r })}>
              {r}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error small" role="alert">{error}</p>}
      <Link href={`/app/inquiries/${lead.id}`} className="small">자세히 · 출처 수정</Link>
    </article>
  );
}
