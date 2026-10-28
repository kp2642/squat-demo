import { requireAdmin } from '@/lib/session';
import { loadPresets } from '@/lib/presets';
import { siteOrigin } from '@/lib/origin';
import { Messages } from '../../messages';
import { CopyButton } from '../copy-button';
import {
  addInquiryType, addSite, cancelInvite, inviteMember, removeInquiryType, removeMember, removeSite, updateThankYou,
  updateWorkspace,
} from './actions';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function SetupPage({ searchParams }: Props) {
  const { error, notice } = await searchParams;
  const { supabase, member, workspace } = await requireAdmin();
  const [presets, sites, types, members, invites, origin] = await Promise.all([
    loadPresets(supabase),
    supabase.from('sites').select('id, domain, verified_at').order('created_at').then((r) => r.data ?? []),
    supabase.from('inquiry_types').select('id, name').order('position').then((r) => r.data ?? []),
    supabase.from('users').select('id, email, name, role').order('created_at').then((r) => r.data ?? []),
    supabase
      .from('invitations')
      .select('id, email, role, token, expires_at')
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .then((r) => r.data ?? []),
    siteOrigin(),
  ]);

  // 1단계에서 확인할 수 있는 항목만 체크된다. 나머지는 각 단계에서 연결.
  const steps = [
    { label: '가입·사업장 만들기', done: true },
    { label: '업종 선택', done: true },
    { label: '추적 코드 설치', done: sites.some((s) => s.verified_at) },
    { label: '문의폼 연결 확인', done: false },
    { label: '광고 채널 등록', done: false },
    { label: '이번 달 광고비 입력', done: false },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const snippet = `<script async src="${origin}/t/${workspace.tracking_key}.js"></script>`;

  return (
    <>
      <h1>설치</h1>
      <Messages error={error} notice={notice} />

      <section className="card">
        <h2>처음 설정 ({doneCount}/{steps.length})</h2>
        <div className="progress"><div style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
        <ol className="checklist">
          {steps.map((s) => <li key={s.label} className={s.done ? 'done' : undefined}>{s.label}</li>)}
        </ol>
      </section>

      <section className="card">
        <h2>사업장 설정</h2>
        <form action={updateWorkspace}>
          <label htmlFor="ws-name">사업장 이름</label>
          <input id="ws-name" name="name" defaultValue={workspace.name} required maxLength={100} />
          <label htmlFor="ws-industry">업종</label>
          <select id="ws-industry" name="industry" defaultValue={workspace.industry}>
            {presets.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          <label htmlFor="ws-term">계약 용어 <span className="hint">예: 수임, 결제, 등록, 계약</span></label>
          <input id="ws-term" name="contract_term" defaultValue={workspace.contract_term} required maxLength={20} />
          <label htmlFor="ws-amount">평균 {workspace.contract_term} 금액 (원) <span className="hint">계약 입력 때 미리 채워지는 값</span></label>
          <input id="ws-amount" name="avg_contract_amount" inputMode="numeric" defaultValue={workspace.avg_contract_amount.toLocaleString('ko-KR')} required />
          <label>판단 기준 (ROAS %)</label>
          <div className="row">
            <input name="roas_high" type="number" min={1} defaultValue={workspace.roas_high} aria-label="확대 검토 기준" />
            <span className="muted">이상 확대 검토</span>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input name="roas_low" type="number" min={0} defaultValue={workspace.roas_low} aria-label="점검 필요 기준" />
            <span className="muted">미만 점검 필요</span>
          </div>
          <button className="full">저장</button>
        </form>
      </section>

      <section className="card">
        <h2>홈페이지</h2>
        <ul className="list">
          {sites.map((s) => (
            <li key={s.id}>
              <span>{s.domain}</span>
              <span className="row">
                <span className="badge">{s.verified_at ? '설치 확인됨' : '설치 전'}</span>
                <form action={removeSite}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="danger">빼기</button>
                </form>
              </span>
            </li>
          ))}
          {sites.length === 0 && <li className="muted">아직 등록한 홈페이지가 없어요</li>}
        </ul>
        <form action={addSite} className="row" style={{ marginTop: 12 }}>
          <input name="domain" placeholder="example.com" aria-label="홈페이지 주소" required />
          <button>추가</button>
        </form>
      </section>

      <section className="card">
        <h2>추적 코드</h2>
        <p className="muted">
          홈페이지의 모든 페이지 <code>&lt;head&gt;</code> 안에 아래 한 줄을 넣어 주세요. 코드가 처음 신호를 보내면 위 홈페이지에 ‘설치 확인됨’이 떠요.
        </p>
        <pre className="snippet"><code>{snippet}</code></pre>
        <CopyButton text={snippet} label="코드 복사" />
        <form action={updateThankYou} style={{ marginTop: 16 }}>
          <label htmlFor="thank-you">
            문의 완료 페이지 주소 <span className="hint">폼을 자동으로 못 찾는 홈페이지(아임웹·식스샵, 게시판형 문의)만. 이 페이지에 도착하면 문의 1건으로 세요.</span>
          </label>
          <div className="row">
            <input id="thank-you" name="thank_you_url" type="url" defaultValue={workspace.thank_you_url ?? ''} placeholder="https://example.com/thanks" />
            <button>저장</button>
          </div>
        </form>
        {sites.length > 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>
            내 방문은 집계에서 빼기: 이 브라우저로{' '}
            {sites.map((s, i) => (
              <span key={s.id}>{i > 0 && ', '}<a href={`https://${s.domain}/?atk_exclude=1`} target="_blank" rel="noreferrer">{s.domain}</a></span>
            ))}{' '}
            을(를) 한 번 열어 주세요.
          </p>
        )}
      </section>

      <section className="card">
        <h2>상담 유형</h2>
        <ul className="list">
          {types.map((t) => (
            <li key={t.id}>
              <span>{t.name}</span>
              <form action={removeInquiryType}>
                <input type="hidden" name="id" value={t.id} />
                <button className="danger">지우기</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addInquiryType} className="row" style={{ marginTop: 12 }}>
          <input name="name" placeholder="새 상담 유형" aria-label="새 상담 유형" maxLength={30} required />
          <button>추가</button>
        </form>
      </section>

      <section className="card">
        <h2>사용자</h2>
        <ul className="list">
          {members.map((m) => (
            <li key={m.id}>
              <span>
                {m.name || m.email}
                {m.name && <><br /><span className="muted">{m.email}</span></>}
              </span>
              <span className="row">
                <span className="badge">{m.role === 'admin' ? '관리자' : '직원'}</span>
                {m.id !== member.id && (
                  <form action={removeMember}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="danger">삭제</button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>

        {invites.length > 0 && (
          <>
            <h2 style={{ marginTop: 16 }}>보낸 초대</h2>
            <ul className="list">
              {invites.map((i) => (
                <li key={i.id}>
                  <span>
                    {i.email} <span className="badge">{i.role === 'admin' ? '관리자' : '직원'}</span>
                    <br />
                    <span className="muted">
                      {new Date(i.expires_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}까지
                    </span>
                  </span>
                  <span className="row">
                    <CopyButton text={`${origin}/invite/${i.token}`} label="링크 복사" />
                    <form action={cancelInvite}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="danger">취소</button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <form action={inviteMember} style={{ marginTop: 12 }}>
          <label htmlFor="invite-email">직원 초대 <span className="hint">링크를 만들어 카톡·문자로 보내요 (7일간 유효)</span></label>
          <div className="row">
            <input id="invite-email" name="email" type="email" placeholder="staff@example.com" required />
            <select name="role" aria-label="역할" style={{ flex: '0 0 auto', width: 'auto' }}>
              <option value="staff">직원</option>
              <option value="admin">관리자</option>
            </select>
          </div>
          <button className="full">초대 링크 만들기</button>
        </form>
      </section>
    </>
  );
}
