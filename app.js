import * as SQ from './squat-logic.js?v=44';
import * as PL from './plan.js?v=44';
import * as PU from './pushup-logic.js?v=44';
import * as GM from './goodmorning-logic.js?v=44';
import { NUM, WARMUP, COOLDOWN, PLACE, GX, PLACE_G, STYLE_NAME_, STYLE_NAME, GOAL_NAME, RPE, PARQ, SIDE_KO, iyeyo, PHASE, WEEKS_NOTE, PART_KO, COND_KO } from './data-ko.js?v=44';
import { makeExercises, JUDGED3 } from './exercises.js?v=44';
import * as MV from './move-logic.js?v=44';

const EXERCISES = makeExercises({ pstyle: () => pstyle, counter: () => counter });
let exercise = 'squat', pstyle = 'knees', flow = 'session', session = null;
const EX = () => EXERCISES[exercise];
let CUE_TEXT = SQ.CUE_TEXT, NOREP_TEXT = SQ.NOREP_TEXT;

const MP_BASE = window.MP_BASE || 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL = window.MP_MODEL || 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

const $ = (id) => document.getElementById(id);
const show = (id) => document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
let target = 12, facing = 'user', voice = true, landmarker = null, stream = null, running = false, rafId = 0;
let counter = new SQ.SquatCounter(), cs = null;
let notVisibleSince = 0, lastWarnSpoken = 0, results = [];

function seg(id, onPick) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...$(id).children].forEach(c => c.classList.toggle('sel', c === b));
    onPick(b.dataset.v);
  });
}
seg('target', v => target = +v);
seg('cam', v => facing = v);
let mode = 'relaxed';
seg('mode', v => { mode = v; $('modeNote').textContent = EX().modeNote[v]; });
seg('pstyle', v => pstyle = v);
function applyExercise() {
  const e = EX();
  $('introText').textContent = e.intro;
  $('tipDist').textContent = e.tips[0]; $('tipHeight').textContent = e.tips[1];
  $('modeNote').textContent = e.modeNote[mode];
  $('styleBox').style.display = exercise === 'pushup' || flow === 'session' ? 'block' : 'none';
  document.title = e.name + ' 코치 데모';
}
seg('exercise', v => { exercise = v; applyExercise(); });
applyExercise();

// v29: 한국어 음성 고르기. 고품질(Premium/Enhanced)을 먼저, 고른 음성은 기억
let voicePick = ''; try { voicePick = localStorage.getItem('voiceURI') || ''; } catch {}
const voiceRank = (v) => /premium|프리미엄/i.test(v.name) ? 0 : /enhanced|고품질|향상/i.test(v.name) ? 1 : 2;
function koVoices() { return ('speechSynthesis' in window ? speechSynthesis.getVoices() : []).filter(v => v.lang && /^ko/i.test(v.lang)).sort((a, b) => voiceRank(a) - voiceRank(b)); }
function koVoice() { const vs = koVoices(); return vs.find(v => v.voiceURI === voicePick) || vs[0]; }
function say(text, interrupt = false) {
  if (!voice || !('speechSynthesis' in window)) return;
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR'; u.rate = 1.1; const v = koVoice(); if (v) u.voice = v;
  speechSynthesis.speak(u);
  return u;
}

// 세션에서는 워밍업 동안 미리 불러오므로, 동시에 두 번 불려도 한 번만 만들게 함
let modelP = null;
function loadModel() {
  if (!modelP) modelP = makeModel().catch(e => { modelP = null; throw e; });
  return modelP;
}
async function makeModel() {
  if (landmarker) return landmarker;
  const { FilesetResolver, PoseLandmarker } = await import(MP_BASE + '/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks(MP_BASE + '/wasm');
  const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO', numPoses: 1,
    // v15: 엎드린 자세는 lite 모델이 자주 놓쳐서 full 모델 + 추적 유지 기준 완화
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
  return landmarker;
}

async function start() {
  $('err').style.display = 'none';
  $('startBtn').disabled = true; $('startBtn').textContent = '준비 중...';
  say('', true); // iOS 음성 잠금 해제
  try {
    // 세션 중에는 세트마다 카메라를 다시 열지 않고 그대로 씀
    if (!(stream && stream.active)) {
      stream = await openCamera();
      const v = $('video'); v.srcObject = stream; await v.play();
      const track = stream.getVideoTracks()[0];
      camLabel = track.label || '';
      const front = (track.getSettings && track.getSettings().facingMode === 'user') || /front|전면/i.test(camLabel);
      v.classList.toggle('mirror', front); $('overlay').classList.toggle('mirror', front);
    } else { await $('video').play().catch(() => {}); }
    $('startBtn').textContent = '자세 인식 모델 불러오는 중...';
    await loadModel();
    // v23: 굿모닝은 등 윤곽을 보려고 사람 윤곽(세그멘테이션)도 받음. 다른 종목은 끔(속도)
    try { await landmarker.setOptions({ outputSegmentationMasks: exercise === 'goodmorning' }); } catch {}
  } catch (e) {
    stopCamera();
    $('err').textContent = e && e.name === 'NotAllowedError'
      ? '카메라 권한이 필요해요. 설정 > Safari > 카메라에서 허용한 뒤 다시 시도해 주세요.'
      : '시작하지 못했어요: ' + (e && e.message ? e.message : e);
    $('err').style.display = 'block';
    $('startBtn').disabled = false; $('startBtn').textContent = '시작하기';
    if (session) { session = null; cond = null; show('intro'); applyFlow(); }
    return;
  }
  counter = new (EX().Counter)(mode); CUE_TEXT = EX().lib.CUE_TEXT; NOREP_TEXT = EX().lib.NOREP_TEXT;
  // 무릎 푸시업은 엉덩이가 뒤로 빠지기 쉬워서, 솟음 지적을 무릎 기준으로 말해줌
  if (exercise === 'pushup' && pstyle === 'knees') counter.t.pikeTol += 15; // 무릎 푸시업은 엉덩이 각도가 덜 정확하게 잡혀 여유를 더 줌
  if (exercise === 'pushup' && pstyle === 'knees') { CUE_TEXT = { ...CUE_TEXT, pike: '엉덩이를 앞으로 밀어 무릎부터 어깨까지 일직선으로' }; NOREP_TEXT = { ...NOREP_TEXT, pike: '엉덩이가 뒤로 빠져서 이번은 세지 않아요' }; } results = []; rot.k = -1; rot.n = 0;
  const it = session && session.items[session.i];
  const alt = !!(GX[exercise] && GX[exercise][4]);
  const sided = !!(it && PL.EXDEF[it.ex] && PL.EXDEF[it.ex].side);
  // 양쪽 번갈아 하는 종목(뒤로 런지·버드독·데드버그)은 목표가 '한쪽 기준'이라 양쪽 합계로 셈
  cs = { sides: sided && !alt ? ['R', 'L'] : [null], si: 0, logs: [], done: [], said: -1, wait: false, closed: false, mul: sided && alt ? 2 : 1 };
  target *= cs.mul;
  $('count').innerHTML = isSecEx() ? `0<small>초 / ${target}</small>` : `0<small> / ${target}</small>`;
  sideChip();
  $('noCamBtn').style.display = it && GX[exercise] ? 'block' : 'none';
  setStatus(ultraMissing ? '초광각 카메라를 찾지 못해 일반 뒷면 카메라로 시작해요' : EX().startStatus, ultraMissing);
  if (ultraMissing) say('초광각 카메라를 찾지 못해 일반 뒷면 카메라로 시작해요');
  show('live'); running = true; notVisibleSince = performance.now(); guide = { k: null, since: 0, spokenK: null, spokenAt: 0, guided: false };
  // 새 종목의 첫 세트는 하는 법을 한 번 말해 줌 (다음 세트부터는 자리 안내만)
  const how = it && it.set === 1 && GX[exercise] ? `${EX().name}. ${GX[exercise][1]} ` : '';
  say(how + EX().startSay + (cs.sides[0] ? ` ${SIDE_KO[cs.sides[0]]}부터 해요.` : ''));
  loop();
}

// 카메라 열기. 초광각은 기기 목록에서 이름으로 찾음 (iOS Safari는 권한을 받은 뒤에야 이름을 알려줌)
async function openCamera() {
  const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
  const open = (video) => navigator.mediaDevices.getUserMedia({ video, audio: false });
  const stop = (st) => st.getTracks().forEach(t => t.stop());
  const isFront = (st) => { const t = st.getVideoTracks()[0], fm = t.getSettings && t.getSettings().facingMode; return fm === 'user' || /front|전면|facetime|truedepth/i.test(t.label); };
  ultraMissing = false; camList = '';
  if (facing !== 'ultra') return open({ ...base, facingMode: { ideal: facing } });
  // v11: 초광각을 고르면 앞면 카메라가 나오던 문제 → 앞면은 후보에서 빼고, 열린 카메라가 앞면이면 버리고 일반 뒷면으로
  let st = await open({ ...base, facingMode: { exact: 'environment' } }).catch(() => open({ ...base, facingMode: 'environment' }));
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  camList = devs.map(d => d.label || '(이름 없음)').join(', ');
  const uw = devs.find(d => /ultra ?wide|울트라|초광각/i.test(d.label) && !/front|전면/i.test(d.label));
  if (!uw) { ultraMissing = true; return st; }
  stop(st);
  try {
    const u = await open({ ...base, deviceId: { exact: uw.deviceId } });
    if (!isFront(u)) return u;
    stop(u);
  } catch {}
  ultraMissing = true;
  return open({ ...base, facingMode: { exact: 'environment' } }).catch(() => open({ ...base, facingMode: 'environment' }));
}
let camList = '';
let ultraMissing = false, camLabel = '';

// 휴대폰을 가로로 두거나 화면 회전 잠금 상태여도 판정이 되도록, 몸의 '아래쪽'이 화면 아래로 오게 랜드마크를 90° 단위로 돌림
// 스쿼트는 어깨→발목, 푸시업은 어깨→손목(바닥 짚은 손)이 아래쪽
const rot = { k: -1, n: 0 };
function upright(lm, aspect) {
  const [a, b, c, d] = EX().down, dv = MV.SPECS[exercise] ? MV.downVec(exercise, lm, aspect) : null;
  const dx = dv ? dv.dx : ((lm[c].x + lm[d].x) - (lm[a].x + lm[b].x)) / 2 * aspect;
  const dy = dv ? dv.dy : ((lm[c].y + lm[d].y) - (lm[a].y + lm[b].y)) / 2;
  const best = [dy, dx, -dy, -dx].reduce((b, v, i, arr) => v > arr[b] ? i : b, 0);
  // v39: 자세가 바뀌는 종목(버피·버드독 등)은 준비 자세에서 정한 방향을 세트 내내 유지
  const locked = EX().lockRot && rot.k >= 0 && counter && counter.state !== 'setup';
  if (locked || best === rot.k) rot.n = 0; else if (++rot.n >= 10 || rot.k < 0) { rot.k = best; rot.n = 0; }
  const k = rot.k;
  if (k === 0) return { lm, aspect, k };
  const f = [null, (p) => ({ x: 1 - p.y, y: p.x }), (p) => ({ x: 1 - p.x, y: 1 - p.y }), (p) => ({ x: p.y, y: 1 - p.x })][k];
  return { lm: lm.map(p => ({ ...p, ...f(p) })), aspect: k % 2 ? 1 / aspect : aspect, k };
}

// 자리 잡기 안내: 판정에 필요한 관절이 화면 어디에 있는지 보고 "가까이/멀리/잘림"을 알려줌 (화면을 못 보는 뒷면 카메라 사용자용)
// 거리 기준: 몸 길이(스쿼트는 세로, 푸시업은 가로)가 화면의 35~92%를 차지하면 적당
function framing(up) {
  if (!up) return { k: 'none', text: '화면에 사람이 보이지 않아요', say: EX().kind ? EX().startStatus : '카메라 앞에 옆모습이 보이게 서 주세요' };
  const L = EX().core(), Rr = L.map(i => i + 1);
  const vis = (ids) => ids.reduce((t, i) => t + (up.lm[i].visibility ?? 0), 0);
  const pts = (vis(L) >= vis(Rr) ? L : Rr).map(i => up.lm[i]);
  const ax = EX().axis, cross = ax === 'y' ? 'x' : 'y';
  const along = pts.map(p => p[ax]), span = Math.max(...along) - Math.min(...along);
  // 푸시업은 손목·발목이 바닥(화면 아래 끝)에 붙기 쉬워 아래쪽 여유를 더 줌
  const slack = ax === 'x' ? 0.03 : 0;
  const lo = (p, a) => p[a] < (a === ax ? 0.02 : 0), hi = (p, a) => p[a] > (a === ax ? 0.98 : 1 + slack);
  const cutLo = pts.some(p => lo(p, ax)), cutHi = pts.some(p => hi(p, ax));
  const cutCross = pts.some(p => lo(p, cross) || hi(p, cross));
  if (span > 0.92 || (cutLo && cutHi)) return { k: 'close', text: '너무 가까워요. 조금 더 멀리 가 주세요', say: '조금 더 멀리 가 주세요' };
  if (ax === 'y' && cutLo) return { k: 'top', text: '어깨가 화면 위로 잘려요. 조금 뒤로 가거나 휴대폰을 조금 높여 주세요', say: '어깨가 잘려요. 조금 뒤로 가 주세요' };
  if (ax === 'y' && cutHi) return { k: 'bottom', text: '발목이 화면 아래로 잘려요. 조금 뒤로 가거나 휴대폰을 조금 낮춰 주세요', say: '발목이 잘려요. 조금 뒤로 가 주세요' };
  if (cutLo || cutHi || cutCross) return { k: 'side', text: '몸이 화면 밖으로 잘려요. 화면 가운데로 조금 옮겨 주세요', say: '몸이 잘려요. 화면 가운데로 조금 옮겨 주세요' };
  if (span < EX().minSpan) return { k: 'far', text: '조금 더 가까이 와 주세요', say: '조금 더 가까이 와 주세요' };
  if (Math.min(...pts.map(p => p.visibility ?? 0)) < 0.6) return { k: 'dim', text: '몸이 잘 안 보여요. 밝은 곳에서 옆모습이 보이게 해주세요', say: '몸이 잘 안 보여요. 옆모습이 보이게 해주세요' };
  return { k: 'ok' };
}
// 같은 안내는 5초마다, 바뀐 안내는 1초 유지되면 바로 말함. 안내 후 자리가 맞으면 "좋아요" 한 번
let guide = { k: null, since: 0, spokenK: null, spokenAt: 0, guided: false };
function speakGuide(f, now) {
  if (f.k !== guide.k) { guide.k = f.k; guide.since = now; }
  if (f.k === 'ok') {
    if (guide.guided && now - guide.since > 700) { say('좋아요, 그 자리예요', true); guide.guided = false; guide.spokenK = 'ok'; }
    return;
  }
  setStatus(f.text, true);
  const changed = guide.spokenK !== f.k;
  if ((changed && now - guide.since > 1000) || (!changed && now - guide.spokenAt > 5000)) {
    say(f.say, true); guide.spokenK = f.k; guide.spokenAt = now; guide.guided = true;
  }
}

function setStatus(text, warn = false) { const s = $('status'); s.textContent = text; s.classList.toggle('warn', warn); }

// 화면 표시: 흐린 전신 뼈대 + 판정에 쓰는 관절 사슬(빛나는 선) + 핵심 관절 각도 호와 숫자
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
let smooth = null; // 화면 떨림을 줄이려고 그릴 때만 위치를 부드럽게
function draw(lm, m) {
  const c = $('overlay'), v = $('video');
  const dpr = Math.min(2, devicePixelRatio || 1), W = c.clientWidth * dpr, H = c.clientHeight * dpr;
  if (c.width !== W) c.width = W; if (c.height !== H) c.height = H;
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, W, H);
  if (!lm) { smooth = null; return; }
  const vw = v.videoWidth, vh = v.videoHeight, s = Math.min(W / vw, H / vh); // object-fit: contain
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2, u = dpr;
  if (!smooth) smooth = lm.map(p => [p.x, p.y]);
  smooth = smooth.map((q, i) => [q[0] + 0.6 * (lm[i].x - q[0]), q[1] + 0.6 * (lm[i].y - q[1])]);
  const P = (i) => [smooth[i][0] * vw * s + ox, smooth[i][1] * vh * s + oy];
  const seen = (i) => (lm[i].visibility ?? 0) > 0.5;
  const mirrored = c.classList.contains('mirror');
  const ex = EX(), side = ex.joints(m), col = ex.colors(m, counter.t);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // 1) 흐린 전신 뼈대
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2 * u;
  for (const [a, b] of BONES) if (seen(a) && seen(b)) { const [x1, y1] = P(a), [x2, y2] = P(b); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  // 2) 판정 관절 사슬: 넓은 빛 번짐 + 가는 중심선 (구간마다 색이 자연스럽게 이어지도록 그라데이션)
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = P(side[i]), [x2, y2] = P(side[i + 1]);
    const c2 = col[Math.min(3, i + 1)];
    const g = ctx.createLinearGradient(x1, y1, x2, y2); g.addColorStop(0, col[i]); g.addColorStop(1, i < 3 && c2 !== col[i] ? c2 : col[i]);
    ctx.save(); ctx.globalAlpha = 0.28; ctx.strokeStyle = g; ctx.lineWidth = 16 * u; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.strokeStyle = g; ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }

  // 3) 관절: 색 테두리 + 흰 점
  side.slice(0, 5).forEach((idx, k) => {
    const [x, y] = P(idx), cc = col[Math.min(3, Math.max(0, k - 1))];
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(x, y, 10 * u, 0, 7); ctx.fill();
    ctx.strokeStyle = cc; ctx.lineWidth = 2.5 * u; ctx.beginPath(); ctx.arc(x, y, 10 * u, 0, 7); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 4 * u, 0, 7); ctx.fill();
  });

  // 4) 핵심 관절 각도: 호 + 숫자 (스쿼트는 무릎, 푸시업은 팔꿈치)
  if (m && m.visible && ex.arc) {
    const at = ex.arc.at, [jx, jy] = P(side[at]), [ax, ay] = P(side[at - 1]), [bx, by] = P(side[at + 1]);
    const ta = Math.atan2(ay - jy, ax - jx), tb = Math.atan2(by - jy, bx - jx);
    const d = ((tb - ta + 3 * Math.PI) % (2 * Math.PI)) - Math.PI, r = 30 * u, cc = col[at - 1];
    ctx.save();
    ctx.fillStyle = cc; ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.moveTo(jx, jy); ctx.arc(jx, jy, r, ta, ta + d, d < 0); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = cc; ctx.lineWidth = 2.5 * u; ctx.beginPath(); ctx.arc(jx, jy, r, ta, ta + d, d < 0); ctx.stroke();
    // 숫자는 호의 바깥쪽에
    const mid = ta + d / 2, lx = jx - Math.cos(mid) * 52 * u, ly = jy - Math.sin(mid) * 52 * u;
    const label = Math.round(ex.arc.value(m)) + '°';
    ctx.font = `700 ${15 * u}px -apple-system, 'Apple SD Gothic Neo', sans-serif`;
    const tw = ctx.measureText(label).width + 14 * u, th = 24 * u;
    ctx.translate(lx, ly); if (mirrored) ctx.scale(-1, 1);
    ctx.fillStyle = 'rgba(20,20,20,0.78)'; ctx.beginPath(); ctx.roundRect(-tw / 2, -th / 2, tw, th, th / 2); ctx.fill();
    ctx.strokeStyle = cc; ctx.lineWidth = 1.5 * u; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 0, 1 * u);
    ctx.restore();
  }
}

let lastVideoTime = -1;
function loop() {
  if (!running) return;
  const v = $('video'), now = performance.now();
  if (v.readyState >= 2 && v.currentTime !== lastVideoTime) {
    lastVideoTime = v.currentTime;
    const res = window.__lmOverride ? { landmarks: [window.__lmOverride()] } : landmarker.detectForVideo(v, now); // 시험용 입력 바꾸기
    const lm = res.landmarks && res.landmarks[0];
    const up = lm ? upright(lm, v.videoWidth / v.videoHeight) : null;
    const m = up ? EX().measure(up.lm, up.aspect) : null;
    const mask = res.segmentationMasks && res.segmentationMasks[0];
    if (mask) {
      // 숙인 동안에만 윤곽을 읽음 (GPU → CPU 복사가 느려서)
      if (exercise === 'goodmorning' && m && m.visible && counter.state === 'down') {
        try {
          const W = mask.width, H = mask.height, arr = mask.getAsFloat32Array();
          const [si, hi, ki] = m.side === 'right' ? [12, 24, 26] : [11, 23, 25];
          const px = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
          m.curve = GM.backCurve(arr, W, H, px(si), px(hi), px(ki));
        } catch {}
      }
      res.segmentationMasks.forEach(k => k.close && k.close());
    }
    draw(lm, m);
    if ($('debug').style.display === 'block') {
      $('debug').textContent = m && m.visible
        ? EX().debug(m, counter) + `\n화면 회전 보정 ${up.k * 90}°\n카메라 ${camLabel}`
        : '전신 인식 안 됨 (' + (m ? m.reason : '') + ')';
    }
    const r = cs && cs.wait ? { event: 'wait' } : counter.update(m, now);
    const fr = r.event === 'not_visible' || (r.event === 'setup' && r.hint !== 'hold') ? framing(up) : { k: 'ok' };
    if (r.event === 'not_visible') {
      if (now - notVisibleSince > 1000) speakGuide(fr.k === 'ok' ? { k: 'dim', text: '어깨부터 발목까지 화면에 들어오게 해주세요', say: '어깨부터 발목까지 보이게 해주세요' } : fr, now);
    } else if (r.event === 'not_side') {
      if (now - notVisibleSince > 1500) speakGuide({ k: 'notside', text: EX().notSide[0], say: EX().notSide[1] }, now);
    } else {
      if (r.event === 'setup' || r.event === 'ready') speakGuide({ k: 'ok' }, now);
      notVisibleSince = now;
      if (r.event === 'setup') setStatus(r.hint === 'hold' ? `그대로 계세요... ${Math.round((1 - r.progress) * 10) / 10}초` : EX().setupMsg);
      else if (r.event === 'ready') {
        const k = EX().kind, msg = r.resumed ? '이어서 하세요' : k === 'hold' ? '시작! 자세 그대로 버티세요' : k === 'cardio' ? '시작! 계속 움직여요' : '준비 완료. 시작하세요';
        setStatus(r.resumed ? '이어서 하세요' : k === 'hold' ? '버티는 중 · 바른 자세일 때만 시간이 흘러요' : '준비 완료! 시작하세요'); say(msg, true);
      }
      else if (r.event === 'lost') { setStatus(EX().lostMsg, true); }
      else if (r.event === 'shallow') { setStatus(CUE_TEXT.shallow, true); if (r.speak) say(CUE_TEXT.shallow, true); }
      else if (r.event === 'rep') onRep(r);
      else if (r.event === 'norep') onNoRep(r);
      else if (r.event === 'hold') onHold(r);
      else if (r.event === 'holdfault') onHoldFault(r);
      else if (r.event === 'beat') { onHold(r); onBeat(r); }
    }
  }
  rafId = requestAnimationFrame(loop);
}

function onNoRep(r) {
  // 기준 미달: 횟수는 그대로 두고 이유를 한마디로
  const msg = NOREP_TEXT[r.rep.noRep];
  setStatus(`안 셈 · ${msg}` + (r.rep.curve != null && r.rep.noRep === 'back' ? ` (등 휨 ${r.rep.curve}%)` : ''), true);
  say(msg, true); // v26: 안 셀 때는 매번 이유를 말함 (사용자: 소리가 나다 안 나면 오류 같음)
}

function onRep(r) {
  const n = r.rep.count;
  $('count').innerHTML = `${n}<small> / ${target}</small>`;
  // 반복마다 한마디: 횟수 + (필요하면) 교정 한 가지
  const cue = r.rep.cue ? CUE_TEXT[r.rep.cue] : null; // v26: 같은 지적도 매번 말함 (이전: 연속 2번까지만)
  say((NUM[n] || String(n)) + (cue ? '. ' + cue : ''), true);
  setStatus(`${r.rep.score}점 · ` + (r.rep.cue ? CUE_TEXT[r.rep.cue] : '좋아요'), !!r.rep.cue);
  if (n >= target) { cs.wait = true; setTimeout(() => camSideDone(), 900); }
}
// v39: 버티기·유산소 — 시간 표시와 남은 시간 안내
function showSec(sec) { $('count').innerHTML = `${Math.floor(sec)}<small>초 / ${target}</small>`; }
function onHold(r) {
  showSec(r.sec);
  const left = Math.ceil(target - r.sec);
  if (left !== cs.said) {
    cs.said = left;
    if (left === Math.floor(target / 2) && target >= 20) say('절반 지났어요. 자세 그대로', true);
    else if (left <= 3 && left >= 1) say(['', '하나', '둘', '셋'][left], true);
  }
  if (r.event === 'hold' && EX().kind === 'hold') setStatus('좋아요 · 그대로 버티세요');
  if (r.sec >= target) { cs.wait = true; camSideDone(); }
}
function onHoldFault(r) {
  showSec(r.sec);
  setStatus(`시간 멈춤 · ${CUE_TEXT[r.fault] || r.fault}`, true);
  if (r.speak) say(CUE_TEXT[r.fault] || '', true);
}
function onBeat(r) {
  setStatus(`${r.count}회 · ${r.cue ? CUE_TEXT[r.cue] : '좋아요'}`, !!r.cue);
  if (r.cue) say(CUE_TEXT[r.cue], true); else if (r.speakCount) say(`${r.count}회`, true);
}
// 지금 쪽(또는 세트)의 기록과 한 양
const curLog = () => counter.kind === 'hold' || counter.kind === 'cardio' ? (counter.held > 0 ? [counter.summary()] : []) : counter.repLog.map(r => ({ ...r }));
const curDone = () => counter.kind === 'hold' || counter.kind === 'cardio' ? Math.floor(counter.held / 1000) : Math.floor(counter.reps / (cs.mul || 1));
// 한쪽씩 하는 종목은 오른쪽이 끝나면 왼쪽으로 (카운터를 새로 만들어 준비 자세부터)
function camSideDone() {
  if (!running) return;
  cs.logs.push(...curLog()); cs.done.push(curDone()); cs.closed = true;
  if (cs.si + 1 < cs.sides.length) {
    cs.si += 1; cs.closed = false; cs.wait = false; cs.said = -1;
    counter = new (EX().Counter)(mode); rot.k = -1; rot.n = 0;
    const s = SIDE_KO[cs.sides[cs.si]];
    sideChip(); $('count').innerHTML = isSecEx() ? `0<small>초 / ${target}</small>` : `0<small> / ${target}</small>`;
    setStatus(`이제 ${s}이에요. 자세를 바꾸고 잠깐 멈춰 주세요`);
    say(`좋아요. 이제 ${s}이에요. 자세를 바꾸고 잠깐 멈춰 주세요.`, true);
    return;
  }
  say('세트 완료! 수고했어요.', true); endSet();
}
const isSecEx = () => counter.kind === 'hold' || counter.kind === 'cardio';
function sideChip() {
  const it = session && session.items[session.i];
  $('setChip').style.display = it ? 'block' : 'none';
  if (it) $('setChip').textContent = `${EX().name} ${it.set} / ${it.of}세트` + (cs.sides[cs.si] ? ` · ${SIDE_KO[cs.sides[cs.si]]}` : cs.mul > 1 ? ' · 양쪽 번갈아' : '');
}

function stopCamera() {
  running = false; cancelAnimationFrame(rafId);
  if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
}

function endSet() {
  if (session) { if (running) sessionSetDone(); return; }
  if (!running && !stream) return;
  stopCamera();
  const log = counter.repLog;
  results = log.map(() => null);
  const counted = log.filter(r => r.counted).length;
  $('sReps').innerHTML = counted + (counted < log.length ? `<small style="font-size:13px;font-weight:400"> / 시도 ${log.length}</small>` : '');
  $('sDepth').textContent = `${log.filter(r => r.depthOk).length}회`;
  $('sKnee').textContent = log.length ? Math.round(log.reduce((a, r) => a + r.score, 0) / log.length) + '점' : '-';
  const list = $('repList'); list.innerHTML = '';
  if (!log.length) list.innerHTML = '<p class="note">기록된 반복이 없어요.</p>';
  log.forEach((r, i) => {
    const row = document.createElement('div'); row.className = 'rep';
    const judge = r.faults.length ? r.faults.map(f => CUE_TEXT[f]).join(', ') : '좋은 자세';
    row.innerHTML = `<span class="n">${r.n}</span><span class="d"><b>${r.counted ? r.score + '점' : '안 셈'}</b> ${r.counted ? judge : NOREP_TEXT[r.noRep]}<br><small>${EX().detail(r)}</small></span>`;
    const fb = document.createElement('div'); fb.className = 'fb';
    const opts = [['ok', '맞음'], ['lenient', '너그러움'], ['harsh', '엄격함']];
    const btns = opts.map(([v, label]) => {
      const b = document.createElement('button'); b.textContent = label;
      b.onclick = () => { results[i] = v; btns.forEach(x => x.className = ''); b.className = v === 'ok' ? 'sel' : 'selno'; acc(); };
      return b;
    });
    fb.append(...btns); row.append(fb); list.append(row);
  });
  acc(); show('summary');
}
function acc() {
  const done = results.filter(x => x !== null);
  const n = (v) => done.filter(x => x === v).length;
  $('accuracy').textContent = done.length ? `판정 정확도 ${Math.round(n('ok') / done.length * 100)}% (${done.length}회 응답 · 너그러움 ${n('lenient')} · 엄격함 ${n('harsh')})` : '';
}

$('startBtn').onclick = () => flow === 'session' ? (slen === 'quick' ? startSession() : openCond()) : start();
// ── v43: 오늘 컨디션 (운동 시작 전) ──
let cond = null;
function openCond() {
  cond = { level: 'good', parts: [] }; pick('cLevel', 'good');
  $('cParts').innerHTML = PL.PARTS.map(p => `<button data-v="${p}">${PART_KO[p]}</button>`).join('');
  $('cParts').querySelectorAll('button').forEach(b => b.onclick = () => { b.classList.toggle('sel'); cond.parts = [...$('cParts').querySelectorAll('.sel')].map(x => x.dataset.v); renderCond(); });
  renderCond(); show('cond'); $('cond').scrollTop = 0;
}
seg('cLevel', v => { if (cond) { cond.level = v; renderCond(); } });
function renderCond() {
  const plan = store.plan || defaultPlan(), tp = PL.todayPlan(plan, store.history), a = PL.adjustToday(plan, tp, cond);
  // 오늘 운동 전체를 보여 주고, 바뀐 곳은 원래 것을 줄 긋고 파란색으로
  const amt = (x) => `${x.sets}세트 × ${fmtN(x.ex, x.reps)}`, nm = (x) => exName(x.ex, x.style);
  let changed = 0;
  const li = a.rows.map(({ from: f, to: t }) => {
    if (!t) { changed++; return `<li class="drop"><b><s>${nm(f)}</s></b><span>오늘은 빼요</span></li>`; }
    const sw = t.ex !== f.ex || t.style !== f.style, am = amt(t) !== amt(f);
    if (!sw && !am) return `<li><b>${nm(f)}</b><span>${amt(f)}</span></li>`;
    changed++;
    return `<li class="chg"><b>${sw ? `<s>${nm(f)}</s> → ${nm(t)}` : nm(f)}</b><span>${am || sw ? `${amt(t) !== amt(f) ? `<s>${amt(f)}</s> → ` : ''}${amt(t)}` : ''}</span></li>`;
  }).join('');
  const n = a.items.reduce((s, x) => s + x.sets, 0);
  $('cPlan').innerHTML = `<b>오늘 운동${changed ? ` · ${changed}곳 바뀜` : ' · 플랜대로'}</b><ul class="plan cplan">${li}</ul>`
    + `<span class="note">본운동 ${a.items.length}종목 · ${n}세트. ${cond.level !== 'good' ? '세트를 줄인 날은 다음 운동 횟수를 올리지 않아요.' : changed ? '플랜은 그대로고, 오늘만 바꿔요. 뺀 종목은 다음에 그대로 이어서 해요.' : ''}</span>`;
  const pain = cond.parts.filter(p => PL.PAIN.includes(p)), st = PL.painStreak(store.history, pain), long = pain.filter(p => st[p] >= 3);
  const w = [];
  if (long.length) w.push(`<b>${long.map(p => PART_KO[p]).join('·')} 통증이 ${Math.max(...long.map(p => st[p]))}번 연속이에요.</b> 며칠 운동을 쉬고 병원이나 전문가에게 진료를 받아 보세요.`);
  if (pain.length) w.push('날카로운 통증, 붓기, 저림, 관절이 빠질 것 같은 느낌이 있으면 오늘은 쉬세요. 운동 중에 아프면 바로 멈추세요.');
  if (cond.level === 'low') w.push('잠을 못 잤거나 몸살 기운이 있으면 오늘은 쉬거나 가볍게 걷기만 해도 괜찮아요.');
  $('cWarn').style.display = w.length ? 'block' : 'none'; $('cWarn').innerHTML = w.join('<br>');
}
$('cStart').onclick = () => startSession();
$('cCancel').onclick = () => { cond = null; show('intro'); };
// 시범·가이드: 시작 화면에서는 같은 창, 결과 화면에서는 결과가 사라지지 않게 새 창
const guideUrl = (tab) => `guide.html?ex=${exercise}${exercise === 'pushup' ? '&style=' + (pstyle === 'full' ? 'full' : 'knees') : ''}${tab ? '&tab=' + tab : ''}`;
$('guideBtn').onclick = () => { location.href = guideUrl(); };
$('guideBtn2').onclick = () => { window.open(guideUrl('judge'), '_blank'); };
$('endBtn').onclick = endSet;
$('againBtn').onclick = () => { show('intro'); $('startBtn').disabled = false; $('startBtn').textContent = '시작하기'; };
$('muteBtn').onclick = () => { voice = !voice; if (!voice) speechSynthesis.cancel(); $('muteBtn').textContent = voice ? '음성 끄기' : '음성 켜기'; $('voiceChip').textContent = voice ? '음성 켜짐' : '음성 꺼짐'; };
$('dbgBtn').onclick = () => { const d = $('debug'); d.style.display = d.style.display === 'block' ? 'none' : 'block'; };
$('copyBtn').onclick = async () => {
  const lines = counter.repLog.map((r, i) => `${r.n}회: ${r.counted ? '카운트 ' + r.count : '안 셈(' + r.noRep + ')'} · ${r.score}점 ${r.faults.join('+') || 'ok'} / ${EX().line(r)} / 판정 ${({ ok: '맞음', lenient: '너그러움', harsh: '엄격함' })[results[i]] || '-'}`);
  const text = `${EX().name} 데모 v44 결과 [${mode}${exercise === 'pushup' ? '·' + ({ full: '기본', knees: '무릎', incline: '의자' })[pstyle] : ''}] (${new Date().toLocaleString('ko-KR')})\n카메라: ${camLabel}${camList ? ' (목록: ' + camList + ')' : ''}\n` + lines.join('\n') + '\n' + $('accuracy').textContent;
  try { await navigator.clipboard.writeText(text); $('copyBtn').textContent = '복사했어요'; } catch { $('copyBtn').textContent = '복사하지 못했어요'; }
  setTimeout(() => $('copyBtn').textContent = '결과 복사하기', 2000);
};
const exName = (ex, style) => (EXERCISES[ex] ? EXERCISES[ex].name : GX[ex][0]) + (ex === 'pushup' && style ? ` (${STYLE_NAME_[style]})` : '');
const isSec = (ex) => PL.EXDEF[ex].unit === 'sec';
const fmtN = (ex, n) => `${n}${isSec(ex) ? '초' : '회'}${PL.EXDEF[ex].side ? ' (한쪽)' : ''}`;
const placeOf = (ex) => PLACE[ex] || PLACE_G[GX[ex][2]];
// v39: 워밍업·쿨다운을 뺀 모든 본운동을 카메라로 판정 (공통 엔진 move-logic.js, 의자 스쿼트는 스쿼트 판정 그대로)
// 세트 목표: 플랜 값 + 이번 운동에서 체감 강도로 바꾼 만큼 (초 종목은 한 칸 = 5초)
function tgt(it) {
  const a = (session && session.adj[it.ex]) || 0;
  return isSec(it.ex) ? Math.max(10, Math.min(120, Math.round(it.reps + a * 2.5))) : Math.max(3, Math.min(30, it.reps + a));
}
// v31: 내 플랜과 기록은 이 휴대폰에만 저장 (영상·관절 데이터는 저장하지 않음)
const STORE = 'coach.v1';
const store = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();
store.history = store.history || [];
if (store.plan && store.plan.v !== 2) { store.plan = PL.upgrade(store.plan, store.profile); try { localStorage.setItem('coach.v1', JSON.stringify(store)); } catch {} }
const saveStore = () => { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch {} };
const pick = (id, v) => [...$(id).children].forEach(c => c.classList.toggle('sel', c.dataset.v === String(v)));
let slen = 'full', qwk = null; // qwk: 빠른 체험에서 고른 구성
// v36: 플랜이 없으면 '6개월 미만·체력 유지' 기본 플랜으로
const defaultPlan = () => PL.makePlan({ level: 'lt6', goal: 'fitness', days: 3, age: 30, height: 170, weight: 65, parq: [] });
let todayWk = 'A';
function buildPlan() {
  const quick = slen === 'quick', scale = (list) => list.map(([n, d, t, ...rest]) => [n, d, quick ? Math.max(6, Math.round(t / 6)) : t, ...rest]);
  const items = [{ kind: 'timer', key: 'warmup', title: '워밍업', steps: scale(WARMUP) }];
  if (store.plan && PL.enterPhase(store.plan)) saveStore(); // v42: 새 단계에 들어서면 세트·휴식을 한 번 바꿈
  const tp = PL.todayPlan(store.plan || defaultPlan(), store.history, new Date(), quick ? qwk : null);
  todayWk = tp.wk;
  // v43: 오늘 컨디션에 맞춰 오늘 운동만 조절 (빠른 체험 제외)
  const adj = !quick && cond ? PL.adjustToday(store.plan || defaultPlan(), tp, cond) : null;
  for (const x of adj ? adj.items : tp.items)
    for (let n = 1, sets = quick ? 1 : x.sets; n <= sets; n++)
      items.push({ kind: 'set', slot: x.slot, ex: x.ex, style: x.style, set: n, of: sets, reps: quick ? (x.unit === 'sec' ? 15 : 5) : x.reps, rest: quick ? 20 : x.rest });
  items.push({ kind: 'timer', key: 'cooldown', title: '쿨다운', steps: scale(COOLDOWN) });
  return items;
}
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.floor(sec % 60))).padStart(2, '0')}`;
function renderPlan() {
  const items = buildPlan(), li = [];
  for (const it of items) {
    if (it.kind === 'timer') li.push(`<li><b>${it.title}</b><span>${fmt(it.steps.reduce((a, s) => a + s[2], 0))} · ${it.key === 'warmup' ? '걷기 + 동적 스트레칭' : '걷기 + 정적 스트레칭'}</span></li>`);
    else if (it.set === 1) li.push(`<li><b>${exName(it.ex, it.style)}${EXERCISES[it.ex] ? '' : '<span class="badge">음성 안내</span>'}</b><span>${it.of}세트 × ${fmtN(it.ex, it.reps)} · 휴식 ${it.rest}초</span></li>`);
  }
  li.splice(1, 0, `<li><b style="white-space:nowrap">오늘 구성 ${todayWk}</b><span>${{ A: '스쿼트 · 엉덩이 들기 · 플랭크 위주', B: '런지 · 굿모닝 · 옆으로 버티기 위주', C: '벽 앉기·옆 런지 · 딥스 · 코어 위주' }[todayWk]}. 운동할 때마다 A → B${(store.plan || defaultPlan()).days >= 3 ? ' → C' : ''} 순서로 바뀌어요.</span></li>`);
  $('planList').innerHTML = li.join('');
  // 빠른 체험일 때만 구성 고르기 (주 2회 플랜은 A·B만)
  const three = (store.plan || defaultPlan()).days >= 3;
  $('qwkBox').style.display = slen === 'quick' ? 'block' : 'none';
  $('qwk').children[2].style.display = three ? '' : 'none'; $('qwk').style.gridTemplateColumns = three ? 'repeat(3,1fr)' : '1fr 1fr';
  pick('qwk', todayWk);
  renderMyPlan();
}
function renderMyPlan() {
  const pl = store.plan, standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const install = standalone ? '' : '<p class="note" style="margin:8px 0 0">사파리 공유 버튼 → "홈 화면에 추가"를 하면 앱처럼 열리고 기록도 계속 남아요.</p>';
  $('slenFull').textContent = pl ? '내 플랜대로' : '기본 (약 25분)';
  if (!pl) {
    $('myPlan').innerHTML = `<div class="card"><b>아직 내 플랜이 없어요</b><br>건강 확인과 몇 가지 질문에 답하면 경력·목표에 맞춰 세트와 횟수를 정하고, 운동할 때마다 다음 횟수를 조절해 드려요.${install}</div><button class="ghost" id="openSetup" style="margin-top:8px">내 플랜 만들기 (약 1분)</button>`;
  } else {
    const { recovery } = PL.weekInfo(pl), c = PL.counts(store.history), sp = PL.planSpan(pl);
    const wt = PL.weightTrend(store.weights || [], pl.target), fastLoss = wt && wt.perWeek != null && (store.weights || []).length > 2 && -wt.perWeek > wt.now * PL.RATE.lossMax;
    const wline = wt ? `<br>체중 ${wt.now}kg${wt.change ? ` (시작보다 ${wt.change > 0 ? '+' : ''}${wt.change}kg)` : ''}${pl.target ? ` · 목표 ${pl.target}kg${wt.toGo ? `까지 ${Math.abs(wt.toGo)}kg` : ' 달성!'}` : ''}` : '';
    const ph = PL.phaseOf(pl), P = PHASE[ph.key], fresh = sp.week === ph.from && ph.idx > 0 && !sp.over;
    const phLine = sp.over ? '' : `<div class="phase"><b>${ph.of > 1 ? `${ph.idx + 1}/${ph.of} ` : ''}${P.name} 단계 · ${P.sub}</b>${fresh ? '<span class="badge">새 단계</span>' : ''} <small>${ph.from}~${ph.to}주</small><br><span class="note">${P.desc}${ph.next ? ` ${ph.to + 1}주부터는 ${PHASE[ph.next].name} 단계(${PHASE[ph.next].sub})예요.` : ''}</span></div>`;
    // v44: 목표 점검 (컨디션으로 덜 한 날이 많거나 체중 속도가 늦을 때)
    const gp = PL.goalPace(pl, store.weights || [], store.history), loss = gp && gp.kind === 'loss';
    const paceHtml = !gp ? '' : gp.behind
      ? `<div class="pace"><b>지금 속도로는 ${sp.weeks}주 안에 목표 ${pl.target}kg가 빠듯해요</b><br><span class="note">남은 ${gp.weeksLeft}주 동안 주당 ${gp.need}kg(체중의 ${gp.pct}%)를 ${loss ? '빼야 해서 근육까지 빠지기' : '늘려야 해서 지방이 붙기'} 쉬워요.${gp.cut ? ` 최근 2주에 컨디션으로 줄인 날이 ${gp.cut}번 있었어요.` : ''} 덜 한 만큼 몰아서 하면 다치기 쉬우니, 이렇게 바꾸는 게 안전해요.${gp.stale ? ' (마지막 체중 기록이 10일 넘었어요. 오늘 체중을 적으면 더 정확해요.)' : ''}</span><div class="goalopt">`
        + (gp.extendTo ? `<button data-k="extend"><b>기간을 ${gp.extendTo}주로 늘리기 (추천)</b>목표는 그대로, 기간만 늘려요.</button>` : '')
        + `<button data-k="lower"><b>목표를 ${gp.safeTarget}kg로 조정</b>남은 ${gp.weeksLeft}주에 무리 없이 갈 수 있어요.</button></div></div>`
      : `<div class="pace"><span class="note">최근 2주에 컨디션으로 줄인 날이 ${gp.cut}번이에요. 목표 속도는 아직 괜찮아요. 같은 곳이 계속 아프면 쉬고 진료를 받아 보세요.</span></div>`;
    $('myPlan').innerHTML = `<div class="card"><b>내 플랜 · ${sp.over ? `${sp.weeks}주 완료` : `${sp.weeks}주 중 ${sp.week}주차`}</b>${recovery && !sp.over ? '<span class="badge">회복 주</span>' : ''}<br>${GOAL_NAME[pl.goal]} · 주 ${pl.days}회 · 이번 주 <b>${c.thisWeek} / ${pl.days}회</b> · 최근 2주 ${c.last14}회${wline}${paceHtml}${phLine}`
      + (sp.over ? `<br><span class="note"><b>${sp.weeks}주 플랜을 마쳤어요!</b> 새 플랜을 만들면 지금까지 올린 동작과 횟수를 이어받아 1주차부터 다시 시작해요.</span>` : '')
      + (recovery && !sp.over ? '<br><span class="note">4주마다 한 번은 몸이 회복하도록 세트를 하나씩 줄여요.</span>' : '')
      + (pl.goal === 'diet' ? `<br><span class="note">${pl.boost ? '목표 속도를 내려면 빠르게 걷기 같은 유산소 주 250분과 식단 관리를 꼭 함께 하세요.' : '체중 감량은 빠르게 걷기 같은 유산소를 주 150분 함께 하면 좋아요.'}</span>` : '')
      + (fastLoss ? '<br><span class="note">체중이 주당 1%보다 빠르게 줄고 있어요. 근육이 빠지지 않게 식사를 너무 줄이지 마세요.</span>' : '')
      + (pl.goal !== 'fitness' ? `<div class="wrow"><input id="wIn" type="number" inputmode="decimal" placeholder="오늘 체중 (kg)"><button id="wSave">기록</button></div>` : '')
      + (pl.careful ? '<br><span class="note">건강 확인 결과에 따라 쉬운 동작으로 시작했어요. 운동 전 의사와 상담을 권해요.</span>' : '')
      + `${install}</div><button class="linkbtn" id="openSetup" style="align-self:flex-start;padding:4px 0">플랜 다시 만들기</button>`;
  }
  $('openSetup').onclick = openSetup;
  document.querySelectorAll('#myPlan .pace button').forEach(b => b.onclick = () => {
    const pl = store.plan, gp = PL.goalPace(pl, store.weights || [], store.history); if (!gp) return;
    if (b.dataset.k === 'extend' && gp.extendTo) { pl.weeks = gp.extendTo; if (store.profile) store.profile.weeks = gp.extendTo; }
    if (b.dataset.k === 'lower') { pl.target = gp.safeTarget; if (store.profile) store.profile.target = gp.safeTarget; }
    saveStore(); renderMyPlan();
  });
  if ($('wSave')) $('wSave').onclick = () => {
    const kg = +$('wIn').value; if (!(kg >= 30 && kg <= 250)) { $('wIn').value = ''; $('wIn').placeholder = '30~250kg로 적어 주세요'; return; }
    store.weights = store.weights || []; const day = PL.dayKey(new Date()), last = store.weights[store.weights.length - 1];
    if (last && last.day === day) last.kg = kg; else store.weights.push({ day, kg });
    if (store.weights.length > 400) store.weights.splice(0, store.weights.length - 400);
    saveStore(); renderMyPlan();
  };
  const h = store.history.slice(-5).reverse();
  $('histBox').innerHTML = h.length ? '<label class="lbl">최근 기록</label><div class="hist" style="margin-top:6px">' + h.map(x => {
    const d = new Date(x.at), reps = x.sets.filter(s => !(PL.EXDEF[s.ex] && isSec(s.ex))).reduce((a, s) => a + s.counted, 0), sc = x.sets.filter(s => s.avg != null), avg = sc.length ? Math.round(sc.reduce((a, s) => a + s.avg, 0) / sc.length) : null;
    return `<div><b>${d.getMonth() + 1}월 ${d.getDate()}일${x.quick ? ' · 빠른 체험' : ''}</b><span>${x.sets.length}세트 · ${reps}회${avg != null ? ' · 자세 ' + avg + '점' : ''}</span></div>`;
  }).join('') + '</div><button class="ghost" id="histAll" style="margin-top:8px">기록 전체 보기</button>' : '';
  if ($('histAll')) $('histAll').onclick = () => { renderHistory(); show('history'); $('history').scrollTop = 0; };
}
// v41: 기록 화면 — 지금까지 한 운동을 달별로, 누르면 종목별 내용
function renderHistory() {
  const all = store.history, real = all.filter(x => !x.quick), c = PL.counts(all), mins = real.reduce((a, x) => a + (x.mins || 0), 0);
  $('hStats').innerHTML = `<div class="stat"><span>운동한 날</span><b>${new Set(real.map(x => x.day)).size}일</b></div><div class="stat"><span>총 운동 시간</span><b>${mins >= 60 ? Math.floor(mins / 60) + '시간 ' + (mins % 60) + '분' : mins + '분'}</b></div><div class="stat"><span>이번 주</span><b>${c.thisWeek}회</b></div>`;
  const ws = store.weights || [], wt = ws.length ? PL.weightTrend(ws, store.plan && store.plan.target) : null;
  $('hWeight').innerHTML = wt && ws.length > 1 ? `<div class="card"><b>체중</b> ${ws[0].kg}kg → ${wt.now}kg (${wt.change > 0 ? '+' : ''}${wt.change}kg)<br><span class="note">${ws.slice(-6).map(w => `${+w.day.slice(5, 7)}/${+w.day.slice(8)} ${w.kg}`).join(' · ')}</span></div>` : '';
  const WD = '일월화수목금토';
  let mon = '', html = '';
  for (const x of [...all].reverse()) {
    const d = new Date(x.at), m = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
    if (m !== mon) { mon = m; html += `<div class="hmon">${m}</div>`; }
    const byEx = {}; x.sets.forEach(s => { const k = s.ex + '|' + (s.style || ''); (byEx[k] = byEx[k] || []).push(s); });
    const sc = x.sets.filter(s => s.avg != null), avg = sc.length ? Math.round(sc.reduce((a, s) => a + s.avg, 0) / sc.length) : null;
    const rows = Object.values(byEx).map(ss => { const s0 = ss[0], tot = ss.reduce((a, s) => a + (s.counted || 0), 0), sa = ss.filter(s => s.avg != null), av = sa.length ? Math.round(sa.reduce((a, s) => a + s.avg, 0) / sa.length) : null;
      return `<li><b>${exName(s0.ex, s0.style)}</b><span>${ss.length}세트 · ${tot}${PL.EXDEF[s0.ex] && isSec(s0.ex) ? '초' : '회'}${av != null ? ' · ' + av + '점' : ''}</span></li>`; }).join('');
    html += `<details class="hday"><summary><b>${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})</b><span>${x.quick ? '빠른 체험' : '구성 ' + (x.wk || '-')}${x.cond ? ' · 컨디션 조절' : ''}${x.mins ? ' · ' + x.mins + '분' : ''} · ${x.sets.length}세트${avg != null ? ' · 자세 ' + avg + '점' : ''}</span></summary><ul>${rows || '<li><span>완료한 세트가 없어요</span></li>'}</ul></details>`;
  }
  $('hList').innerHTML = html || '<p class="note">아직 기록이 없어요.</p>';
}
$('hBack').onclick = () => show('intro');

let setupAns = {};
function openSetup() {
  const p = store.profile || {};
  setupAns = { parq: p.parq ? [...p.parq] : PARQ.map(() => null), level: p.level, goal: p.goal, days: p.days || 3, weeks: p.weeks || 8, place: 'home', boost: false };
  $('parq').innerHTML = PARQ.map((q, i) => `<div class="q"><span>${i + 1}. ${q}</span><div class="seg" data-i="${i}"><button data-v="0">아니오</button><button data-v="1" class="yes">예</button></div></div>`).join('');
  $('parq').querySelectorAll('.seg').forEach(el => {
    const i = +el.dataset.i;
    if (setupAns.parq[i] != null) [...el.children].forEach(c => c.classList.toggle('sel', c.dataset.v === String(setupAns.parq[i])));
    el.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; setupAns.parq[i] = +b.dataset.v; [...el.children].forEach(c => c.classList.toggle('sel', c === b)); $('parqWarn').style.display = setupAns.parq.some(v => v === 1) ? 'block' : 'none'; };
  });
  $('parqWarn').style.display = setupAns.parq.some(v => v === 1) ? 'block' : 'none';
  $('pAge').value = p.age || ''; $('pHeight').value = p.height || ''; $('pWeight').value = p.weight || '';
  ['pLevel', 'pGoal', 'pDays', 'pWeeks'].forEach(id => pick(id, setupAns[{ pLevel: 'level', pGoal: 'goal', pDays: 'days', pWeeks: 'weeks' }[id]]));
  $('weeksNote').textContent = WEEKS_NOTE[setupAns.weeks] || '';
  $('pTarget').value = p.target || '';
  $('setupErr').textContent = ''; $('goalWarn').style.display = 'none'; targetUI();
  show('setup'); $('setup').scrollTop = 0;
}
seg('pLevel', v => setupAns.level = v);
seg('pGoal', v => { setupAns.goal = v; targetUI(); });
seg('pDays', v => setupAns.days = +v);
seg('pWeeks', v => { setupAns.weeks = +v; targetUI(); $('weeksNote').textContent = WEEKS_NOTE[setupAns.weeks]; });
// v40: 목표 체중 — 감량·근육 목표일 때만. 입력하는 동안 주당 변화량과 무리 여부를 바로 보여 줌
function targetUI() {
  const on = setupAns.goal === 'diet' || setupAns.goal === 'muscle';
  $('targetBox').style.display = on ? 'block' : 'none';
  $('goalWarn').style.display = 'none'; setupAns.boost = false;
  const w = +$('pWeight').value, t = +$('pTarget').value, h = +$('pHeight').value;
  if (!on || !w || !t) { $('targetNote').textContent = on ? (setupAns.goal === 'diet' ? '감량은 주당 체중의 0.5~1%가 근육을 지키는 속도예요.' : '근육을 키울 때 체중은 주당 0.25~0.5%만 늘리는 게 좋아요.') : ''; return; }
  const g = PL.goalCheck({ weight: w, height: h, target: t, weeks: setupAns.weeks, goal: setupAns.goal });
  $('targetNote').textContent = `${setupAns.weeks}주 동안 주당 약 ${g.perWeek}kg ${g.kind === 'loss' ? '감량' : '증량'} (체중의 ${g.pct}%) · ` + (g.ok ? '무리 없는 속도예요.' : '조금 빨라요. 플랜을 만들 때 방법을 골라 드려요.');
}
['pTarget', 'pWeight', 'pHeight'].forEach(id => $(id).addEventListener('input', targetUI));
// 목표가 빠듯할 때 고르는 방법 (12단계: 기간 늘리기 추천 / 목표 조정 / 감량은 유산소·식단 강화로 그대로)
function goalWarn(g, w, h) {
  const box = $('goalWarn'); box.style.display = 'block';
  const minKg = Math.ceil(18.5 * (h / 100) ** 2 * 2) / 2;
  if (g.lowBMI) { box.innerHTML = `<b>목표 체중이 건강 체중보다 낮아요</b><br>키 ${h}cm에서는 ${minKg}kg 아래가 저체중(BMI 18.5 미만)이에요. ${minKg}kg 이상으로 정해 주세요.`; return; }
  if (g.wrongWay) { box.innerHTML = setupAns.goal === 'diet' ? '<b>목표 체중이 지금보다 높아요</b><br>체중을 늘리려면 목표를 \'근육 키우기\'로 골라 주세요.' : '<b>근육 키우기는 체중을 크게 줄이지 않아요</b><br>체중을 줄이려면 목표를 \'체중 감량\'으로 골라 주세요.'; return; }
  const loss = g.kind === 'loss', opts = [];
  if (g.extendTo && g.extendTo !== setupAns.weeks) opts.push(['extend', `기간을 ${g.extendTo}주로 늘리기 (추천)`, '근육을 지키면서 같은 목표에 갈 수 있어요.', { weeks: g.extendTo }]);
  else if (!g.extendTo) { const t12 = Math[loss ? 'ceil' : 'floor']((w + (loss ? -1 : 1) * w * (loss ? PL.RATE.lossMax : PL.RATE.gainMax) * 12) * 2) / 2; opts.push(['extend', `12주로 늘리고 목표를 ${t12}kg로 (추천)`, `지금 목표까지는 약 ${g.needWeeks}주가 걸려요. 12주 뒤 새 플랜으로 이어 가요.`, { weeks: 12, target: t12 }]); }
  opts.push(['lower', `목표를 ${g.safeTarget}kg로 조정`, `${setupAns.weeks}주에 무리 없이 갈 수 있는 목표예요.`, { target: g.safeTarget }]);
  if (loss) opts.push(['boost', '그대로 진행 (유산소 주 250분 + 식단 관리)', '운동만으로는 어려워요. 근력 운동은 그대로 하면서 유산소와 식단을 함께 늘려요.', { boost: true }]);
  box.innerHTML = `<b>${setupAns.weeks}주에 ${Math.abs(w - +$('pTarget').value).toFixed(1)}kg는 빠듯해요</b><br>주당 ${g.perWeek}kg(체중의 ${g.pct}%)는 ${loss ? '근육까지 빠지기 쉬운' : '지방이 많이 붙기 쉬운'} 속도예요. 어떻게 할까요?<div class="goalopt">`
    + opts.map(([k, t, d]) => `<button data-k="${k}"><b>${t}</b>${d}</button>`).join('') + '</div>';
  box.querySelectorAll('button').forEach(b => b.onclick = () => {
    const o = opts.find(x => x[0] === b.dataset.k)[3];
    if (o.weeks) { setupAns.weeks = o.weeks; pick('pWeeks', o.weeks); $('weeksNote').textContent = WEEKS_NOTE[o.weeks]; }
    if (o.target) $('pTarget').value = o.target;
    setupAns.forceOk = true; setupAns.boost = !!o.boost;
    $('makePlan').click();
  });
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
$('setupCancel').onclick = () => show('intro');
$('makePlan').onclick = () => {
  const age = +$('pAge').value, height = +$('pHeight').value, weight = +$('pWeight').value, err = (t) => { $('setupErr').textContent = t; };
  if (setupAns.parq.some(v => v == null)) return err('건강 확인 질문에 모두 답해 주세요.');
  if (!(age >= 14 && age <= 100)) return err('나이를 확인해 주세요. 만 14세 이상만 쓸 수 있어요.');
  if (!(height >= 120 && height <= 230) || !(weight >= 30 && weight <= 250)) return err('키와 체중을 확인해 주세요.');
  if (!setupAns.level || !setupAns.goal) return err('운동 경력과 목표를 골라 주세요.');
  err('');
  const tOn = setupAns.goal === 'diet' || setupAns.goal === 'muscle', target = tOn && +$('pTarget').value ? +$('pTarget').value : null;
  if (target && !(target >= 30 && target <= 250)) return err('목표 체중을 확인해 주세요.');
  if (target) {
    const g = PL.goalCheck({ weight, height, target, weeks: setupAns.weeks, goal: setupAns.goal });
    const boostOk = setupAns.boost && g.kind === 'loss' && !g.lowBMI && !g.wrongWay;
    if (!g.ok && !(setupAns.forceOk && (boostOk || g.ok))) { setupAns.forceOk = false; return goalWarn(g, weight, height); }
  }
  setupAns.forceOk = false;
  const old = store.plan;
  store.profile = { age, height, weight, level: setupAns.level, goal: setupAns.goal, days: setupAns.days, parq: setupAns.parq, weeks: setupAns.weeks, place: setupAns.place, target, boost: !!(target && setupAns.boost), at: Date.now() };
  store.plan = PL.makePlan(store.profile);
  // 다시 만들 때는 그동안 올린 횟수를 이어받음 (경력·건강 확인이 바뀌어도 더 쉬운 쪽을 택함)
  // 다시 만들 때는 그동안 올린 단계·횟수를 이어받음 (건강 확인 결과로 더 쉽게 시작해야 하면 새 플랜대로)
  // 체중 기록의 첫 값 (같은 날 다시 만들면 덮어씀)
  store.weights = store.weights || []; const today = PL.dayKey(new Date());
  if (store.weights.length && store.weights[store.weights.length - 1].day === today) store.weights[store.weights.length - 1].kg = weight; else store.weights.push({ day: today, kg: weight });
  if (old && old.slots) {
    if (!PL.planSpan(old).over) { store.plan.start = old.start; store.plan.phase = Math.min(old.phase ?? PL.phaseOf(old).idx, PL.phaseOf(store.plan).idx); } // 기간을 다 마친 뒤 다시 만들면 1주차부터
    if (!(store.plan.careful && !old.careful)) for (const [k, sl] of Object.entries(store.plan.slots)) { const o = old.slots[k]; if (o && (o.tier > sl.tier || (o.tier === sl.tier && o.reps > sl.reps))) Object.assign(sl, { tier: o.tier, reps: o.reps, sets: Math.max(sl.sets, o.sets) }); }
  }
  saveStore();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
  flow = 'session'; pick('flow', 'session'); slen = 'full'; pick('slen', 'full');
  applyFlow(); show('intro');
};
// 플랜의 판정 기준·푸시업 자세를 시작 화면에 반영하고, 세션 화면에서 바꾸면 플랜에 저장
function usePlanSettings() {
  if (!store.plan) return;
  mode = store.plan.mode; pick('mode', mode); $('modeNote').textContent = EX().modeNote[mode];
  pstyle = PL.styleOf(PL.SLOTS.push.ladder[store.plan.slots.push.tier]); pick('pstyle', pstyle);
}
$('mode').addEventListener('click', () => setTimeout(() => { if (flow === 'session' && store.plan) { store.plan.mode = mode; saveStore(); } }));
$('pstyle').addEventListener('click', () => setTimeout(() => { if (flow === 'session' && store.plan) { store.plan.slots.push.tier = Math.max(0, PL.PUSHUP_STEPS.indexOf(pstyle)); saveStore(); } }));
function applyFlow() {
  $('sessionBox').style.display = flow === 'session' ? 'flex' : 'none';
  $('singleBox').style.display = flow === 'session' ? 'none' : 'flex';
  $('startBtn').textContent = flow === 'session' ? '오늘의 운동 시작' : '시작하기';
  if (flow === 'session') usePlanSettings();
  applyExercise(); renderPlan();
}
seg('flow', v => { flow = v; applyFlow(); });
seg('slen', v => { slen = v; renderPlan(); });
seg('qwk', v => { qwk = v; renderPlan(); });
$('pstyle').addEventListener('click', () => setTimeout(renderPlan));

function startSession() {
  say('', true); // iOS 음성 잠금 해제 (사용자 터치 안에서)
  session = { items: buildPlan(), i: 0, startAt: Date.now(), sets: [], adj: {}, wk: todayWk, recovery: !!(store.plan && PL.weekInfo(store.plan).recovery), cond: slen === 'quick' ? null : cond };
  loadModel().catch(() => {}); // 워밍업 동안 자세 인식 모델을 미리 받아 둠
  runItem();
}
function runItem() {
  const it = session.items[session.i];
  if (!it) return finishSession();
  if (it.kind === 'timer') return runTimer(it);
  if (!EXERCISES[it.ex]) return runGuided(it);
  exercise = it.ex; if (it.ex === 'pushup' && it.style) { pstyle = it.style; pick('pstyle', pstyle); }
  applyExercise();
  target = tgt(it);
  start();
}
// 워밍업·쿨다운 타이머
let tm = null;
// 예시 동작: 처음 한 번만 불러오고, 다음 동작부터는 메시지로 바로 바꿈 (음성과 같은 순간에 바뀌게)
let movesReady = false;
$('tPrev').addEventListener('load', () => { movesReady = true; });
function showMove([, , , key, side, dir]) {
  const f = $('tPrev'); if (!key) { f.style.display = 'none'; return; }
  f.style.display = 'block';
  if (movesReady && f.contentWindow) f.contentWindow.postMessage({ type: 'move', ex: key, side, dir }, location.origin);
  else f.src = `guide.html?v=44&ex=${key}&embed=1&nocap=1${side ? '&side=' + side : ''}${dir ? '&dir=' + dir : ''}`;
}
function runTimer(it) {
  show('timer');
  tm = { it, k: 0, left: it.steps[0][2], paused: false, last: performance.now(), spoken: -1 };
  clearInterval(tm.iv); tm.iv = setInterval(tickTimer, 200); tickTimer();
}
function tickTimer() {
  const { it } = tm, now = performance.now();
  if (!tm.paused) tm.left -= (now - tm.last) / 1000;
  tm.last = now;
  if (tm.left <= 0) { tm.k += 1; if (tm.k >= it.steps.length) return endTimer(); tm.left = it.steps[tm.k][2]; }
  const [name, desc, dur] = it.steps[tm.k], nx = it.steps[tm.k + 1];
  if (tm.spoken !== tm.k) { tm.spoken = tm.k; showMove(it.steps[tm.k]); say(`${tm.k === 0 ? it.title + ' 시작. ' : ''}${name}. ${desc}`, true); }
  $('tKicker').textContent = `${it.title} · ${tm.k + 1} / ${it.steps.length}`;
  $('tName').textContent = name; $('tDesc').textContent = desc;
  $('tTime').textContent = fmt(Math.ceil(tm.left));
  $('tBar').style.width = `${(1 - tm.left / dur) * 100}%`;
  const after = session.items[session.i + 1];
  $('tNext').textContent = nx ? `다음: ${nx[0]}` : after ? `다음: ${after.ex ? exName(after.ex, after.style) + ' 시작' : '운동 요약'}` : '다음: 오늘 운동 요약';
}
function endTimer() {
  clearInterval(tm.iv);
  const it = tm.it, after = session.items[session.i + 1];
  if (it.key === 'warmup' && after && EXERCISES[after.ex]) say(`워밍업 끝. 첫 운동은 ${exName(after.ex)}${iyeyo(exName(after.ex))}. ${placeOf(after.ex)}`, true);
  session.i += 1; runItem();
}
$('tPause').onclick = () => { tm.paused = !tm.paused; $('tPause').textContent = tm.paused ? '계속하기' : '일시정지'; };
$('tSkip').onclick = () => { tm.left = 0; };
$('tSkipAll').onclick = () => { tm.k = tm.it.steps.length; tm.left = 0; };
$('tQuit').onclick = () => { clearInterval(tm.iv); finishSession(); };

// v36: 음성 안내 세트 (카메라 없이 구령·버티기 타이머). 시범 동작과 같은 박자로 셈
const doneOf = (x) => x.done != null ? x.done : x.log.filter(r => r.counted).length;
let gs = null, gReady = false;
$('gPrev').addEventListener('load', () => { gReady = true; });
function gMove(ex, side) {
  const f = $('gPrev');
  if (gReady && f.contentWindow) f.contentWindow.postMessage({ type: 'move', ex, side }, location.origin);
  else f.src = `guide.html?v=44&ex=${ex}&embed=1&nocap=1&side=${side}`;
}
function runGuided(it) {
  show('gset');
  const g = GX[it.ex], d = PL.EXDEF[it.ex], n = tgt(it), alt = !!g[4];
  const sides = d.side && !alt ? ['R', 'L'] : [null];
  gs = { it, n, sec: d.unit === 'sec', sides, si: 0, count: 0, phase: 'intro', left: 0, paused: false, last: performance.now(), per: d.unit === 'rep' ? g[3] * (alt ? 2 : 1) : 1, acc: 0, said: -1, done: [] };
  $('gKicker').textContent = `${it.set} / ${it.of}세트 · 목표 ${fmtN(it.ex, n)}${alt ? ' (양쪽 번갈아)' : ''}`;
  $('gName').textContent = exName(it.ex); $('gDesc').textContent = g[1];
  $('gSide').textContent = sides[0] ? SIDE_KO[sides[0]] + '부터' : ''; $('gCount').textContent = gs.sec ? fmt(n) : `0 / ${n}`; $('gBar').style.width = '0%';
  $('gPause').textContent = '일시정지';
  gMove(it.ex, sides[0] || 'R');
  // 첫 세트는 하는 법을 한 번 말하고, 다음 세트부터는 짧게 (사용자: 계속 말하지 말 것)
  const text = it.set === 1 ? `${exName(it.ex)}. ${g[1]}${sides[0] ? ' ' + SIDE_KO[sides[0]] + '부터 해요.' : ''}` : `${it.set}세트예요.${sides[0] ? ' ' + SIDE_KO[sides[0]] + '부터.' : ''}`;
  gs.left = it.set === 1 ? Math.min(16, 2 + text.length * 0.09) : 2.5;
  say(text, true);
  clearInterval(gs.iv); gs.iv = setInterval(gTick, 100); gTick();
}
function gTick() {
  const now = performance.now(), dt = gs.paused ? 0 : (now - gs.last) / 1000 * (window.__gfast || 1); gs.last = now; // __gfast: 시험용 빨리 감기
  const { n, sides } = gs;
  if (gs.phase === 'intro' || gs.phase === 'switch') {
    gs.left -= dt;
    if (gs.left <= 0) { gs.phase = 'count'; gs.left = 3; gs.said = -1; }
    return;
  }
  if (gs.phase === 'count') {
    gs.left -= dt; const k = Math.ceil(gs.left);
    if (k !== gs.said && k > 0) { gs.said = k; say(NUM[k] === '하나' ? '하나' : ['', '하나', '둘', '셋'][k], true); $('gCount').textContent = k; }
    if (gs.left <= 0) { gs.phase = 'work'; gs.acc = 0; gs.count = 0; gs.left = n; gs.said = -1; say('시작', true); gMove(gs.it.ex, sides[gs.si] || 'R'); }
    return;
  }
  // work
  if (gs.sec) {
    gs.left -= dt; const k = Math.ceil(gs.left);
    $('gCount').textContent = fmt(Math.max(0, k)); $('gBar').style.width = `${(1 - gs.left / n) * 100}%`;
    if (k !== gs.said) {
      gs.said = k;
      if (k === Math.floor(n / 2) && n >= 20) say('절반 지났어요. 자세 그대로', true);
      else if (k <= 3 && k >= 1) say(['', '하나', '둘', '셋'][k], true);
    }
    if (gs.left <= 0) gSideDone(n);
  } else {
    gs.acc += dt;
    if (gs.acc >= gs.per) {
      gs.acc -= gs.per; gs.count += 1;
      say(NUM[gs.count] || String(gs.count), true);
      $('gCount').textContent = `${gs.count} / ${n}`; $('gBar').style.width = `${gs.count / n * 100}%`;
      if (gs.count >= n) gSideDone(n);
    }
  }
}
function gSideDone(v) {
  gs.done.push(v);
  if (gs.si + 1 < gs.sides.length) {
    gs.si += 1; gs.phase = 'switch'; gs.left = 4;
    const s = gs.sides[gs.si];
    $('gSide').textContent = SIDE_KO[s]; $('gCount').textContent = gs.sec ? fmt(gs.n) : `0 / ${gs.n}`; $('gBar').style.width = '0%';
    say(`좋아요. 이제 ${SIDE_KO[s]}이에요. 자세를 바꿔 주세요.`, true); gMove(gs.it.ex, s);
    return;
  }
  gFinish(false);
}
function gFinish(early) {
  clearInterval(gs.iv);
  const { it, n } = gs;
  let cur = 0;
  if (early && gs.phase === 'work') cur = gs.sec ? Math.max(0, Math.round(n - gs.left)) : gs.count;
  const done = early ? Math.min(...[...gs.done, cur]) : n;
  session.sets.push({ slot: it.slot, ex: it.ex, style: it.style, set: it.set, of: it.of, target: n, guided: true, done, log: [], rpe: null, cue: {}, norep: {} });
  if (!early) say('세트 완료!', true);
  showRest();
}
// 카메라로 잘 안 될 때: 이번 세트만 음성 안내(구령·타이머)로
$('noCamBtn').onclick = () => {
  if (!session) return;
  running = false; cancelAnimationFrame(rafId); speechSynthesis.cancel();
  runGuided(session.items[session.i]);
};
$('gPause').onclick = () => { gs.paused = !gs.paused; $('gPause').textContent = gs.paused ? '계속하기' : '일시정지'; if (gs.paused) speechSynthesis.cancel(); };
$('gDone').onclick = () => gFinish(true);
$('gQuit').onclick = () => { clearInterval(gs.iv); finishSession(); };

// 세트 끝 → 기록 → 휴식
function sessionSetDone() {
  running = false; cancelAnimationFrame(rafId);
  const it = session.items[session.i];
  if (!cs.closed) { cs.logs.push(...curLog()); cs.done.push(curDone()); cs.closed = true; }
  const log = cs.logs, done = Math.min(...cs.done);
  session.sets.push({ slot: it.slot, ex: it.ex, set: it.set, of: it.of, target: target / (cs.mul || 1), log, done, rpe: null, cue: CUE_TEXT, norep: NOREP_TEXT, mode, style: it.style || pstyle });
  showRest();
}
let rs = null;
function showRest() {
  const done = session.sets[session.sets.length - 1], it = session.items[session.i], nx = session.items[session.i + 1];
  const counted = doneOf(done), avg = done.log.length ? Math.round(done.log.reduce((a, r) => a + r.score, 0) / done.log.length) : null;
  $('rTitle').textContent = `${exName(done.ex, done.style)} ${done.set} / ${done.of}세트 완료 · ${fmtN(done.ex, counted)}`;
  // 이번 세트에서 가장 많이 나온 지적 하나
  const cnt = {}; done.log.forEach(r => (r.faults || []).forEach(f => { if (f !== 'tempo' || true) cnt[f] = (cnt[f] || 0) + 1; }));
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  $('rScore').innerHTML = done.guided ? (counted >= done.target ? `목표 ${fmtN(done.ex, done.target)}를 다 했어요.` : `목표 ${fmtN(done.ex, done.target)} 중 ${fmtN(done.ex, counted)} 했어요. 횟수보다 자세가 먼저예요.`) : avg == null ? '이번 세트는 인식된 반복이 없어요.' : `<b>자세 점수 평균 ${avg}점</b>${done.log.length > counted ? ` · 안 센 반복 ${done.log.length - counted}회` : ''}<br>${top ? `다음 세트에서는: ${done.cue[top[0]] || top[0]} (${top[1]}회 지적)` : '지적 없이 좋았어요.'}`;
  [...$('rpe').children].forEach(b => b.classList.remove('sel'));
  $('rpeNote').textContent = '답에 따라 다음 세트의 횟수를 조절해요.';
  const changing = nx && nx.kind === 'set' && nx.ex !== done.ex;
  if (nx && nx.kind === 'set') {
    $('rNextT').textContent = `다음: ${exName(nx.ex, nx.style)} ${nx.set} / ${nx.of}세트 · ${fmtN(nx.ex, tgt(nx))}`;
    $('rPlace').textContent = changing ? placeOf(nx.ex) : '같은 자리에서 이어서 해요.';
    const src = JUDGED3.includes(nx.ex) ? `guide.html?ex=${nx.ex}&embed=1${nx.ex === 'pushup' ? '&style=' + ((nx.style || pstyle) === 'full' ? 'full' : 'knees') : ''}` : `guide.html?v=44&ex=${nx.ex}&embed=1&nocap=1`;
    if ($('rPrev').getAttribute('src') !== src) $('rPrev').setAttribute('src', src);
    $('rPrev').style.display = 'block';
  } else { $('rNextT').textContent = '다음: 쿨다운 5분'; $('rPlace').textContent = '마지막 세트까지 끝났어요. 체감 강도를 누르고 쿨다운을 시작하세요.'; $('rPrev').style.display = 'none'; $('rPrev').removeAttribute('src'); }
  const restSec = nx && nx.kind === 'set' ? it.rest : 0;
  rs = { left: restSec, last: performance.now(), warned: false };
  $('rBtns').style.display = restSec ? 'grid' : 'none'; $('rTime').style.display = restSec ? 'block' : 'none';
  $('rGo').style.display = restSec ? 'none' : 'block'; $('rGo').textContent = nx ? '쿨다운 시작' : '요약 보기';
  show('rest');
  say(`${counted}${isSec(done.ex) ? '초' : '회'} 완료. 얼마나 힘들었는지 눌러 주세요.${changing ? ' 다음은 ' + exName(nx.ex) + iyeyo(exName(nx.ex)) + '. ' + placeOf(nx.ex) : ''}`, true);
  clearInterval(rs.iv); if (restSec) rs.iv = setInterval(tickRest, 200);
  tickRest();
}
function tickRest() {
  if (!rs.left && !rs.iv) return;
  const now = performance.now(); rs.left -= (now - rs.last) / 1000; rs.last = now;
  $('rTime').textContent = fmt(Math.ceil(Math.max(0, rs.left)));
  if (!rs.warned && rs.left <= 10) { rs.warned = true; say('10초 뒤에 다음 세트를 시작해요. 자리로 가 주세요.', true); }
  if (rs.left <= 0) endRest();
}
function endRest() { clearInterval(rs.iv); rs.iv = null; session.i += 1; runItem(); }
$('rPlus').onclick = () => { rs.left += 30; rs.warned = rs.left <= 10; };
$('rSkip').onclick = endRest;
$('rGo').onclick = endRest;
$('rQuit').onclick = () => { clearInterval(rs.iv); finishSession(); };
$('rpe').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  [...$('rpe').children].forEach(c => c.classList.toggle('sel', c === b));
  const last = session.sets[session.sets.length - 1], prev = last.rpe; last.rpe = b.dataset.v;
  // 같은 종목의 다음 세트 횟수를 조절 (쉬웠어요 +2, 한계예요 -2, 5~15회)
  const d = RPE[b.dataset.v][1] - (prev ? RPE[prev][1] : 0); session.adj[last.ex] = (session.adj[last.ex] || 0) + d;
  const nx = session.items[session.i + 1];
  if (nx && nx.kind === 'set' && nx.ex === last.ex) {
    const n = tgt(nx);
    $('rpeNote').textContent = d || session.adj[last.ex] ? `다음 세트는 ${fmtN(nx.ex, n)}로 할게요.` : '다음 세트도 같게 해요.';
    $('rNextT').textContent = `다음: ${exName(nx.ex, nx.style)} ${nx.set} / ${nx.of}세트 · ${fmtN(nx.ex, n)}`;
  } else $('rpeNote').textContent = b.dataset.v === 'easy' ? '다음 운동에서 이 종목을 늘릴게요.' : b.dataset.v === 'max' ? '다음 운동에서 이 종목을 줄일게요.' : '기록했어요.';
});

// 오늘 운동 요약 (와이어프레임 '종료 요약'과 같은 구성)
function finishSession() {
  running = false; cancelAnimationFrame(rafId);
  // 남아 있는 타이머(쿨다운·휴식·음성 안내 세트)를 모두 멈춤 — 끝낸 뒤 화면이 다시 바뀌지 않게
  if (tm) clearInterval(tm.iv); if (rs) { clearInterval(rs.iv); rs.iv = null; } if (gs) clearInterval(gs.iv);
  if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
  const S = session; if (!S) return;
  const mins = Math.max(1, Math.round((Date.now() - S.startAt) / 60000)), planned = S.items.filter(i => i.kind === 'set').length;
  const total = S.sets.filter(x => !isSec(x.ex)).reduce((a, x) => a + doneOf(x), 0);
  $('dKicker').textContent = `${slen === 'quick' ? '빠른 체험' : '오늘의 운동'} · ${mode === 'strict' ? '정확하게' : '편하게'} 모드`;
  $('dTime').textContent = mins + '분'; $('dSets').textContent = `${S.sets.length} / ${planned}`; $('dReps').textContent = total + '회';
  const byEx = {};
  S.sets.forEach(x => { (byEx[x.ex] = byEx[x.ex] || []).push(x); });
  $('dEx').innerHTML = Object.entries(byEx).map(([ex, xs]) => {
    const reps = xs.flatMap(x => x.log), c = xs.reduce((a, x) => a + doneOf(x), 0), avg = reps.length ? Math.round(reps.reduce((a, r) => a + r.score, 0) / reps.length) : '-';
    return `<div class="card"><b>${exName(ex, xs[0].style)}</b> · ${xs.length}세트 · ${c}${isSec(ex) ? '초' : '회'}${xs[0].guided ? ' · 음성 안내' : ' · 자세 평균 ' + avg + (avg === '-' ? '' : '점')}<br><span class="note">체감: ${xs.map(x => x.rpe ? RPE[x.rpe][0] : '-').join(', ')}</span></div>`;
  }).join('') || '<p class="note">완료한 세트가 없어요.</p>';
  const tips = {};
  S.sets.forEach(x => x.log.forEach(r => (r.faults || []).forEach(f => { const k = x.ex + ':' + f; tips[k] = tips[k] || { n: 0, text: x.cue[f] || f, ex: x.ex }; tips[k].n += 1; })));
  const top = Object.values(tips).sort((a, b) => b.n - a.n).slice(0, 2);
  $('dTips').innerHTML = top.length ? top.map((t, i) => `<div class="rep" style="flex-wrap:nowrap"><span class="n">${i + 1}</span><span class="d"><b>${t.text}</b><br><small>${exName(t.ex)} · ${t.n}회 지적</small></span></div>`).join('') : (total ? '<p class="note">지적받은 자세가 없어요. 잘했어요!</p>' : '<p class="note">인식된 반복이 없어요. 휴대폰 위치를 확인해 보세요.</p>');
  const rp = S.sets.map(x => x.rpe).filter(Boolean), easy = rp.filter(v => v === 'easy').length, hard = rp.filter(v => v === 'max').length;
  $('dNext').textContent = easy > rp.length / 2 ? '대부분 쉬웠어요. 다음 운동은 종목당 횟수를 2회씩 늘려요.' : hard ? '한계였던 세트가 있었어요. 다음 운동은 그 종목 횟수를 줄여요.' : '강도가 적당했어요. 다음 운동도 같은 구성으로 해요.';
  // v31: 기록 저장 + 내 플랜이면 다음 운동 횟수 조절 (빠른 체험은 기록만)
  if (!S.saved && S.sets.length) {
    S.saved = true;
    const sets = S.sets.map(x => ({ slot: x.slot, ex: x.ex, style: x.style, set: x.set, target: x.target, counted: doneOf(x), attempts: x.guided ? null : x.log.length, avg: x.log.length ? Math.round(x.log.reduce((a, r) => a + r.score, 0) / x.log.length) : null, rpe: x.rpe }));
    const quick = slen === 'quick';
    store.history.push({ day: PL.dayKey(new Date()), at: Date.now(), quick, wk: S.wk, mins, mode, sets, ...(S.cond && (S.cond.level !== 'good' || S.cond.parts.length) ? { cond: S.cond } : {}) });
    if (store.history.length > 300) store.history.splice(0, store.history.length - 300);
    if (!quick && store.plan) {
      const ch = PL.progress(store.plan, sets, S.recovery);
      const WHY = { easy: '쉬웠다고 해서', hit: '목표를 다 채워서', same: '그대로 한 번 더', max: '한계였던 세트가 있어서', missed: '목표의 70%를 못 채워서', addSet: '충분해서 세트를 하나 늘려요', nextStep: '더 어려운 동작으로 올라가요!', phaseHold: '어려운 동작은 발전 단계(5주차)부터 해요', top: '최고 단계예요. 지금을 유지해요', recovery: '회복 주라 그대로', partial: S.cond && S.cond.level !== 'good' ? '컨디션에 맞춰 줄인 날이라 그대로' : '세트를 다 못 해서 그대로' };
      const nm = (e) => exName(PL.exOf(e), PL.styleOf(e)), u = (e, n) => `${n}${isSec(PL.exOf(e)) ? '초' : '회'}`;
      const lines = Object.values(ch).map((c) => {
        const f = c.from, t = c.to;
        if (c.why === 'nextStep') return `${nm(f.entry)} → <b>${nm(t.entry)}</b> ${t.sets}세트 × ${u(t.entry, t.reps)} · ${WHY[c.why]}`;
        const changed = f.reps !== t.reps || f.sets !== t.sets;
        return `${nm(t.entry)}: ${changed ? `${f.sets}×${u(f.entry, f.reps)} → <b>${t.sets}세트 × ${u(t.entry, t.reps)}</b>` : `<b>${t.sets}세트 × ${u(t.entry, t.reps)}</b>`} · ${WHY[c.why]}`;
      });
      if (lines.length) $('dNext').innerHTML = '<b>다음 운동</b><br>' + lines.join('<br>');
    }
    if (S.cond && (S.cond.level !== 'good' || S.cond.parts.length)) {
      const why = [S.cond.level !== 'good' ? COND_KO[S.cond.level] : '', ...S.cond.parts.map(p => PART_KO[p])].filter(Boolean).join(', ');
      $('dNext').innerHTML = `<span class="note">오늘은 컨디션(${why})에 맞춰 바꿔서 했어요. 뺀 종목은 다음에 그대로 이어서 해요.</span><br>` + $('dNext').innerHTML;
    }
    saveStore();
  }
  show('done'); say('오늘 운동 끝! 수고했어요.', true);
}
$('dHome').onclick = () => { session = null; cond = null; show('intro'); $('startBtn').disabled = false; applyFlow(); };
$('dCopy').onclick = async () => {
  const S = session; if (!S) return;
  const lines = [`오늘의 운동 데모 v44 결과 [${mode}·구성 ${S.wk}·${slen === 'quick' ? '빠른 체험' : '전체'}] (${new Date().toLocaleString('ko-KR')})`, `카메라: ${camLabel}`];
  for (const x of S.sets) {
    lines.push(`■ ${exName(x.ex, x.style)} ${x.set}/${x.of}세트 (목표 ${fmtN(x.ex, x.target)}, 체감 ${x.rpe ? RPE[x.rpe][0] : '-'})${x.guided ? ` · 음성 안내 · ${fmtN(x.ex, x.done)} 함` : ''}`);
    if (!x.guided) x.log.forEach(r => lines.push(`${r.n}회: ${r.counted ? '카운트 ' + r.count : '안 셈(' + r.noRep + ')'} · ${r.score}점 ${r.faults.join('+') || 'ok'} / ${EXERCISES[x.ex].line(r)}`));
  }
  try { await navigator.clipboard.writeText(lines.join('\n')); $('dCopy').textContent = '복사했어요'; } catch { $('dCopy').textContent = '복사하지 못했어요'; }
  setTimeout(() => $('dCopy').textContent = '결과 복사하기', 2000);
};
window.__session = { get: () => session, finish: finishSession, endSet: () => endSet(), sideDone: () => camSideDone(), counter: () => counter, endTimer: () => { if (tm) { tm.k = tm.it.steps.length; tm.left = 0; } } };
// v41: 앱 화면 — 테스트 도구(종목 하나 테스트·수치 보기·결과 복사)는 켰을 때만 보임
function applyDev() {
  document.body.classList.toggle('dev', !!store.dev);
  $('devBtn').textContent = store.dev ? '테스트 도구 끄기' : '테스트 도구 켜기';
  if (!store.dev && flow !== 'session') { flow = 'session'; pick('flow', 'session'); }
}
$('devBtn').onclick = () => { store.dev = !store.dev; saveStore(); applyDev(); applyFlow(); };
applyDev();
applyFlow();
// 처음 연 사람에게만 안내 화면
$('wMake').onclick = () => { store.seen = 1; saveStore(); openSetup(); };
$('wLater').onclick = () => { store.seen = 1; saveStore(); show('intro'); };
if (!store.seen) { if (!store.plan && !store.history.length) show('welcome'); else { store.seen = 1; saveStore(); } }

function fillVoices() {
  const sel = $('voiceSel'), vs = koVoices(), cur = koVoice();
  sel.innerHTML = '';
  if (!vs.length) { const o = document.createElement('option'); o.textContent = '기본 음성'; sel.append(o); return; }
  vs.forEach(v => { const o = document.createElement('option'); o.value = v.voiceURI; o.textContent = v.name + (voiceRank(v) < 2 ? ' ★' : ''); sel.append(o); });
  if (cur) sel.value = cur.voiceURI;
}
$('voiceSel').onchange = () => { voicePick = $('voiceSel').value; try { localStorage.setItem('voiceURI', voicePick); } catch {} $('voiceTest').click(); };
$('voiceTest').onclick = () => { const was = voice; voice = true; say('좋아요, 세 번. 무릎이 안으로 모이지 않게 바깥으로 밀어 주세요.', true); voice = was; };
if ('speechSynthesis' in window) { speechSynthesis.getVoices(); speechSynthesis.addEventListener('voiceschanged', fillVoices); }
fillVoices();
