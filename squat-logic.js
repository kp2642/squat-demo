// 스쿼트 판정 로직 (브라우저·Node 공용, 외부 의존성 없음)
// 입력: MediaPipe Pose 랜드마크 33개 [{x, y, z, visibility}], 좌표는 0~1 정규화(y는 아래로 증가)

const L = { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 };
const R = { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 };

// 기준값 (근거: 일반적인 스쿼트 코칭 기준. 프로토타입 검증 중 조정)
export const THRESHOLDS = {
  standKnee: 160,      // 무릎 각도가 이 이상이면 선 자세
  descendKnee: 140,    // 이 아래로 내려가면 반복 시작으로 봄
  depthKnee: 100,      // 이 이하이거나 엉덩이가 무릎 높이까지 오면 충분한 깊이
  torsoLeanMax: 50,    // 최저점에서 상체가 수직에서 이 각도 이상 숙여지면 지적
  minVisibility: 0.5,  // 이보다 낮으면 해당 관절이 안 보인다고 판단
  minRepMs: 600,       // 이보다 빠른 반복은 흔들림으로 보고 무시
};

// 판정 강도 (사용자가 플랜 설정에서 선택)
// 깊이와 상체 기울기만 조절하고, 횟수 인식 기준은 같게 둠
export const MODES = {
  strict: { depthKnee: 90, torsoLeanMax: 45 },   // 정확하게: 허벅지가 바닥과 평행 이상
  relaxed: { depthKnee: 115, torsoLeanMax: 55 }, // 편하게: 초보·유연성 부족한 사람 기준
};

function angle(a, b, c) {
  // b를 꼭짓점으로 하는 a-b-c 각도 (도)
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m === 0) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI;
}

function pickSide(lm) {
  // 측면 촬영이므로 카메라에 더 잘 보이는 쪽 다리를 사용
  const vis = (s) => ['shoulder', 'hip', 'knee', 'ankle'].reduce((t, k) => t + (lm[s[k]]?.visibility ?? 0), 0) / 4;
  const vl = vis(L), vr = vis(R);
  return vl >= vr ? { idx: L, vis: vl, name: 'left' } : { idx: R, vis: vr, name: 'right' };
}

export function measure(lm) {
  if (!lm || lm.length < 33) return null;
  const side = pickSide(lm);
  const p = (k) => lm[side.idx[k]];
  if (side.vis < THRESHOLDS.minVisibility) return { visible: false, side: side.name };
  const knee = angle(p('hip'), p('knee'), p('ankle'));
  const hipAng = angle(p('shoulder'), p('hip'), p('knee'));
  // 상체 기울기: 어깨-엉덩이 선이 수직과 이루는 각도
  const dx = p('shoulder').x - p('hip').x, dy = p('hip').y - p('shoulder').y;
  const torsoLean = (Math.atan2(Math.abs(dx), Math.max(1e-6, dy)) * 180) / Math.PI;
  const hipBelowKnee = p('hip').y >= p('knee').y - 0.01;
  return { visible: true, side: side.name, knee, hip: hipAng, torsoLean, hipBelowKnee };
}

// 반복 판정 상태 기계
export class SquatCounter {
  constructor(opts = {}) {
    this.t = { ...THRESHOLDS, ...opts };
    this.reset();
  }
  setMode(mode) {
    this.t = { ...THRESHOLDS, ...(MODES[mode] || {}) };
  }
  reset() {
    this.phase = 'up';
    this.reps = 0;
    this.repLog = [];        // [{n, minKnee, maxLean, depthOk, cue}]
    this.cur = null;
    this.lastRepAt = -1e9;
    this.cueStreak = { cue: null, count: 0 };
  }
  // 프레임마다 호출. 반복이 끝난 프레임에서는 {rep, cue}를 돌려줌
  update(m, now) {
    if (!m || !m.visible) return { event: 'not_visible' };
    const t = this.t;
    if (this.phase === 'up') {
      if (m.knee < t.descendKnee) {
        this.phase = 'down';
        this.cur = { minKnee: m.knee, maxLean: m.torsoLean, reachedDepth: false };
      }
    }
    if (this.phase === 'down') {
      this.cur.minKnee = Math.min(this.cur.minKnee, m.knee);
      if (m.knee <= t.depthKnee || m.hipBelowKnee) {
        this.cur.reachedDepth = true;
        this.cur.maxLean = Math.max(this.cur.maxLean, m.torsoLean);
      } else if (m.knee < t.descendKnee) {
        this.cur.maxLean = Math.max(this.cur.maxLean, m.torsoLean);
      }
      if (m.knee >= t.standKnee) {
        this.phase = 'up';
        if (now - this.lastRepAt < t.minRepMs) { this.cur = null; return { event: 'ignored' }; }
        this.lastRepAt = now;
        return this._finishRep();
      }
    }
    return { event: 'tracking', phase: this.phase };
  }
  _finishRep() {
    const c = this.cur; this.cur = null;
    let cue = null;
    if (!c.reachedDepth) cue = 'depth';
    else if (c.maxLean > this.t.torsoLeanMax) cue = 'chest';
    // 얕은 반복도 횟수로 세되 교정 한마디를 줌 (초보자 동기 유지)
    this.reps += 1;
    // 같은 지적은 연속 2회까지만 말함 (기획: 같은 지적 3회 이상 반복하지 않음)
    let speakCue = cue;
    if (cue && this.cueStreak.cue === cue) {
      this.cueStreak.count += 1;
      if (this.cueStreak.count > 2) speakCue = null;
    } else {
      this.cueStreak = { cue, count: cue ? 1 : 0 };
    }
    const rec = { n: this.reps, minKnee: Math.round(c.minKnee), maxLean: Math.round(c.maxLean), depthOk: c.reachedDepth, cue };
    this.repLog.push(rec);
    return { event: 'rep', rep: rec, speakCue };
  }
}

export const CUE_TEXT = {
  depth: '조금 더 앉아주세요',
  chest: '가슴을 세워주세요',
};
