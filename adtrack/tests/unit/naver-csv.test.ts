import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CsvError, checkPeriod, joinParenCells, parseDelimited, parseNaverKeywordCsv, parseNumber } from '../../src/lib/naver-csv.ts';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/naver/${name}`, import.meta.url)));

test('다차원 보고서 (UTF-8 BOM, 제목 줄, 따옴표 숫자, 합계 줄)', () => {
  const r = parseNaverKeywordCsv(fixture('multidim-utf8bom.csv'));
  assert.equal(r.costColumn, '총비용(VAT포함,원)');
  assert.deepEqual(r.period, { from: '2026-09-01', to: '2026-09-30' }, '다운로드 일시는 기간이 아님');
  assert.deepEqual(r.rows, [
    { keyword: '이혼전문변호사', amount: 542340, clicks: 361, impressions: 14345 }, // 광고그룹 두 줄 합침
    { keyword: '형사변호사', amount: 346500, clicks: 150, impressions: 8700 },
    { keyword: '재산분할, 위자료', amount: 87120, clicks: 88, impressions: 5100 },
    { keyword: '음주운전변호사', amount: 0, clicks: 0, impressions: 300 },
  ]);
  assert.equal(r.total, 975960, '파일의 합계 줄과 같다');
  assert.equal(r.skipped, 1);
  assert.equal(checkPeriod(r.period, '2026-09'), null);
  assert.match(checkPeriod(r.period, '2026-10')!, /고른 달\(2026-10\)과 달라요/);
});

test('키워드 목록 다운로드 (EUC-KR, 머리글 띄어쓰기 다름)', () => {
  const r = parseNaverKeywordCsv(fixture('keywords-euckr.csv'));
  assert.equal(r.costColumn, '총비용(VAT 포함, 원)', '평균 클릭비용 칸이 아니라 총비용');
  assert.deepEqual(r.rows.map((x) => [x.keyword, x.amount]), [['강남임플란트', 161700], ['투명교정', 91800]]);
  assert.equal(r.period, null);
});

test('일별 보고서 (탭 구분, 날짜별 줄 합치기, 소수점)', () => {
  const r = parseNaverKeywordCsv(fixture('daily-tab.csv'));
  assert.deepEqual(r.period, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(r.rows, [
    { keyword: '투명교정', amount: 9000, clicks: 5, impressions: 180 },
    { keyword: '강남임플란트', amount: 2100, clicks: 1, impressions: 50 },
  ]);
});

test('여러 달이 섞인 파일은 막는다', () => {
  const r = parseNaverKeywordCsv(fixture('daily-two-months.csv'));
  assert.match(checkPeriod(r.period, '2026-09')!, /여러 달/);
});

test('읽을 수 없는 파일은 이유와 찾은 칸을 알려 준다', () => {
  assert.throws(() => parseNaverKeywordCsv(fixture('no-cost.csv')), (e: unknown) =>
    e instanceof CsvError && /비용 칸/.test(e.message) && /키워드, 노출수, 클릭수/.test(e.message));
  assert.throws(() => parseNaverKeywordCsv(new TextEncoder().encode('캠페인,광고그룹\na,b\n')), /‘키워드’ 칸을 찾지 못했어요/);
  assert.throws(() => parseNaverKeywordCsv(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), /엑셀/);
  assert.throws(() => parseNaverKeywordCsv(new Uint8Array()), /빈 파일/);
  assert.throws(() => parseNaverKeywordCsv(new TextEncoder().encode('키워드,총비용\n합계,100\n')), /키워드 줄이 없어요/);
});

test('CSV 쪼개기와 숫자', () => {
  assert.deepEqual(parseDelimited('a,"b,c","d ""e"""\r\n1,2,3\n', ','), [['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
  assert.deepEqual(parseDelimited('a,"줄\n바꿈"\n', ','), [['a', '줄\n바꿈']]);
  assert.equal(parseNumber('"1,234"'), 1234);
  assert.equal(parseNumber('1,540원'), 1540);
  assert.equal(parseNumber('-'), null);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('2.60'), 2.6);
});

test('따옴표 있는 머리글과 없는 머리글 모두 같은 칸으로 읽는다', () => {
  assert.deepEqual(joinParenCells(['키워드', '총비용(VAT포함', '원)', '클릭수']), ['키워드', '총비용(VAT포함,원)', '클릭수']);
  assert.deepEqual(joinParenCells(['키워드', '총비용(VAT포함,원)']), ['키워드', '총비용(VAT포함,원)']);
  const quoted = parseNaverKeywordCsv(new TextEncoder().encode('키워드,"평균클릭비용(VAT포함,원)","총비용(VAT포함,원)",클릭수\n투명교정,"1,800","91,800",51\n'));
  assert.deepEqual(quoted.rows, [{ keyword: '투명교정', amount: 91800, clicks: 51, impressions: null }]);
  const bare = parseNaverKeywordCsv(new TextEncoder().encode('키워드,평균클릭비용(VAT포함,원),총비용(VAT포함,원),클릭수\n투명교정,1800,91800,51\n'));
  assert.deepEqual(bare.rows, quoted.rows);
});
