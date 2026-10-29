'use client';

import { useState } from 'react';
import type { InboxChannel } from '@/lib/leads';

// ‘어떻게 알고 오셨어요?’ + 쿠폰·암호 문구. 문구가 채널에 등록돼 있으면 그 채널을 자동으로 고른다.
// (서버도 같은 규칙으로 다시 확인한다)
export function SourcePicker({ channels, channel, coupon }: { channels: InboxChannel[]; channel: string; coupon: string }) {
  const [selected, setSelected] = useState(channel);
  const [code, setCode] = useState(coupon);
  const normalized = code.trim().toLowerCase();
  const matched = normalized
    ? channels.find((c) => c.coupon_codes.some((x) => x.trim().toLowerCase() === normalized))
    : undefined;
  const value = matched?.id ?? selected;

  return (
    <>
      <label htmlFor="coupon">쿠폰·암호 문구 <span className="hint">예: “블로그 보고 왔어요”, INSTA10</span></label>
      <input id="coupon" name="coupon" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
      {matched && <p className="notice small">쿠폰 문구로 ‘{matched.name}’ 이(가) 선택됐어요</p>}

      <label htmlFor="channel_id">어떻게 알고 오셨어요? <span className="hint">필수</span></label>
      <select id="channel_id" name="channel_id" value={value} onChange={(e) => setSelected(e.target.value)} required={!matched} disabled={Boolean(matched)}>
        <option value="">고르기</option>
        {channels.filter((c) => !c.hidden || c.id === value).map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </>
  );
}
