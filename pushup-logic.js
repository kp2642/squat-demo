// 푸시업 판정 로직 v1 (브라우저·Node 공용, 외부 의존성 없음)
// 입력: MediaPipe Pose 랜드마크 33개 [{x, y, z, visibility}], 좌표는 0~1 정규화(y는 아래로 증가)
// 스쿼트 로직(squat-logic.js)과 같은 구조와 이벤트를 씀:
// not_visible / not_side / setup / ready / tracking / rep / norep / shallow / lost / ignored
//
// 측면 카메라로 보는 것
// - 팔꿈치 각도(어깨-팔꿈치-손목): 깊이
// - 몸통 일직선(어깨-엉덩이-발목, 무릎 푸시업은 무릎): 엉덩이 처짐 / 솟음
// - 내려가는 속도
// 볼 수 없는 것: 팔꿈치가 옆으로 벌어지는 정도(정면에서만 보임), 손 위치

const L = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
const R = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };
const JOINTS = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'];

// 공통 기준값 (근거: ACSM·NSCA 푸시업 코칭 기준 — 팔꿈치 약 90°까지, 머리부터 발끝까지 일직선)
export const THRESHOLDS = {
  minVisibility: 0.6,
  edgeMargin: 0.02,
  sideMaxSpread: 0.5,   // 양 어깨 거리 / 몸통 길이가 이보다 크면 정면(머리 쪽)에서 본 것
  plankTilt: 40,        // 어깨-발(무릎) 선이 수평에서 이 각도 이내여야 엎드린 자세로 봄
  readyMs: 1000,        // 팔을 편 엎드린 자세를 이만큼 유지해야 시작
  readyElbow: 150,
  readyMotion: 0.05,    // 준비 중 어깨 높이 흔들림 허용치 (팔 길이 대비)
  startDrop: 0.05,      // 어깨가 팔 길이의 5% 이상 내려가고 팔꿈치가 150° 아래로 굽으면 반복 시작
  startElbow: 150,
  shallowElbow: 130,    // 팔꿈치가 이 각도보다 덜 굽혀지면 반복으로 보지 않음
  topElbow: 145,        // 이 각도 이상 다시 펴야 반복 완료
  returnDrop: 0.08,
  minRepMs: 500,
  fastDescentMs: 600,   // 이보다 빨리 내려가면 "천천히" 지적
  noRepDepthOver: 20,   // 깊이 기준보다 20° 넘게 덜 내려가면 세지 않음
  noRepSagOver: 5,      // 엉덩이 처짐이 허용치보다 5° 넘으면 세지 않음 (허리 부담, 모드 무관)
                        // v12: 1차 실측에서 처짐 21°(허용 15°)를 센 반복이 '너그러움' → 10°에서 5°로
  collapseElbow: 40,    // v12: 팔꿈치가 이보다 접히면 가슴이 바닥에 닿아 버티지 못한 것으로 봄 (실측 22° 반복이 '너그러움')
  lostMs: 1200,
  smoothing: 0.5,
};

// 판정 강도. 편하게: 팔꿈치 100°, 처짐 15°/솟음 20° 허용. 정확하게: 90°, 10°/15°
export const MODES = {
  relaxed: { depthElbow: 100, sagTol: 15, pikeTol: 20, noRepLine: Infinity },
  strict: { depthElbow: 90, sagTol: 10, pikeTol: 15, noRepLine: 5 },
};

const deg = (r) => (r * 180) / Math.PI;
function angle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (m === 0) return 180;
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / m))));
}
function fromHorizontal(a, b) {
  return deg(Math.atan2(Math.abs(a.y - b.y), Math.max(1e-6, Math.abs(a.x - b.x))));
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 한 프레임 측정. knees=true면 무릎 대고 하는 푸시업(몸통 선을 무릎까지 봄)
export function measure(lm, aspect = 1, knees = false) {
  if (!lm || lm.length < 33) return { visible: false, reason: 'none' };
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, v: lm[i].visibility ?? 0, rx: lm[i].x });
  const need = knees ? ['shoulder', 'elbow', 'wrist', 'hip', 'knee'] : JOINTS;
  const vis = (s) => need.reduce((t, k) => t + P(s[k]).v, 0) / need.length;
  const side = vis(L) >= vis(R) ? L : R;
  const j = Object.fromEntries(JOINTS.map((k) => [k, P(side[k])]));
  const t = THRESHOLDS;
  const minVis = Math.min(...need.map((k) => j[k].v));
  const inFrame = need.every((k) => j[k].rx > t.edgeMargin && j[k].rx < 1 - t.edgeMargin && j[k].y > t.edgeMargin && j[k].y < 1 - t.edgeMargin);
  if (minVis < t.minVisibility || !inFrame) return { visible: false, reason: 'not_in_frame' };

  const anchor = knees ? j.knee : j.ankle;
  const torsoLen = dist(j.shoulder, j.hip);
  const armLen = dist(j.shoulder, j.elbow) + dist(j.elbow, j.wrist);
  if (torsoLen < 0.05 || armLen < 0.05) return { visible: false, reason: 'too_far' };
  const spread = dist(P(L.shoulder), P(R.shoulder)) / torsoLen;
  // 몸통 일직선에서 벗어난 각도: +는 엉덩이 처짐(선보다 아래), -는 엉덩이 솟음
  const bend = 180 - angle(j.shoulder, j.hip, anchor);
  const dx = anchor.x - j.shoulder.x;
  const lineY = Math.abs(dx) < 1e-6 ? j.hip.y : j.shoulder.y + ((j.hip.x - j.shoulder.x) / dx) * (anchor.y - j.shoulder.y);
  const hipDev = j.hip.y >= lineY ? bend : -bend;
  return {
    visible: true,
    side: side === L ? 'left' : 'right',
    sideView: spread < t.sideMaxSpread,
    spread,
    plank: fromHorizontal(j.shoulder, anchor) < t.plankTilt,
    elbow: angle(j.shoulder, j.elbow, j.wrist),
    hipDev,
    shoulderY: j.shoulder.y,
    armLen,
  };
}

const CUES = ['collapse', 'sag', 'depth', 'pike', 'tempo'];
export const CUE_TEXT = {
  collapse: '바닥에 닿기 전에 버텨주세요',
  sag: '엉덩이가 처지지 않게 배에 힘을 주세요',
  depth: '조금 더 내려가세요',
  pike: '엉덩이를 내려 몸을 일직선으로',
  tempo: '천천히 내려가세요',
  shallow: '더 내려가야 한 번으로 세요',
};
export const NOREP_TEXT = {
  collapse: '바닥까지 내려앉아서 이번은 세지 않아요',
  sag: '허리가 처져서 이번은 세지 않아요',
  depth: '더 내려가야 세요',
  pike: '몸이 일직선이 아니라서 이번은 세지 않아요',
};

export class PushupCounter {
  constructor(mode = 'relaxed') { this.setMode(mode); this.reset(); }
  setMode(mode) { this.mode = MODES[mode] ? mode : 'relaxed'; this.t = { ...THRESHOLDS, ...MODES[this.mode] }; }
  reset() {
    this.state = 'setup';
    this.reps = 0;
    this.attempts = 0;
    this.repLog = [];
    this.base = null;
    this.readySince = null;
    this.readyY = [];
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
    for (const k of ['elbow', 'hipDev', 'shoulderY', 'armLen']) this.s[k] = a * m[k] + (1 - a) * this.s[k];
    this.s.plank = m.plank;
    return this.s;
  }

  update(m, now) {
    const t = this.t;
    if (!m || !m.visible || !m.sideView) {
      this.readySince = null; this.readyY = [];
      if (this.state !== 'setup') {
        if (this.lostSince === null) this.lostSince = now;
        if (now - this.lostSince > t.lostMs) { this.state = 'setup'; this.cur = null; this.s = null; return { event: 'lost' }; }
      }
      return { event: m && m.visible ? 'not_side' : 'not_visible', reason: m && m.reason };
    }
    this.lostSince = null;
    const s = this._smooth(m);

    if (this.state === 'setup') {
      // 팔을 편 엎드린 자세(플랭크)로 가만히 있는지 확인
      if (!s.plank || s.elbow < t.readyElbow) { this.readySince = null; this.readyY = []; return { event: 'setup', hint: 'plank' }; }
      if (this.readySince === null) this.readySince = now;
      this.readyY.push(s.shoulderY);
      const range = (Math.max(...this.readyY) - Math.min(...this.readyY)) / s.armLen;
      if (range > t.readyMotion) { this.readySince = now; this.readyY = [s.shoulderY]; return { event: 'setup', hint: 'still' }; }
      if (now - this.readySince >= t.readyMs) {
        this.base = { shoulderY: this.readyY.reduce((a, b) => a + b, 0) / this.readyY.length, armLen: s.armLen };
        this.state = 'up';
        return { event: 'ready' };
      }
      return { event: 'setup', hint: 'hold', progress: (now - this.readySince) / t.readyMs };
    }

    if (!s.plank) {
      // 일어서거나 무릎을 꿇고 쉬는 중: 다시 준비 자세부터
      this.state = 'setup'; this.cur = null; this.readySince = null; this.readyY = [];
      return { event: 'setup', hint: 'plank' };
    }

    const drop = (s.shoulderY - this.base.shoulderY) / this.base.armLen;
    if (this.state === 'up') {
      if (drop > 0.03) { if (this.leaveAt == null) this.leaveAt = now; } else this.leaveAt = null;
      if (drop > t.startDrop && s.elbow < t.startElbow) {
        this.state = 'down';
        this.cur = { startAt: this.leaveAt ?? now, bottomAt: now, maxDrop: drop, minElbow: s.elbow, maxSag: Math.max(0, s.hipDev), maxPike: Math.max(0, -s.hipDev) };
      } else if (drop < t.startDrop / 2) {
        this.base.shoulderY = 0.95 * this.base.shoulderY + 0.05 * s.shoulderY;
      }
      return { event: 'tracking', drop };
    }

    // state === 'down'
    const c = this.cur;
    if (s.elbow < c.minElbow) { c.minElbow = s.elbow; c.bottomAt = now; }
    if (drop > c.maxDrop) c.maxDrop = drop;
    c.maxSag = Math.max(c.maxSag, s.hipDev);
    c.maxPike = Math.max(c.maxPike, -s.hipDev);
    if (s.elbow > t.topElbow && drop < t.returnDrop) {
      this.state = 'up'; this.cur = null; this.leaveAt = null;
      if (now - this.lastRepAt < t.minRepMs || now - c.startAt < t.minRepMs) return { event: 'ignored' };
      if (c.minElbow > t.shallowElbow) {
        const speak = this.shallowSpoken < 2; if (speak) this.shallowSpoken += 1;
        return { event: 'shallow', speak };
      }
      this.lastRepAt = now;
      return this._finishRep(c);
    }
    return { event: 'tracking', drop };
  }

  _finishRep(c) {
    const t = this.t;
    const faults = [];
    const depthOk = c.minElbow <= t.depthElbow;
    const sagOver = c.maxSag - t.sagTol, pikeOver = c.maxPike - t.pikeTol;
    if (c.minElbow < t.collapseElbow) faults.push('collapse');
    if (sagOver > 0) faults.push('sag');
    if (!depthOk) faults.push('depth');
    if (pikeOver > 0) faults.push('pike');
    if (c.bottomAt - c.startAt < t.fastDescentMs) faults.push('tempo');
    let score = 100;
    if (!depthOk) score -= Math.min(40, (c.minElbow - t.depthElbow) * 1.5 + 10);
    if (faults.includes('collapse')) score -= 35;
    if (sagOver > 0) score -= Math.min(35, sagOver * 1.5 + 15);
    if (pikeOver > 0) score -= Math.min(25, pikeOver * 1.5 + 10);
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
    // 세지 않는 반복: 허리 처짐이 심함(모드 무관), 깊이가 크게 모자람, (정확하게) 몸통 선이 많이 무너짐
    let noRep = null;
    if (faults.includes('collapse')) noRep = 'collapse';
    else if (sagOver > t.noRepSagOver) noRep = 'sag';
    else if (c.minElbow > t.depthElbow + t.noRepDepthOver) noRep = 'depth';
    else if (sagOver >= t.noRepLine) noRep = 'sag';
    else if (pikeOver >= t.noRepLine) noRep = 'pike';
    this.attempts += 1;
    if (!noRep) this.reps += 1;
    const rec = {
      n: this.attempts, count: this.reps, counted: !noRep, noRep, score, faults, cue, depthOk,
      minElbow: Math.round(c.minElbow), drop: Math.round(c.maxDrop * 100),
      sag: Math.round(c.maxSag), pike: Math.round(c.maxPike), descentMs: Math.round(c.bottomAt - c.startAt),
    };
    this.repLog.push(rec);
    return { event: noRep ? 'norep' : 'rep', rep: rec, speakCue };
  }
}
