import Link from 'next/link';
import { requireMember } from '@/lib/session';
import type { InboxOptions } from '@/lib/leads';
import { Messages } from '../../../messages';
import { createLead } from '../actions';
import { SourcePicker } from './source-picker';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

// 전화·방문·지인 소개 문의 직접 등록
export default async function NewLeadPage({ searchParams }: Props) {
  const { error, name = '', phone = '', method = 'call', channel = '', coupon = '', inquiry_type = '' } = await searchParams;
  const { db } = await requireMember();
  const options = await db.rpc<InboxOptions>('inbox_options');
  return (
    <>
      <p><Link href="/app/inquiries">← 문의함</Link></p>
      <h1>문의 직접 등록</h1>
      <form action={createLead} className="card">
        <Messages error={error} />
        <label>문의 방식</label>
        <div className="chips" role="radiogroup" aria-label="문의 방식">
          {[['call', '전화'], ['walkin', '방문'], ['etc', '기타']].map(([v, label]) => (
            <label key={v} className="chip">
              <input type="radio" name="method" value={v} defaultChecked={method === v} /> {label}
            </label>
          ))}
        </div>
        <label htmlFor="name">이름</label>
        <input id="name" name="name" defaultValue={name} maxLength={50} autoComplete="off" />
        <label htmlFor="phone">연락처</label>
        <input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={phone} placeholder="010-1234-5678" autoComplete="off" />
        <label htmlFor="inquiry_type">상담 유형</label>
        <select id="inquiry_type" name="inquiry_type" defaultValue={inquiry_type}>
          <option value="">고르기</option>
          {options.inquiry_types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <SourcePicker channels={options.channels} channel={channel} coupon={coupon} />
        <button className="full">등록</button>
      </form>
    </>
  );
}
