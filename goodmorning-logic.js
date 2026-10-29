// 굿모닝(맨몸 힙힌지) 판정 로직 v7 (데모 v26) (브라우저·Node 공용, 외부 의존성 없음)
// 입력: MediaPipe Pose 랜드마크 33개 [{x, y, z, visibility}], 좌표는 0~1 정규화(y는 아래로 증가)
// 스쿼트·푸시업 로직과 같은 구조와 이벤트를 씀.
//
// 동작: 손을 가슴에 모으고 무릎은 살짝만 굽힌 채, 엉덩이를 뒤로 밀며 상체를 숙였다가 일어남.
// 데드리프트·덤벨 RDL과 같은 '엉덩이 접기(힙힌지)' 동작이라 이 판정을 나중에 그대로 씀.
// 반복은 상체 기울기(수직 기준)로 셈: 서 있으면 0°, 바닥과 평행이면 90°.
// 측면 카메라로는 허리가 둥글게 말리는지 직접 볼 수 없음 → 귀-어깨-엉덩이 각도(머리·등 숙임)를
// 대신 기록만 하고, 실측 데이터로 검증된 뒤에 판정에 넣음 (스쿼트 뒤꿈치와 같은 방식).

const L = { ear: 7, shoulder: 11, hip: 23, knee: 25, ankle: 27 };
const R = { ear: 8, shoulder: 12, hip: 24, knee: 26, ankle: 28 };
const CORE = ['shoulder', 'hip', 'knee', 'ankle'];

// 공통 기준값 (근거: NSCA 힙힌지 코칭 — 무릎은 15~20° 정도만 굽히고, 등은 곧게, 엉덩이를 뒤로 밀며
// 햄스트링이 당기는 지점(보통 상체 45~90°)까지 숙임. 실제 사용자 데이터로 계속 조정)
export const THRESHOLDS = {
  minVisibility: 0.6,
  edgeMargin: 0.02,
  sideMaxSpread: 0.45,  // 양쪽 어깨·엉덩이 가로 간격 / 몸통 길이가 이보다 크면 정면
  readyMs: 1000,
  readyLean: 20,        // 준비: 상체가 수직에서 20° 이내
  readyKnee: 150,       // 준비: 무릎이 거의 펴짐
  readyMotion: 6,       // 준비 중 상체 기울기 흔들림 허용(°)
  startLean: 22,        // 이보다 숙이면 반복 시작
  returnLean: 15,       // 이 안으로 돌아오면 반복 완료
  leaveLean: 10,        // 숙이기 시작한 시점(하강 속도 계산용)
  countLean: 28,        // 이보다 덜 숙이면 얕은 움직임으로 보고 세지 않음
  overLean: 90,         // 바닥과 평행보다 많이 숙임 (v20: 100 → 90)
  lockKnee: 172,        // v20: 무릎을 다 편 채 숙임 (실측: 바른 반복 156~167°, 막 숙인 반복 175~177°)
  headFault: 132,       // v24: 등 휨으로 등 말림을 직접 보게 돼서 고개 기준은 완화 (5차 실측 바른 반복 137~151°)
  torsoFallback: 78,    // v26: 등 휨을 못 잴 때(윤곽 없음)만 몸통 길이로 판단, 아주 크게 줄었을 때만
  torsoFault: 92,       // v23: 몸통 길이가 서 있을 때의 92% 미만이면 등이 말린 것 (실측: 바른 반복 95~107%, 등 만 반복 77~90%)
  curveFault: 3.5,      // v24: 등 윤곽 휨(몸통 길이 대비 %). 5차 실측: 바른 반복 1.3~1.9%, 등 말린 반복 5.0~10.4%
  headFaultOld: 145,       // v20: 머리-등 각이 이보다 작으면 등이 굽음·고개 떨굼 (실측: 바른 반복 157° 이상, 등 굽힌 반복 103~133°)
  headNoRep: 125,       // 이보다 작으면 모드와 상관없이 안 셈 (안전)
  hipBackMin: 0.09,     // v20: 엉덩이가 발목보다 다리 길이의 9% 이상 뒤로 빠져야 힙힌지 (실측: 바른 반복 10~13%, 허리로 숙인 반복 1~8%)
  minRepMs: 600,
  fastDescentMs: 1500,  // 이보다 빨리 숙이면 "천천히" (v21: 1.2 → 1.5초. 실측 바른 반복 1.5~2.8초, 대충 숙인 반복 0.4~1.2초)
  noRepDepthOver: 15,   // 깊이 기준보다 15° 넘게 덜 숙이면 세지 않음
  lostMs: 2500,
  smoothing: 0.5,
};

// 판정 강도
export const MODES = {
  // 편하게: 상체 45°까지 숙이면 인정, 무릎 130°보다 더 굽히면 지적, 110°보다 더 굽히면 스쿼트가 된 것으로 보고 안 셈
  // v20 1차 실측(정확하게 63%): 등 굽힘·허리로 숙임·무릎 편 채 빠르게 숙인 반복을 셈 → 아래 안 셈 기준 추가
  relaxed: { depthLean: 45, kneeMin: 130, noRepKnee: 110, noRepHipBack: 0.08, noRepLock: false, noRepFastMs: 1000, noRepDepthOver: 5, noRepTorso: 88, noRepCurve: 5 },
  // 정확하게: 상체 70°(바닥과 거의 평행), 무릎 145°, 125°
  strict: { depthLean: 70, kneeMin: 140, noRepKnee: 125, noRepHipBack: 0.08, noRepLock: true, noRepFastMs: 1000, noRepTorso: 92, noRepCurve: 4 },
  // v25: 사용자 '바르게 해도 안 셈' → 등 휨을 바닥 구간 중앙값으로 재고, 안 셈 기준 정확하게 3.5 → 5%, 편하게 4.5 → 6%(지적은 3.5% 그대로)
  // v26: 등 휨이 등 말림을 잡으니, 빠르게 숙임으로 안 세는 기준은 1.2 → 1.0초 (6차 실측 바른 반복 1.08초)
  //      등 휨 안 셈 기준: 정확하게 4%, 편하게 5% (바른 반복 0~1.9%, 등 말림 5.0~10.4%)
  // v24 5차 실측(정확하게 63%): 몸통 길이로 못 잡은 등 말림을 등 휨(윤곽)이 모두 잡음 → 판정에 넣음. 바른 반복의 무릎 144° 지적이 엄격 → 무릎 지적 145 → 140°
  // v21 2차 실측(편하게): 30~39°만 살짝 숙여도 셈, 등을 말고 고개는 든 채 1~1.2초에 숙인 반복도 셈
  // → 편하게도 40° 미만은 안 셈, 1.2초보다 빠르게 숙이면 두 모드 모두 안 셈(통제 안 된 동작)
  // v22 3차 실측(편하게 19/19 일치): 바른 반복도 엉덩이 뒤로 8~9%가 나와 정확하게 안 셈 기준 9% → 8%
};

const deg = (r) => (r * 180) / Math.PI;
function angle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (m === 0) return 180;
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / m))));
}
// 어깨가 엉덩이에서 수직선과 이루는 각 (0 = 똑바로 섬, 90 = 바닥과 평행, 90 넘으면 머리가 엉덩이보다 아래)
function leanFromVertical(sh, hip) {
  return deg(Math.atan2(Math.abs(sh.x - hip.x), hip.y - sh.y));
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function measure(lm, aspect = 1) {
  if (!lm || lm.length < 33) return { visible: false, reason: 'none' };
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, v: lm[i].visibility ?? 0, rx: lm[i].x });
  const vis = (s) => CORE.reduce((t, k) => t + P(s[k]).v, 0) / CORE.length;
  const side = vis(L) >= vis(R) ? L : R;
  const j = Object.fromEntries(Object.keys(L).map((k) => [k, P(side[k])]));
  const t = THRESHOLDS;
  const minVis = Math.min(...CORE.map((k) => j[k].v));
  // 카메라를 가까이 둘 수 있게 어깨·엉덩이·무릎·발목만 화면 안에 있으면 됨(머리·발끝은 잘려도 됨)
  const inFrame = CORE.every((k) => j[k].rx > t.edgeMargin && j[k].rx < 1 - t.edgeMargin && j[k].y > t.edgeMargin && j[k].y < 1 - t.edgeMargin);
  if (minVis < t.minVisibility || !inFrame) return { visible: false, reason: 'not_in_frame' };

  const torsoLen = dist(j.shoulder, j.hip);
  const legLen = dist(j.hip, j.knee) + dist(j.knee, j.ankle);
  if (torsoLen < 0.05 || legLen < 0.08) return { visible: false, reason: 'too_far' };
  // 숙이면 어깨 가로 간격이 몸통 길이 대비 커 보일 수 있어, 엉덩이 간격을 더 믿음
  const spread = (Math.abs(P(L.shoulder).x - P(R.shoulder).x) * 0.4 + Math.abs(P(L.hip).x - P(R.hip).x) * 0.6) / torsoLen;
  const lean = leanFromVertical(j.shoulder, j.hip);
  const dir = Math.sign(j.shoulder.x - j.hip.x) || 1; // 몸이 향한 쪽(숙이면 어깨가 가는 쪽)
  return {
    visible: true,
    side: side === L ? 'left' : 'right',
    sideView: spread < t.sideMaxSpread,
    spread,
    lean,
    hip: angle(j.shoulder, j.hip, j.knee),
    knee: angle(j.hip, j.knee, j.ankle),
    // 엉덩이가 발목보다 뒤로 빠진 정도(다리 길이 대비). 바른 힙힌지는 엉덩이가 뒤로 감
    hipBack: ((j.ankle.x - j.hip.x) * dir) / legLen,
    // 머리·등 숙임 대용 지표: 귀-어깨-엉덩이 각 (곧으면 160° 이상, 등을 말거나 고개를 떨구면 작아짐). 기록만
    head: j.ear.v >= 0.5 ? angle(j.ear, j.shoulder, j.hip) : null,
    legLen,
    torsoRatio: torsoLen / legLen, // v21: 등을 말면 어깨가 엉덩이 쪽으로 붙어 몸통이 짧아 보임 → 기록만
  };
}

const CUES = ['back', 'head', 'hips', 'knee', 'lock', 'depth', 'over', 'tempo'];
export const CUE_TEXT = {
  back: '등이 둥글게 말려요. 가슴을 펴고 등을 곧게 펴세요',
  head: '고개를 들고 등을 곧게 펴세요',
  hips: '허리로 숙이지 말고 엉덩이를 뒤로 빼세요',
  lock: '무릎을 살짝 굽혀주세요',
  knee: '무릎은 살짝만 굽히고 엉덩이를 뒤로 빼세요',
  depth: '등을 편 채로 조금 더 숙여주세요',
  over: '바닥과 평행까지만 숙이세요',
  tempo: '천천히 숙이세요',
  shallow: '엉덩이를 뒤로 빼면서 더 숙여야 한 번으로 세요',
};
export const NOREP_TEXT = {
  back: '등이 말려서 이번은 세지 않아요',
  head: '등이 굽어서 이번은 세지 않아요',
  hips: '엉덩이를 뒤로 빼지 않아서 이번은 세지 않아요',
  lock: '무릎을 편 채 숙여서 이번은 세지 않아요',
  tempo: '너무 빨리 숙여서 이번은 세지 않아요',
  knee: '무릎을 많이 굽혀 스쿼트가 됐어요. 이번은 세지 않아요',
  depth: '더 숙여야 세요',
};

export class GoodMorningCounter {
  constructor(mode = 'relaxed') { this.setMode(mode); this.reset(); }
  setMode(mode) { this.mode = MODES[mode] ? mode : 'relaxed'; this.t = { ...THRESHOLDS, ...MODES[this.mode] }; }
  reset() {
    this.state = 'setup';
    this.reps = 0;
    this.attempts = 0;
    this.repLog = [];
    this.readySince = null;
    this.readyLean = [];
    this.lostSince = null;
    this.s = null;
    this.cur = null;
    this.leaveAt = null;
    this.lastRepAt = -1e9;
    this.cueStreak = { cue: null, count: 0 };
    this.shallowSpoken = 0;
  }
  _smooth(m) {
    const a = this.t.smoothing;
    if (!this.s) { this.s = { ...m }; return this.s; }
    for (const k of ['lean', 'hip', 'knee', 'hipBack', 'legLen', 'torsoRatio']) this.s[k] = a * m[k] + (1 - a) * this.s[k];
    this.s.head = m.head == null ? null : this.s.head == null ? m.head : a * m.head + (1 - a) * this.s.head;
    return this.s;
  }

  update(m, now) {
    const t = this.t;
    if (!m || !m.visible || !m.sideView) {
      this.readySince = null; this.readyLean = [];
      if (this.state !== 'setup') {
        if (this.lostSince === null) this.lostSince = now;
        if (now - this.lostSince > t.lostMs) { this.state = 'setup'; this.cur = null; this.s = null; return { event: 'lost' }; }
      }
      return { event: m && m.visible ? 'not_side' : 'not_visible', reason: m && m.reason };
    }
    this.lostSince = null;
    const s = this._smooth(m);

    if (this.state === 'setup') {
      if (s.lean > t.readyLean || s.knee < t.readyKnee) { this.readySince = null; this.readyLean = []; return { event: 'setup', hint: 'stand' }; }
      if (this.readySince === null) this.readySince = now;
      this.readyLean.push(s.lean);
      this.readyTorso = (this.readyTorso ?? s.torsoRatio) * 0.8 + s.torsoRatio * 0.2;
      if (Math.max(...this.readyLean) - Math.min(...this.readyLean) > t.readyMotion) { this.readySince = now; this.readyLean = [s.lean]; return { event: 'setup', hint: 'still' }; }
      if (now - this.readySince >= t.readyMs) {
        this.state = 'up'; this.baseTorso = this.readyTorso; this.readyTorso = null;
        return { event: 'ready', resumed: this.attempts > 0 };
      }
      return { event: 'setup', hint: 'hold', progress: (now - this.readySince) / t.readyMs };
    }

    if (this.state === 'up') {
      if (s.lean > t.leaveLean) { if (this.leaveAt == null) this.leaveAt = now; } else this.leaveAt = null;
      if (s.lean > t.startLean) {
        this.state = 'down';
        this.cur = { startAt: this.leaveAt ?? now, bottomAt: now, maxLean: s.lean, minHip: s.hip, minKnee: s.knee, maxHipBack: s.hipBack, minHead: s.head, minTorso: s.torsoRatio, maxCurve: null, curves: [] };
      }
      return { event: 'tracking', lean: s.lean };
    }

    // state === 'down'
    const c = this.cur;
    if (s.lean > c.maxLean) { c.maxLean = s.lean; c.bottomAt = now; }
    c.minHip = Math.min(c.minHip, s.hip);
    c.minKnee = Math.min(c.minKnee, s.knee);
    c.maxHipBack = Math.max(c.maxHipBack, s.hipBack);
    if (s.lean > t.countLean) c.minTorso = Math.min(c.minTorso, s.torsoRatio);
    if (m.curve != null && s.lean > t.countLean) c.curves.push([s.lean, m.curve]);
    if (s.head != null && s.lean > t.countLean) c.minHead = c.minHead == null ? s.head : Math.min(c.minHead, s.head);
    if (s.lean < t.returnLean) {
      this.state = 'up'; this.cur = null; this.leaveAt = null;
      if (now - this.lastRepAt < t.minRepMs || now - c.startAt < t.minRepMs) return { event: 'ignored' };
      if (c.maxLean < t.countLean) {
        const speak = this.shallowSpoken < 2; if (speak) this.shallowSpoken += 1;
        return { event: 'shallow', speak };
      }
      this.lastRepAt = now;
      return this._finishRep(c);
    }
    return { event: 'tracking', lean: s.lean };
  }

  _finishRep(c) {
    const t = this.t;
    const faults = [];
    const depthOk = c.maxLean >= t.depthLean;
    const descent = c.bottomAt - c.startAt;
    // v25: 등 휨은 가장 많이 숙인 구간(최대 기울기 -10° 이내)의 중앙값으로 (v24는 최댓값이라 한 프레임만 튀어도 안 셈)
    if (c.curves && c.curves.length) {
      let b = c.curves.filter(([l]) => l >= c.maxLean - 10).map(([, v]) => v);
      if (b.length < 3) b = c.curves.map(([, v]) => v);
      b.sort((x, y) => x - y); c.maxCurve = b[Math.floor(b.length / 2)];
    }
    const torsoPct = this.baseTorso ? c.minTorso / this.baseTorso * 100 : null;
    // v26: 몸통 길이는 세트 중에 서는 위치·무릎 굽힘에 따라 흔들려서(6차 실측: 같은 바른 자세가 80~95%) 등 휨이 있으면 등 휨만 씀
    const backBad = c.maxCurve != null ? c.maxCurve > t.curveFault : torsoPct != null && torsoPct < t.torsoFallback;
    if (backBad) faults.push('back');
    if (c.minHead != null && c.minHead < t.headFault) faults.push('head');
    if (c.maxHipBack < t.hipBackMin) faults.push('hips');
    if (c.minKnee < t.kneeMin) faults.push('knee');
    if (c.minKnee > t.lockKnee) faults.push('lock');
    if (!depthOk) faults.push('depth');
    if (c.maxLean > t.overLean) faults.push('over');
    if (descent < t.fastDescentMs) faults.push('tempo');
    let score = 100;
    if (faults.includes('knee')) score -= Math.min(30, (t.kneeMin - c.minKnee) * 1.5 + 10);
    if (!depthOk) score -= Math.min(35, (t.depthLean - c.maxLean) * 1.5 + 10);
    if (faults.includes('back')) score -= 25;
    if (faults.includes('head')) score -= 20;
    if (faults.includes('hips')) score -= 15;
    if (faults.includes('lock')) score -= 10;
    if (faults.includes('over')) score -= 10;
    if (faults.includes('tempo')) score -= 10;
    score = Math.max(0, Math.round(score));
    const cue = CUES.find((k) => faults.includes(k)) || null;
    let speakCue = cue;
    if (cue && this.cueStreak.cue === cue) {
      this.cueStreak.count += 1;
      if (this.cueStreak.count > 2) speakCue = null;
    } else {
      this.cueStreak = { cue, count: cue ? 1 : 0 };
    }
    // 세지 않는 반복: 무릎을 많이 굽혀 스쿼트가 됨, 깊이가 크게 모자람
    let noRep = null;
    if (c.maxCurve != null ? c.maxCurve > t.noRepCurve : torsoPct != null && torsoPct < t.torsoFallback) noRep = 'back';
    else if (c.minHead != null && c.minHead < t.headNoRep) noRep = 'head';
    else if (c.minKnee < t.noRepKnee) noRep = 'knee';
    else if (c.maxLean < t.depthLean - t.noRepDepthOver) noRep = 'depth';
    else if (c.maxHipBack < t.noRepHipBack) noRep = 'hips';
    else if (t.noRepLock && c.minKnee > t.lockKnee) noRep = 'lock';
    else if (descent < t.noRepFastMs) noRep = 'tempo';
    this.attempts += 1;
    if (!noRep) this.reps += 1;
    const rec = {
      n: this.attempts, count: this.reps, counted: !noRep, noRep, score, faults, cue, depthOk,
      lean: Math.round(c.maxLean), minHip: Math.round(c.minHip), minKnee: Math.round(c.minKnee),
      hipBack: Math.round(c.maxHipBack * 100), head: c.minHead == null ? null : Math.round(c.minHead),
      descentMs: Math.round(c.bottomAt - c.startAt),
      torso: torsoPct == null ? null : Math.round(torsoPct), // 몸통 길이(서 있을 때 대비 %)
      curve: c.maxCurve == null ? null : Math.round(c.maxCurve * 10) / 10, // 등 윤곽 휨 %
    };
    this.repLog.push(rec);
    return { event: noRep ? 'norep' : 'rep', rep: rec, speakCue };
  }
}

// v23: 사람 윤곽(세그멘테이션 마스크)으로 등이 둥글게 휘었는지 잼. 랜드마크에는 척추 점이 없어서
// 어깨-엉덩이 직선에서 등 쪽(무릎 반대쪽)으로 몸 윤곽까지의 거리를 여러 지점에서 재고,
// 가운데가 양 끝을 이은 선보다 얼마나 불룩 나왔는지(몸통 길이 대비 %)를 돌려줌. 곧은 등은 0 근처
// mask: Float32Array(W*H, 0~1 사람일 확률), S·Hp·K: 어깨·엉덩이·무릎 픽셀 좌표
export function backCurve(mask, W, H, S, Hp, K) {
  const dx = Hp.x - S.x, dy = Hp.y - S.y, len = Math.hypot(dx, dy);
  if (len < 20) return null;
  let nx = -dy / len, ny = dx / len;
  if (nx * (K.x - S.x) + ny * (K.y - S.y) > 0) { nx = -nx; ny = -ny; } // 무릎 반대쪽이 등
  const ts = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85], off = [];
  for (const t of ts) {
    const px = S.x + dx * t, py = S.y + dy * t;
    let k = 0;
    for (; k < len * 0.8; k += 1) {
      const ix = Math.round(px + nx * k), iy = Math.round(py + ny * k);
      if (ix < 0 || iy < 0 || ix >= W || iy >= H || mask[iy * W + ix] < 0.5) break;
    }
    off.push(k);
  }
  const a = off[0], b = off[off.length - 1];
  let bulge = -Infinity;
  for (let i = 1; i < off.length - 1; i++) bulge = Math.max(bulge, off[i] - (a + (b - a) * (ts[i] - ts[0]) / (ts[ts.length - 1] - ts[0])));
  return bulge / len * 100;
}
