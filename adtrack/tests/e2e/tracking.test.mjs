// 2단계 완료 기준: 테스트용 홈페이지 3종(일반 HTML 폼, 워드프레스, 빌더형)에서
// 꼬리표 7가지 경우가 모두 올바른 채널로 들어옴.
// 실제 Chromium 으로 홈페이지에 들어가 추적 코드가 쿠키를 남기고, 폼 제출 때 수집 API → DB 까지 가는지 본다.
// scripts/test-e2e.sh 가 마이그레이션을 적용한 DB 와 함께 실행한다. 먼저 npm run build 가 필요하다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { chromium } from 'playwright';
import { startSites } from './sites.mjs';

process.env.LEAD_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString('base64');
const { decrypt, phoneHash } = await import('../../src/lib/crypto.ts');

const APP_PORT = 3210;
const SITE_PORT = 4210;
const APP = `http://127.0.0.1:${APP_PORT}`;
const site = (kind, path = '/') => `http://${kind}.adtrack.test:${SITE_PORT}${path}`;

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
let app;
let sites;
let browser;
let ws;
let key;
const siteIds = {};

// 꼬리표 7가지 (요구사항 문서의 출처 판별 규칙표 순서)
const CASES = [
  { name: '1 네이버 검색광고', query: '?n_media=27758&n_query=%EC%9D%B4%ED%98%BC&n_rank=2&n_ad_group=grp-a001&n_ad=nad-a001&n_keyword_id=nkw-a001&n_keyword=%EC%9D%B4%ED%98%BC%EC%A0%84%EB%AC%B8%EB%B3%80%ED%98%B8%EC%82%AC&n_campaign_type=1', code: 'naver_sa', evidence: 'n_keyword=이혼전문변호사', keyword: '이혼전문변호사' },
  { name: '2 utm_source 매핑 (kakao)', query: '?utm_source=kakao&utm_medium=display&utm_campaign=fall_event&utm_content=banner_a', code: 'kakao_ads', evidence: 'utm_source=kakao, utm_campaign=fall_event', campaign: 'fall_event' },
  { name: '3 구글 gclid', query: '?gclid=Cj0KCQjw-test', code: 'google_ads', evidence: /^gclid=/ },
  { name: '4 메타 fbclid', query: '?fbclid=IwAR3-test', code: 'meta_ads', evidence: /^fbclid=/ },
  { name: '5 블로그 유입', referer: 'https://blog.naver.com/lawyer_kim/223344', code: 'blog', evidence: '유입 주소 blog.naver.com' },
  { name: '6 검색엔진 유입', referer: 'https://search.naver.com/search.naver?query=%EB%B3%80%ED%98%B8%EC%82%AC', code: 'organic', evidence: /검색엔진 네이버/ },
  { name: '7 직접 방문', code: 'direct', evidence: '꼬리표·유입 주소 없음' },
];

async function waitFor(fn, what, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`${what} 을(를) 기다리다 시간 초과`);
    await sleep(100);
  }
}

const leadWithChannel = (where, params) => db.query(`
  select l.*, c.code as channel_code from public.leads l left join public.channels c on c.id = l.channel_id
  where l.workspace_id = $1 and ${where} order by l.created_at desc limit 1`, [ws, ...params]).then((r) => r.rows[0]);

// 사이트별로 상담 화면에서 폼을 채우고 제출
const SUBMIT = {
  async html(page, { name, phone }) {
    const [, mid, last] = phone.split('-');
    await page.fill('input[name=wr_name]', name);
    await page.fill('input[name=hp2]', mid);
    await page.fill('input[name=hp3]', last);
    await page.selectOption('select[name=ca_name]', '형사');
    await page.fill('textarea', '상담 받고 싶어요');
    await Promise.all([page.waitForURL('**/submitted'), page.click('#submit')]);
    // 원래 폼 제출이 막히지 않았다
    assert.equal(await page.textContent('#done'), '접수되었습니다');
  },
  async wp(page, { name, phone }) {
    await page.fill('input[name=your-name]', name);
    await page.fill('input[name=your-tel]', phone);
    await page.fill('input[name=your-email]', 'a@example.com');
    await page.selectOption('select[name=menu-512]', '교정');
    await page.click('#submit');
    await page.waitForSelector('text=메시지가 전송되었습니다.');
  },
  async builder(page, { name, phone }) {
    await page.fill('#inp_name', name);
    await page.fill('#inp_phone', phone);
    await Promise.all([page.waitForURL('**/thanks'), page.click('#submit')]);
    await page.waitForFunction(() => window.__atk);
  },
};
const CONTACT_PATH = { html: '/contact.html', wp: '/contact/', builder: '/consult' };

let phoneSeq = 1000;
const nextPhone = () => `010-5555-${phoneSeq++}`;

// 광고 주소로 들어와 → 안쪽 상담 화면으로 이동 → 문의 제출. 저장된 문의를 돌려준다.
async function visitAndSubmit(kind, { query = '', referer } = {}, opts = {}) {
  const context = opts.context ?? (await browser.newContext());
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  const started = new Date();
  await page.goto(site(kind, `/${query}`), referer ? { referer } : {});
  await page.waitForFunction(() => window.__atk);
  await Promise.all([page.waitForURL(`**${CONTACT_PATH[kind]}`), page.click('#go')]);
  await page.waitForFunction(() => window.__atk);
  const form = { name: `고객${phoneSeq}`, phone: opts.phone ?? nextPhone() };
  await SUBMIT[kind](page, form);

  const lead = kind === 'builder'
    ? await waitFor(() => leadWithChannel('l.site_id = $2 and l.created_at >= $3', [siteIds[kind], started]), '문의')
    : await waitFor(() => leadWithChannel('l.phone_hash = $2', [phoneHash(form.phone.replace(/\D/g, ''))]), '문의');
  if (!opts.context) await context.close();
  return { lead, form, page };
}

before(async () => {
  await db.connect();
  const owner = { id: randomUUID(), email: `e2e-${Date.now()}@example.com` };
  await db.query('insert into auth.users (id, email) values ($1, $2)', [owner.id, owner.email]);
  await db.query('begin');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.id]);
  await db.query('set local role authenticated');
  ws = (await db.query("select public.create_workspace('E2E', 'legal', array['html.adtrack.test', 'wp.adtrack.test', 'builder.adtrack.test']) as id")).rows[0].id;
  await db.query('commit');
  await db.query("update public.workspaces set thank_you_url = 'https://builder.adtrack.test/thanks' where id = $1", [ws]);
  key = (await db.query('select tracking_key from public.workspaces where id = $1', [ws])).rows[0].tracking_key;
  for (const r of (await db.query('select id, domain from public.sites where workspace_id = $1', [ws])).rows) {
    siteIds[r.domain.split('.')[0]] = r.id;
  }

  app = spawn('node_modules/.bin/next', ['start', '-p', String(APP_PORT)], {
    detached: true, // 끝날 때 next-server 자식 프로세스까지 한꺼번에 끄기 위해
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let appLog = '';
  app.stdout.on('data', (b) => { appLog += b; });
  app.stderr.on('data', (b) => { appLog += b; });
  await waitFor(() => fetch(`${APP}/t/${key}.js`).then((r) => r.ok).catch(() => false), `서비스 시작\n${appLog}`, 60000);

  sites = await startSites(SITE_PORT, `${APP}/t/${key}.js`);
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.adtrack.test 127.0.0.1'] });
});

after(async () => {
  await browser?.close();
  sites?.close();
  if (app) process.kill(-app.pid);
  await db.end();
});

for (const kind of ['html', 'wp', 'builder']) {
  for (const c of CASES) {
    test(`${kind} 사이트 · ${c.name} → ${c.code}`, async () => {
      const { lead, form } = await visitAndSubmit(kind, c);
      assert.equal(lead.channel_code, c.code);
      assert.equal(lead.attribution, 'auto');
      assert.equal(lead.method, 'form');
      if (c.evidence instanceof RegExp) assert.match(lead.evidence, c.evidence);
      else assert.equal(lead.evidence, c.evidence);
      if (c.keyword) assert.equal(lead.keyword, c.keyword);
      if (c.campaign) assert.equal(lead.campaign, c.campaign);

      if (kind === 'builder') {
        // 완료 페이지 방식: 이름·연락처는 비워 두고 직원이 채운다
        assert.equal(lead.name_enc, null);
        assert.equal(lead.phone_enc, null);
      } else {
        assert.equal(decrypt(lead.name_enc), form.name);
        assert.equal(decrypt(lead.phone_enc).replace(/\D/g, ''), form.phone.replace(/\D/g, ''));
        assert.equal(lead.phone_masked, `010-****-${form.phone.slice(-4)}`);
        assert.equal(lead.inquiry_type, kind === 'html' ? '형사' : '교정');
      }
      // 첫 유입도 함께 저장된다
      assert.ok(lead.first_touch);
    });
  }
}

test('추적 코드는 5KB 이하이고 사업장 설정이 들어 있다', async () => {
  const res = await fetch(`${APP}/t/${key}.js`);
  const js = await res.text();
  assert.ok(Buffer.byteLength(js) <= 5 * 1024, `${Buffer.byteLength(js)} bytes`);
  assert.ok(js.includes(key));
  assert.ok(js.includes('builder.adtrack.test/thanks'));
  assert.match(res.headers.get('cache-control'), /max-age=300/);
  assert.equal((await fetch(`${APP}/t/tk_${'0'.repeat(32)}.js`)).status, 404);
});

test('추적 코드가 신호를 보내면 사이트가 설치 확인됨으로 바뀌고, 꼬리표 방문이 기록된다', async () => {
  const r = await db.query('select domain, verified_at from public.sites where workspace_id = $1', [ws]);
  assert.ok(r.rows.every((s) => s.verified_at), JSON.stringify(r.rows));
  const visits = await db.query("select count(*)::int as n from public.visits where workspace_id = $1 and tags ? 'gclid'", [ws]);
  assert.ok(visits.rows[0].n >= 3);
  // 개인정보는 방문 기록에 없다
  const sample = await db.query('select * from public.visits where workspace_id = $1 limit 1', [ws]);
  assert.deepEqual(Object.keys(sample.rows[0]).sort(), ['created_at', 'id', 'landing', 'referrer', 'site_id', 'tags', 'visitor_id', 'workspace_id']);
});

test('꼬리표 없는 재방문은 마지막 광고 유입을 덮어쓰지 않는다', async () => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto(site('wp', '/?gclid=first-ad'));
  await first.waitForFunction(() => window.__atk);
  await first.close();
  // 며칠 뒤 네이버에서 상호명을 검색해 다시 들어와 문의
  const { lead } = await visitAndSubmit('wp', { referer: 'https://search.naver.com/search.naver?query=x' }, { context });
  assert.equal(lead.channel_code, 'google_ads');
  assert.match(lead.last_touch.t.gclid, /first-ad/);
  await context.close();
});

test('같은 연락처로 다시 문의하면 새 문의 대신 다시 연락으로 기록되고 출처는 첫 문의 것', async () => {
  const phone = nextPhone();
  const { lead: a } = await visitAndSubmit('html', { query: '?fbclid=x' }, { phone });
  const { lead: b } = await visitAndSubmit('wp', { query: '?gclid=y' }, { phone });
  assert.equal(a.id, b.id);
  assert.equal(b.channel_code, 'meta_ads');
  const touches = await waitFor(async () => {
    const r = await db.query('select c.code from public.lead_touches t join public.channels c on c.id = t.channel_id where t.lead_id = $1', [a.id]);
    return r.rows.length ? r.rows : null;
  }, '다시 연락 기록');
  assert.deepEqual(touches, [{ code: 'google_ads' }]);
});

test('검색창 같은 문의폼이 아닌 폼은 무시한다', async () => {
  const before = (await db.query('select count(*)::int as n from public.leads where workspace_id = $1', [ws])).rows[0].n;
  const page = await browser.newPage();
  await page.goto(site('wp', '/?gclid=search'));
  await page.waitForFunction(() => window.__atk);
  await page.fill('#s', '01012345678');
  await Promise.all([page.waitForURL('**/?s=*'), page.click('#search')]);
  await sleep(1000);
  const afterCount = (await db.query('select count(*)::int as n from public.leads where workspace_id = $1', [ws])).rows[0].n;
  assert.equal(afterCount, before);
  await page.close();
});

test('완료 페이지를 새로고침해도 한 번만 센다', async () => {
  const context = await browser.newContext();
  const started = new Date();
  const { page } = await visitAndSubmit('builder', { query: '?gclid=reload' }, { context });
  await page.reload();
  await page.waitForFunction(() => window.__atk);
  await sleep(1000);
  const n = (await db.query('select count(*)::int as n from public.leads where site_id = $1 and created_at >= $2', [siteIds.builder, started])).rows[0].n;
  assert.equal(n, 1);
  await context.close();
});

test('관리자 본인 브라우저 제외', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(site('html', '/?atk_exclude=1'));
  await page.waitForFunction(() => document.cookie.includes('_atk_x'));
  await page.goto(site('html', '/contact.html?gclid=admin'));
  const phone = nextPhone();
  await SUBMIT.html(page, { name: '관리자', phone });
  await sleep(1000);
  const r = await db.query('select 1 from public.leads where phone_hash = $1', [phoneHash(phone.replace(/\D/g, ''))]);
  assert.equal(r.rows.length, 0);
  await context.close();
});

test('다른 홈페이지에서 남의 추적 키로 보내면 거절한다', async () => {
  const res = await fetch(`${APP}/api/collect`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' },
    body: JSON.stringify({ type: 'lead', k: key, h: 'html.adtrack.test', v: 'x', d: { name: '스팸', phone: '010-9999-9999' } }),
  });
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { ok: false, reason: 'unknown_site' });
});
