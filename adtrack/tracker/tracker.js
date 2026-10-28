// 고객 홈페이지에 넣는 추적 코드. 의존성 없음, 압축 후 5KB 이하.
// 서버(/t/<추적키>.js)가 맨 끝의 __ATK_CONFIG__ 를 사업장 설정 JSON 으로 바꿔서 내려준다.
//   cfg.k            추적 키
//   cfg.e            수집 API 주소
//   cfg.thankYouUrl  문의 완료 페이지 주소 (폼을 못 찾는 사이트용, 없으면 null)
//   cfg.fields       { name, phone, type } 직접 고른 칸의 CSS 선택자 (없으면 자동 추측)
(function (cfg) {
  var d = document;
  var loc = location;
  var PREFIX = '_atk_';
  var TAGS = ['n_media', 'n_query', 'n_rank', 'n_ad_group', 'n_ad', 'n_keyword_id', 'n_keyword', 'n_campaign_type',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];
  var now = function () { return Math.floor(Date.now() / 1000); };
  var cookieDomain = findCookieDomain();

  // ─── 쿠키 ──────────────────────────────────────────────
  function getC(name) {
    var m = d.cookie.match('(?:^|; )' + PREFIX + name + '=([^;]*)');
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
  }
  function setC(name, value, days, domain) {
    d.cookie = PREFIX + name + '=' + encodeURIComponent(JSON.stringify(value)) + '; path=/; max-age=' +
      Math.round(days * 86400) + '; SameSite=Lax' + (loc.protocol === 'https:' ? '; Secure' : '') +
      ((domain || cookieDomain) ? '; domain=' + (domain || cookieDomain) : '');
  }
  // www.example.co.kr 와 m.example.co.kr 가 같은 쿠키를 쓰도록, 브라우저가 받아 주는 가장 위 도메인을 찾는다
  function findCookieDomain() {
    var parts = loc.hostname.split('.');
    if (parts.length < 2 || /^[\d.]+$/.test(loc.hostname)) return '';
    for (var i = parts.length - 2; i > 0; i--) {
      var cand = parts.slice(i).join('.');
      setC('d', 1, 1 / 1440, cand);
      if (getC('d')) { setC('d', 1, -1, cand); return cand; }
    }
    return '';
  }

  // ─── 보내기 ─────────────────────────────────────────────
  function send(type, data) {
    data.type = type;
    data.k = cfg.k;
    data.h = loc.hostname;
    data.v = visitor;
    var body = JSON.stringify(data);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(cfg.e, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) { /* 아래 fetch 로 */ }
    try { fetch(cfg.e, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' }); } catch (e) { /* 포기 */ }
  }

  // ─── 관리자 본인 브라우저 제외 ─────────────────────────────
  var params = new URLSearchParams(loc.search);
  if (params.get('atk_exclude') === '1') { setC('x', 1, 3650); alert('이 브라우저의 방문과 문의는 이제 집계에서 빠져요.'); }
  if (params.get('atk_exclude') === '0') { setC('x', 0, -1); alert('이 브라우저도 다시 집계해요.'); }
  if (getC('x')) return;

  window.__atk = cfg.k; // 설치 확인용 (개발자 도구에서 __atk 입력)
  var visitor = getC('v') || Math.random().toString(36).slice(2) + now().toString(36);
  setC('v', visitor, 90);

  // ─── 방문 시: 꼬리표와 유입 주소 저장 ───────────────────────
  var tags = {};
  var tagged = false;
  for (var i = 0; i < TAGS.length; i++) {
    var val = params.get(TAGS[i]);
    if (val) { tags[TAGS[i]] = val.slice(0, 200); tagged = true; }
  }
  var ref = '';
  try {
    var r = d.referrer && new URL(d.referrer);
    var internal = r && (r.hostname === loc.hostname || (cookieDomain && ('.' + r.hostname).slice(-cookieDomain.length - 1) === '.' + cookieDomain));
    if (r && !internal) ref = (r.origin + r.pathname).slice(0, 300);
  } catch (e) { /* 잘못된 referrer */ }

  var first = getC('f');
  var last = getC('l');
  if (tagged || ref) {
    var touch = { t: tags, r: ref || undefined, p: loc.pathname.slice(0, 200), ts: now() };
    if (!first) setC('f', first = touch, 90);
    // 꼬리표 없는 재방문은 꼬리표 있는 마지막 광고 유입을 덮어쓰지 않는다
    if (tagged || !last || !hasTags(last)) setC('l', last = touch, 90);
    if (tagged) send('visit', { touch: touch });
  } else if (!first) {
    setC('f', first = { t: {}, p: loc.pathname.slice(0, 200), ts: now() }, 90);
  }
  function hasTags(t) { for (var k in t.t || {}) return true; return false; }

  // 하루 한 번 설치 확인 신호
  if (!getC('h')) { setC('h', 1, 1); send('hello', {}); }

  // ─── 폼 제출 ────────────────────────────────────────────
  var PHONE = /phone|tel|mobile|cell|hp|휴대|핸드폰|전화|연락처|번호/i;
  var NAME = /name|이름|성함|성명|고객명|신청자|작성자|담당자/i;
  var NOT_NAME = /company|회사|업체|상호|nick|user_?id|login|file|subject|제목/i;
  var TYPE = /유형|분야|종류|과목|항목|진료|category|type|kind|상담|문의/i;

  function describe(el) {
    var text = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.autocomplete, el.title].join(' ');
    if (el.labels && el.labels[0]) text += ' ' + el.labels[0].textContent;
    else if (el.closest) {
      var wrap = el.closest('label, p, li, tr, .form-group, .field, div');
      var label = wrap && wrap.querySelector('label, th, dt, .label');
      if (label && label !== el) text += ' ' + label.textContent;
    }
    return text.slice(0, 300);
  }

  function pick(root, selector) {
    var el = selector && d.querySelector(selector);
    if (!el) return '';
    return el.tagName === 'SELECT' ? (el.options[el.selectedIndex] || {}).text || '' : el.value || '';
  }

  function readForm(form) {
    if (cfg.fields && cfg.fields.phone) {
      return { name: pick(form, cfg.fields.name), phone: pick(form, cfg.fields.phone), itype: pick(form, cfg.fields.type) };
    }
    var name = '';
    var phone = '';
    var itype = '';
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var tag = el.tagName;
      var type = (el.type || '').toLowerCase();
      if (tag === 'TEXTAREA' || tag === 'BUTTON' || /hidden|submit|button|checkbox|file|password|email|date/.test(type)) continue;
      if (type === 'radio' && !el.checked) continue;
      var value = tag === 'SELECT' ? ((el.options[el.selectedIndex] || {}).text || '') : (el.value || '');
      value = value.trim();
      if (!value) continue;
      var desc = describe(el);
      // 010 / 1234 / 5678 처럼 나뉜 칸은 이어 붙인다
      if (type === 'tel' || (PHONE.test(desc) && /^[\d\s+()-]+$/.test(value))) { phone += value; continue; }
      if (!name && type !== 'radio' && tag !== 'SELECT' && NAME.test(desc) && !NOT_NAME.test(desc)) { name = value; continue; }
      if (!itype && (tag === 'SELECT' || type === 'radio') && TYPE.test(desc)) itype = value;
    }
    return { name: name.slice(0, 50), phone: phone.slice(0, 30), itype: itype.slice(0, 50) };
  }

  d.addEventListener('submit', function (e) {
    try {
      var form = e.target;
      if (!form || !form.elements || form.querySelector('input[type=password]')) return;
      var data = readForm(form);
      if (data.phone.replace(/\D/g, '').length < 9) return; // 문의폼이 아님 (검색창, 뉴스레터 등)
      send('lead', { d: data, f: first, l: last });
      setC('s', now(), 1 / 24);
    } catch (err) { /* 원래 폼 제출은 절대 막지 않는다 */ }
  }, true);

  // ─── 문의 완료 페이지 방식 ──────────────────────────────────
  function samePage(url) {
    try {
      var u = new URL(url, loc.href);
      var strip = function (h) { return h.replace(/^www\./, ''); };
      var path = function (p) { return p.replace(/\/+$/, '') || '/'; };
      return strip(u.hostname) === strip(loc.hostname) && path(u.pathname) === path(loc.pathname);
    } catch (e) { return false; }
  }
  if (cfg.thankYouUrl && samePage(cfg.thankYouUrl)) {
    var t = now();
    // 방금 폼으로 이미 보냈거나, 새로고침이면 다시 세지 않는다
    if (!(getC('s') > t - 1800) && !(getC('ty') > t - 1800)) {
      setC('ty', t, 1 / 48);
      send('lead', { d: {}, f: first, l: last, ty: 1 });
    }
  }
})(__ATK_CONFIG__);
