// 테스트용 홈페이지 3종. 하나의 서버가 Host 헤더로 구분해 응답한다.
//   html.adtrack.test     일반 HTML 폼 (연락처 3칸 나뉨, 일반 POST 제출로 페이지 이동)
//   wp.adtrack.test       워드프레스 Contact Form 7 모양 (제출을 막고 fetch 로 보냄, 헤더에 검색창)
//   builder.adtrack.test  빌더형(아임웹 모양): <form> 없이 div 입력칸 → 저장 후 /thanks 로 이동
import http from 'node:http';

const page = (title, body, trackerSrc) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${title}</title>
<script async src="${trackerSrc}"></script>
</head><body>${body}</body></html>`;

function htmlSite(path, tracker) {
  if (path === '/') return page('바른 법률사무소', '<h1>바른 법률사무소</h1><a id="go" href="/contact.html">상담 신청</a>', tracker);
  if (path === '/contact.html') {
    return page('상담 신청', `
      <h1>상담 신청</h1>
      <form method="post" action="/submitted">
        <table>
          <tr><th>이름</th><td><input type="text" name="wr_name"></td></tr>
          <tr><th>연락처</th><td>
            <select name="hp1"><option>010</option><option>011</option></select>
            - <input type="text" name="hp2" size="4"> - <input type="text" name="hp3" size="4">
          </td></tr>
          <tr><th>상담 분야</th><td><select name="ca_name"><option>이혼</option><option>형사</option></select></td></tr>
          <tr><th>내용</th><td><textarea name="wr_content"></textarea></td></tr>
        </table>
        <button type="submit" id="submit">신청하기</button>
      </form>`, tracker);
  }
  if (path === '/submitted') return page('접수', '<p id="done">접수되었습니다</p>', tracker);
  return null;
}

function wpSite(path, tracker) {
  const header = `<header><form role="search" method="get" action="/"><input type="search" name="s" id="s"><button id="search">검색</button></form></header>`;
  if (path === '/') return page('미소 치과', `${header}<h1>미소 치과</h1><a id="go" href="/contact/">온라인 상담</a>`, tracker);
  if (path === '/contact/') {
    return page('온라인 상담', `${header}
      <div class="wpcf7" id="wpcf7-f12-p34-o1">
        <form action="/contact/#wpcf7-f12-p34-o1" method="post" class="wpcf7-form init" novalidate>
          <p><label> 성함 (필수)<br><span class="wpcf7-form-control-wrap" data-name="your-name"><input type="text" name="your-name" class="wpcf7-form-control wpcf7-text"></span></label></p>
          <p><label> 휴대폰 번호<br><span class="wpcf7-form-control-wrap" data-name="your-tel"><input type="tel" name="your-tel" class="wpcf7-form-control wpcf7-tel"></span></label></p>
          <p><label> 이메일<br><span class="wpcf7-form-control-wrap"><input type="email" name="your-email"></span></label></p>
          <p><label> 진료 항목<br><span class="wpcf7-form-control-wrap"><select name="menu-512"><option>임플란트</option><option>교정</option></select></span></label></p>
          <p><label> 문의 내용<br><textarea name="your-message"></textarea></label></p>
          <p><input type="submit" value="보내기" id="submit" class="wpcf7-form-control wpcf7-submit"></p>
          <div class="wpcf7-response-output" aria-hidden="true"></div>
        </form>
      </div>
      <script>
        // Contact Form 7 처럼: 원래 제출을 막고 REST API 로 보낸다
        document.querySelector('.wpcf7-form').addEventListener('submit', function (e) {
          e.preventDefault();
          fetch('/wp-json/contact-form-7/v1/contact-forms/12/feedback', { method: 'POST', body: new FormData(e.target) })
            .then(function () { document.querySelector('.wpcf7-response-output').textContent = '메시지가 전송되었습니다.'; });
        });
      </script>`, tracker);
  }
  return null;
}

function builderSite(path, tracker) {
  if (path === '/') return page('하늘 인테리어', '<h1>하늘 인테리어</h1><a id="go" href="/consult">견적 문의</a>', tracker);
  if (path === '/consult') {
    return page('견적 문의', `
      <div class="_form_wrap">
        <div class="form-group"><div class="label">이름</div><input type="text" id="inp_name" class="form-control"></div>
        <div class="form-group"><div class="label">연락처</div><input type="text" id="inp_phone" class="form-control"></div>
        <div class="btn" id="submit" role="button">문의하기</div>
      </div>
      <script>
        document.getElementById('submit').addEventListener('click', function () {
          fetch('/backpg/post_form.cm', { method: 'POST', body: JSON.stringify({ n: document.getElementById('inp_name').value }) })
            .then(function () { location.href = '/thanks'; });
        });
      </script>`, tracker);
  }
  if (path === '/thanks') return page('문의 완료', '<p id="done">문의가 접수되었어요</p>', tracker);
  return null;
}

const SITES = { html: htmlSite, wp: wpSite, builder: builderSite };

export function startSites(port, trackerSrc) {
  const server = http.createServer((req, res) => {
    const kind = (req.headers.host ?? '').split('.')[0];
    const site = SITES[kind];
    const path = new URL(req.url, 'http://x').pathname;
    // 폼이 POST 하는 곳(원래 사이트의 처리)은 내용을 버리고 성공으로 답한다
    if (req.method === 'POST' && path !== '/submitted') {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"mail_sent"}');
      return;
    }
    if (req.method === 'POST') req.resume();
    const html = site?.(path, trackerSrc);
    if (!html) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
