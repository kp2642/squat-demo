// 스쿼트 판정 로직 v2 (브라우저·Node 공용, 외부 의존성 없음)
// 입력: MediaPipe Pose 랜드마크 33개 [{x, y, z, visibility}], 좌표는 0~1 정규화(y는 아래로 증가)
//
// v1에서 바뀐 점
// - 준비 자세(측면으로 서서 1초간 가만히)를 확인한 뒤에만 세기 시작 → 걸어 들어올 때 세던 문제 수정
// - 무릎 각도만이 아니라 "엉덩이가 실제로 내려간 거리"로 반복을 판단 → 흔들림·걷기 무시
// - 정면으로 서 있으면 판정하지 않고 옆으로 서라고 안내 (측면이 아니면 2D 각도가 부정확함)
// - 판정 항목 추가: 깊이, 상체 숙임(정강이 기울기 대비), 뒤꿈치 들림, 내려가는 속도
// - 반복마다 100점 만점 점수

const L = { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 };
const R = { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 };
const JOINTS = ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'];

// 공통 기준값 (근거: 일반적인 스쿼트 코칭 기준. 실제 사용자 데이터로 계속 조정)
export const THRESHOLDS = {
  minVisibility: 0.6,   // 이보다 낮은 관절이 있으면 "안 보임"
  edgeMargin: 0.02,     // 화면 가장자리에 걸린 관절은 신뢰하지 않음
  sideMaxSpread: 0.45,  // 양쪽 어깨·엉덩이 가로 간격 / 몸통 길이가 이보다 크면 정면으로 본 것
  readyMs: 1000,        // 준비 자세를 이만큼 유지해야 시작
  readyKnee: 160,       // 준비 자세 무릎 각도
  readyMotion: 0.03,    // 준비 중 엉덩이 높이 흔들림 허용치 (다리 길이 대비)
  startDrop: 0.08,      // 엉덩이가 다리 길이의 8% 이상 내려가면 반복 시작
  countDrop: 0.22,      // 다리 길이의 22% 이상 내려가야 1회로 인정 (그보다 얕으면 무효)
  topKnee: 160,         // 이 각도 이상으로 다시 일어서야 반복 완료
  returnDrop: 0.08,     // 엉덩이가 처음 높이 근처(8% 이내)로 돌아와야 반복 완료
  minRepMs: 500,        // 이보다 빠른 반복은 흔들림으로 보고 무시
  fastDescentMs: 600,   // 이보다 빨리 내려가면 "천천히" 지적
  heelLift: 0.035,      // 뒤꿈치가 처음보다 다리 길이의 3.5% 이상 올라가면 지적
  lostMs: 1200,         // 이만큼 안 보이면 준비 단계로 돌아감
  smoothing: 0.5,       // 지수 이동 평균 계수 (클수록 반응 빠름)
};

// 판정 강도 (사용자가 플랜 설정에서 선택). 횟수 인정 기준은 같고, 자세 평가만 달라짐
export const MODES = {
  // 편하게: 무릎 105° 이하면 충분한 깊이, 상체가 정강이보다 25° 넘게 더 숙여지면 지적
  relaxed: { depthKnee: 105, leanTol: 25 },
  // 정확하게: 허벅지 평행(무릎 90° 이하 또는 엉덩이가 무릎 높이), 15° 넘게 숙여지면 지적
  strict: { depthKnee: 90, leanTol: 15 },
};

const deg = (r) => (r * 180) / Math.PI;
function angle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (m === 0) return 180;
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / m))));
}
// 선분 a→b가 수직선과 이루는 각도 (0 = 수직)
function fromVertical(a, b) {
  return deg(Math.atan2(Math.abs(a.x - b.x), Math.max(1e-6, Math.abs(a.y - b.y))));
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 한 프레임 측정
export function measure(lm, aspect = 1) {
  if (!lm || lm.length < 33) return { visible: false, reason: 'none' };
  // 가로세로 비율 보정 (정규화 좌표는 가로·세로 단위가 다름)
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, v: lm[i].visibility ?? 0, rx: lm[i].x });
  const vis = (s) => JOINTS.reduce((t, k) => t + P(s[k]).v, 0) / JOINTS.length;
  const side = vis(L) >= vis(R) ? L : R;
  const j = Object.fromEntries(JOINTS.map((k) => [k, P(side[k])]));
  const t = THRESHOLDS;
  const minVis = Math.min(...['shoulder', 'hip', 'knee', 'ankle'].map((k) => j[k].v));
  const inFrame = JOINTS.every((k) => j[k].rx > t.edgeMargin && j[k].rx < 1 - t.edgeMargin && j[k].y > t.edgeMargin && j[k].y < 1 - t.edgeMargin);
  if (minVis < t.minVisibility || !inFrame) return { visible: false, reason: 'not_in_frame' };

  const torsoLen = dist(j.shoulder, j.hip);
  const legLen = dist(j.hip, j.knee) + dist(j.knee, j.ankle);
  if (torsoLen < 0.05 || legLen < 0.08) return { visible: false, reason: 'too_far' };
  const spread = (Math.abs(P(L.shoulder).x - P(R.shoulder).x) + Math.abs(P(L.hip).x - P(R.hip).x)) / 2 / torsoLen;
  return {
    visible: true,
    side: side === L ? 'left' : 'right',
    sideView: spread < t.sideMaxSpread,
    spread,
    knee: angle(j.hip, j.knee, j.ankle),
    torsoLean: fromVertical(j.shoulder, j.hip),
    shinLean: fromVertical(j.knee, j.ankle),
    hipY: j.hip.y,
    kneeY: j.knee.y,
    heelLift: (j.toe.y - j.heel.y) / legLen, // 뒤꿈치가 들리면 커짐
    legLen,
  };
}

const CUES = ['depth', 'heel', 'chest', 'tempo'];
export const CUE_TEXT = {
  depth: '조금 더 앉아주세요',
  chest: '가슴을 세워주세요',
  heel: '뒤꿈치를 바닥에 붙여주세요',
  tempo: '천천히 내려가세요',
  shallow: '더 깊이 앉아야 한 번으로 세요',
};

export class SquatCounter {
  constructor(mode = 'relaxed') { this.setMode(mode); this.reset(); }
  setMode(mode) { this.mode = MODES[mode] ? mode : 'relaxed'; this.t = { ...THRESHOLDS, ...MODES[this.mode] }; }
  reset() {
    this.state = 'setup';        // setup → ready(up) ↔ down
    this.reps = 0;
    this.repLog = [];
    this.base = null;            // 준비 자세 기준값
    this.readySince = null;
    this.readyHip = [];
    this.lostSince = null;
    this.s = null;               // 평활화된 측정값
    this.cur = null;
    this.lastRepAt = -1e9;
    this.cueStreak = { cue: null, count: 0 };
    this.shallowSpoken = 0;
  }
  _smooth(m) {
    const a = this.t.smoothing;
    if (!this.s) { this.s = { ...m }; return this.s; }
    for (const k of ['knee', 'torsoLean', 'shinLean', 'hipY', 'kneeY', 'heelLift', 'legLen']) this.s[k] = a * m[k] + (1 - a) * this.s[k];
    return this.s;
  }

  // 프레임마다 호출. 돌려주는 event:
  // not_visible / not_side / setup / ready / tracking / rep / shallow / lost
  update(m, now) {
    const t = this.t;
    if (!m || !m.visible || !m.sideView) {
      this.readySince = null; this.readyHip = [];
      if (this.state !== 'setup') {
        if (this.lostSince === null) this.lostSince = now;
        if (now - this.lostSince > t.lostMs) { this.state = 'setup'; this.cur = null; this.s = null; return { event: 'lost' }; }
      }
      return { event: m && m.visible ? 'not_side' : 'not_visible', reason: m && m.reason };
    }
    this.lostSince = null;
    const s = this._smooth(m);

    if (this.state === 'setup') {
      // 측면으로 똑바로 서서 가만히 있는지 확인
      if (s.knee < t.readyKnee) { this.readySince = null; this.readyHip = []; return { event: 'setup', hint: 'stand' }; }
      if (this.readySince === null) this.readySince = now;
      this.readyHip.push(s.hipY);
      const range = (Math.max(...this.readyHip) - Math.min(...this.readyHip)) / s.legLen;
      if (range > t.readyMotion) { this.readySince = now; this.readyHip = [s.hipY]; return { event: 'setup', hint: 'still' }; }
      if (now - this.readySince >= t.readyMs) {
        this.base = { hipY: this.readyHip.reduce((a, b) => a + b, 0) / this.readyHip.length, legLen: s.legLen, heel: s.heelLift };
        this.state = 'up';
        return { event: 'ready' };
      }
      return { event: 'setup', hint: 'hold', progress: (now - this.readySince) / t.readyMs };
    }

    const drop = (s.hipY - this.base.hipY) / this.base.legLen;
    if (this.state === 'up') {
      // 기준 높이에서 조금이라도 내려가기 시작한 시점 (내려가는 속도 계산용)
      if (drop > 0.02) { if (this.leaveAt == null) this.leaveAt = now; } else this.leaveAt = null;
      if (drop > t.startDrop && s.knee < t.topKnee) {
        this.state = 'down';
        this.cur = { startAt: this.leaveAt ?? now, bottomAt: now, maxDrop: drop, minKnee: s.knee, maxLeanGap: s.torsoLean - s.shinLean, maxHeel: s.heelLift - this.base.heel, hipBelowKnee: false };
      } else if (drop < t.startDrop / 2) {
        // 서 있는 동안 기준 높이를 천천히 갱신 (자세를 고쳐 서는 경우 대비)
        this.base.hipY = 0.95 * this.base.hipY + 0.05 * s.hipY;
      }
      return { event: 'tracking', drop };
    }

    // state === 'down'
    const c = this.cur;
    if (drop > c.maxDrop) { c.maxDrop = drop; c.bottomAt = now; }
    if (s.knee < c.minKnee) c.minKnee = s.knee;
    if (s.hipY >= s.kneeY - 0.01) c.hipBelowKnee = true;
    // 자세 평가는 충분히 내려간 구간에서만
    if (drop > t.countDrop * 0.7) {
      c.maxLeanGap = Math.max(c.maxLeanGap, s.torsoLean - s.shinLean);
      c.maxHeel = Math.max(c.maxHeel, s.heelLift - this.base.heel);
    }
    if (drop < t.returnDrop) {
      // 다시 일어섬
      this.state = 'up'; this.cur = null; this.leaveAt = null;
      if (now - this.lastRepAt < t.minRepMs || now - c.startAt < t.minRepMs) return { event: 'ignored' };
      if (c.maxDrop < t.countDrop) {
        // 얕은 움직임: 세지 않음
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
    const depthOk = c.minKnee <= t.depthKnee || c.hipBelowKnee;
    if (!depthOk) faults.push('depth');
    if (c.maxHeel > t.heelLift) faults.push('heel');
    if (c.maxLeanGap > t.leanTol) faults.push('chest');
    if (c.bottomAt - c.startAt < t.fastDescentMs) faults.push('tempo');
    // 점수: 100점에서 항목별 감점
    let score = 100;
    if (!depthOk) score -= Math.min(40, (c.minKnee - t.depthKnee) * 1.5 + 10);
    if (faults.includes('heel')) score -= 15;
    if (faults.includes('chest')) score -= Math.min(30, (c.maxLeanGap - t.leanTol) * 1.5 + 10);
    if (faults.includes('tempo')) score -= 10;
    score = Math.max(0, Math.round(score));
    // 교정은 한 번에 하나, 우선순위 순서대로
    const cue = CUES.find((k) => faults.includes(k)) || null;
    let speakCue = cue;
    if (cue && this.cueStreak.cue === cue) {
      this.cueStreak.count += 1;
      if (this.cueStreak.count > 2) speakCue = null; // 같은 지적은 연속 2번까지만
    } else {
      this.cueStreak = { cue, count: cue ? 1 : 0 };
    }
    this.reps += 1;
    const rec = {
      n: this.reps, score, faults, cue, depthOk,
      minKnee: Math.round(c.minKnee), drop: Math.round(c.maxDrop * 100), leanGap: Math.round(c.maxLeanGap),
      heel: Math.round(c.maxHeel * 1000) / 10, descentMs: Math.round(c.bottomAt - c.startAt),
    };
    this.repLog.push(rec);
    return { event: 'rep', rep: rec, speakCue };
  }
}
