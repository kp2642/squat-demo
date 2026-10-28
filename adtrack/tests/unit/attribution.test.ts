import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attribute, chooseTouch } from '../../src/lib/attribution.ts';

test('규칙 1: n_keyword 또는 n_media → 네이버 검색광고', () => {
  const s = attribute({ t: { n_media: '27758', n_query: '이혼변호사', n_keyword: '이혼전문변호사', n_rank: '2', n_ad_group: 'grp-a001' } });
  assert.equal(s.rule, 1);
  assert.equal(s.code, 'naver_sa');
  assert.equal(s.keyword, '이혼전문변호사');
  assert.equal(s.ad_group, 'grp-a001');
  assert.equal(s.rank, '2');
  assert.equal(s.evidence, 'n_keyword=이혼전문변호사');
  // 키워드 없이 n_media 만 있어도
  assert.equal(attribute({ t: { n_media: '27758' } }).code, 'naver_sa');
  // 네이버 꼬리표가 utm 보다 먼저
  assert.equal(attribute({ t: { n_media: '1', utm_source: 'google' } }).rule, 1);
});

test('규칙 2: utm_source → 사업장 매핑표 (DB 가 채널 결정)', () => {
  const s = attribute({ t: { utm_source: 'Meta', utm_campaign: '가을이벤트', utm_content: '영상A', utm_term: '교정' } });
  assert.equal(s.rule, 2);
  assert.equal(s.code, null);
  assert.equal(s.utm_source, 'meta');
  assert.equal(s.campaign, '가을이벤트');
  assert.equal(s.ad_content, '영상A');
  assert.equal(s.keyword, '교정');
  assert.equal(s.evidence, 'utm_source=meta, utm_campaign=가을이벤트');
  // utm 이 클릭 ID 보다 먼저
  assert.equal(attribute({ t: { utm_source: 'kakao', gclid: 'x' } }).rule, 2);
});

test('규칙 3·4: gclid → 구글 광고, fbclid → 메타 광고', () => {
  assert.equal(attribute({ t: { gclid: 'Cj0KCQ' } }).code, 'google_ads');
  assert.equal(attribute({ t: { fbclid: 'IwAR3' } }).code, 'meta_ads');
  assert.equal(attribute({ t: { gclid: 'a', fbclid: 'b' } }).code, 'google_ads');
});

test('규칙 5: 블로그·카페 유입 주소', () => {
  for (const r of [
    'https://blog.naver.com/lawyer_kim/2233',
    'https://m.blog.naver.com/lawyer_kim',
    'https://cafe.naver.com/momcafe',
    'https://someone.tistory.com/12',
    'https://brunch.co.kr/@x/1',
  ]) {
    assert.equal(attribute({ t: {}, r }).code, 'blog', r);
  }
});

test('규칙 6: 검색엔진 유입 주소', () => {
  const cases: [string, string][] = [
    ['https://search.naver.com/search.naver', '네이버'],
    ['https://m.search.naver.com/search.naver', '네이버'],
    ['https://www.google.com/', '구글'],
    ['https://www.google.co.kr/', '구글'],
    ['https://search.daum.net/search', '다음'],
    ['https://www.bing.com/search', '빙'],
  ];
  for (const [r, engine] of cases) {
    const s = attribute({ t: {}, r });
    assert.equal(s.code, 'organic', r);
    assert.equal(s.engine, engine);
  }
});

test('규칙 7: 아무것도 없음 → 직접 방문', () => {
  assert.equal(attribute({ t: {} }).code, 'direct');
  assert.equal(attribute(null).code, 'direct');
  assert.equal(attribute({ t: {}, r: 'not a url' }).code, 'direct');
});

test('다른 사이트에서 왔지만 맞는 규칙이 없으면 출처 미확인', () => {
  const s = attribute({ t: {}, r: 'https://some-portal.example/list' });
  assert.equal(s.rule, null);
  assert.equal(s.code, null);
  assert.match(s.evidence, /some-portal\.example/);
});

test('출처 기준은 마지막 광고 유입, 없으면 첫 유입', () => {
  const first = { t: {}, r: 'https://blog.naver.com/x' };
  const last = { t: { gclid: 'g' } };
  assert.equal(chooseTouch(first, last), last);
  assert.equal(chooseTouch(first, null), first);
  assert.equal(chooseTouch(null, null), null);
});
