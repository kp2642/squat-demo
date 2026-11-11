// 공통 판정 엔진 v1 (데모 v39) — 스쿼트·푸시업·굿모닝 말고 나머지 본운동 전부 (브라우저·Node 공용, 외부 의존성 없음)
// 입력: MediaPipe Pose 랜드마크 33개 [{x, y, z, visibility}], 0~1 정규화(y는 아래로 증가). 화면 회전 보정은 index.html에서 먼저 함.
// 종목마다 '신호' 하나(관절각·높이 등)를 정하고, 준비 자세 → 신호가 기준을 넘었다 돌아오면 1회로 셈.
// 종류 3가지
//   rep  : 횟수 종목. 깊이·자세 체크 → 셈 / 안 셈(이유) / 지적
//   hold : 버티기 종목(플랭크·벽 앉기 등). 자세가 바를 때만 시간이 흐르고, 무너지면 멈추고 이유를 말함
//   cardio: 시간 종목(팔 벌려 뛰기 등). 움직이는 동안만 시간이 흐르고, 동작 횟수도 셈
// 기준값은 운동과학 일반 기준(NSCA·ACSM 코칭 큐)에서 출발한 '기본판'. 실측으로 계속 조정 (스쿼트·굿모닝과 같은 방식)

const IX = { ear: [7, 8], shoulder: [11, 12], elbow: [13, 14], wrist: [15, 16], hip: [23, 24], knee: [25, 26], ankle: [27, 28], heel: [29, 30], toe: [31, 32] };
const deg = (r) => (r * 180) / Math.PI;
export function angle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (m === 0) return 180;
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / m))));
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
// 선 a→b 에서 점 p가 떨어진 거리(부호: 진행 방향 기준 왼쪽 +)
const offLine = (a, b, p) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return ((p.x - a.x) * dy - (p.y - a.y) * dx) / l; };
// 수직에서 기운 각 (0 = 섬, 90 = 누움)
const tilt = (top, bot) => deg(Math.atan2(Math.abs(top.x - bot.x), Math.abs(bot.y - top.y)));
const OTHER = { L: 'R', R: 'L' };

// 화면 회전 보정용 '아래쪽' 방향: [위 관절들] → [아래 관절들] (index.html의 upright)
const DOWN = {
  stand: [11, 12, 27, 28], // 어깨 → 발목
  torso: [11, 12, 23, 24], // 어깨 → 엉덩이 (딥스처럼 다리가 앞으로 뻗은 자세)
  shin: [25, 26, 27, 28],  // 무릎 → 발목 (누워서 무릎 세운 자세)
  arms: [11, 12, 15, 16],  // 어깨 → 손목 (팔 짚은 자세)
  fore: [11, 12, 13, 14],  // 어깨 → 팔꿈치 (팔꿈치 짚은 자세)
  pike: [23, 24, 15, 16],  // 엉덩이 → 손목 (엉덩이를 높이 든 자세)
  face: [7, 8, 0, 0],      // 귀 → 코 (엎드려 바닥을 봄)
  up: [15, 16, 11, 12],    // 손목 → 어깨 (누워서 팔을 천장으로)
};

// 공통 문구
const C = {
  depth: '조금 더 깊이 내려가세요',
  tempo: '천천히 하세요',
  torso: '상체를 세우세요',
  hold: '끝 자세에서 잠깐 멈췄다 돌아오세요',
  move: '멈추지 말고 계속 움직여요',
  pose: '자세를 다시 잡아 주세요',
};
const NR = { depth: '깊이가 모자라서 이번은 세지 않아요', tempo: '너무 빨라서 이번은 세지 않아요' };

// ── 종목 정의 ──
// view: side(옆모습) | front(정면) | any.  down: 화면 회전 기준.  axis: 몸 길이 방향(y 서기, x 눕기)
// sig(m, S): 신호.  dir: -1이면 작아질수록 깊음(관절각), +1이면 커질수록 깊음
// ready: 준비 자세 기준(신호).  start/ret: 반복 시작·완료 기준.  depth: 모드별 인정 기준.  gap: 이만큼 모자라면 안 셈
// base: 준비 자세 값을 0으로 (abs면 어느 쪽으로 움직여도)
// checks: [{k, at:'down'|'peak', bad(m,t), noRep?:true|'strict', pen}]  cues/noreps: 문구
export const SPECS = {
  // ─ 다리 ─
  jumpsquat: {
    kind: 'rep', view: 'side', down: 'stand', axis: 'y', chain: 'leg', arcAt: 2,
    sig: (m) => Math.min(m.knee.L, m.knee.R), dir: -1, ready: 150, start: 145, ret: 152, gap: 15, minMs: 150,
    depth: { relaxed: 130, strict: 115 },
    // 뛰었는지: 발목이 서 있을 때보다 다리 길이의 4% 넘게 올라감
    checks: [{ k: 'jump', at: 'end', bad: (c) => !(c.maxJump > 0.04), pen: 15 }],
    track: (m, c) => { c.maxJump = Math.max(c.maxJump ?? 0, (c.baseAnkle - Math.max(m.J.L.ankle.y, m.J.R.ankle.y)) / m.leg); },
    cues: { depth: '반쯤 앉았다가 뛰어오르세요', jump: '더 힘차게 뛰어오르세요' },
    note: { relaxed: '무릎이 130° 정도까지 굽었다 뛰어오르면 인정해요.', strict: '무릎이 115°까지 굽어야 인정해요.' },
    place: '휴대폰을 허리 높이에 세로로 세우고, 옆모습이 보이게 서요. 위로 뛸 공간이 필요해요.',
    setupMsg: '옆으로 서서 잠깐 멈춰 주세요',
  },
  splitsquat: {
    kind: 'rep', view: 'side', down: 'stand', axis: 'y', chain: 'leg', arcAt: 2, chainSide: 'bentKnee',
    sig: (m) => Math.min(m.knee.L, m.knee.R), dir: -1, ready: 145, start: 135, ret: 145, gap: 15, minMs: 800,
    depth: { relaxed: 110, strict: 100 }, fastMs: 700,
    checks: [{ k: 'torso', at: 'peak', bad: (m) => m.lean > 25, noRep: (m) => m.lean > 40, pen: 15 }],
    cues: { depth: '뒷무릎이 바닥에 가까워지게 더 내려가세요', torso: '상체를 세운 채 곧게 내려가세요', tempo: '천천히 내려가세요' },
    noreps: { torso: '상체가 많이 숙여져서 이번은 세지 않아요' },
    note: { relaxed: '앞무릎이 110° 정도까지 굽으면 인정해요.', strict: '앞무릎이 거의 90°(100° 이하)까지 굽어야 인정해요.' },
    place: '휴대폰을 허리 높이에 세로로 세우고, 옆모습이 보이게 다리를 앞뒤로 벌리고 서요.',
    setupMsg: '다리를 앞뒤로 벌리고 선 채 잠깐 멈춰 주세요',
  },
  lunge: {
    kind: 'rep', view: 'side', down: 'stand', axis: 'y', chain: 'leg', arcAt: 2, chainSide: 'bentKnee',
    sig: (m) => Math.min(m.knee.L, m.knee.R), dir: -1, ready: 155, start: 140, ret: 150, gap: 15, minMs: 900,
    depth: { relaxed: 110, strict: 100 }, fastMs: 700,
    checks: [{ k: 'torso', at: 'peak', bad: (m) => m.lean > 25, noRep: (m) => m.lean > 40, pen: 15 }],
    cues: { depth: '양 무릎이 90도가 되게 더 내려가세요', torso: '상체를 세운 채 내려가세요', tempo: '천천히 내려가세요' },
    noreps: { torso: '상체가 많이 숙여져서 이번은 세지 않아요' },
    note: { relaxed: '무릎이 110° 정도까지 굽으면 인정해요.', strict: '무릎이 거의 90°(100° 이하)까지 굽어야 인정해요.' },
    place: '휴대폰을 허리 높이에 세로로 세우고, 옆모습이 보이게 서요. 뒤로 한 걸음 디딜 공간이 필요해요.',
    setupMsg: '옆으로 바르게 서서 잠깐 멈춰 주세요',
  },
  bulgarian: {
    kind: 'rep', view: 'side', down: 'stand', axis: 'y', chain: 'leg', arcAt: 2, chainSide: 'front',
    sig: (m) => m.knee[m.front], dir: -1, ready: 145, start: 135, ret: 145, gap: 15, minMs: 900,
    depth: { relaxed: 110, strict: 95 }, fastMs: 700,
    checks: [{ k: 'torso', at: 'peak', bad: (m) => m.lean > 35, noRep: (m) => m.lean > 50, pen: 15 }],
    cues: { depth: '앞다리로 조금 더 앉으세요', torso: '상체를 너무 숙이지 마세요', tempo: '천천히 내려가세요' },
    noreps: { torso: '상체가 많이 숙여져서 이번은 세지 않아요' },
    note: { relaxed: '앞무릎이 110° 정도까지 굽으면 인정해요.', strict: '앞무릎이 95°까지 굽어야 인정해요.' },
    place: '의자를 등지고 서서 옆모습이 보이게 해요. 휴대폰은 허리 높이에 세로로.',
    setupMsg: '뒷발을 의자에 올리고 선 채 잠깐 멈춰 주세요',
  },
  sidelunge: {
    kind: 'rep', view: 'front', down: 'stand', axis: 'y', chain: 'leg', arcAt: 2, chainSide: 'bentKnee',
    // 정면에서는 무릎 각이 잘 안 보여서, 골반이 내려간 비율로 셈: 발목~골반 높이가 서 있을 때보다 줄어든 정도(-log, 0.2 ≈ 18%)
    sig: (m) => -Math.log(Math.max(0.01, (m.J.L.ankle.y + m.J.R.ankle.y - m.J.L.hip.y - m.J.R.hip.y) / 2)), base: true, dir: 1, ready: 0.05, start: 0.08, ret: 0.05, gap: 0.07, minMs: 900, still: 0.05,
    depth: { relaxed: 0.2, strict: 0.3 }, fastMs: 700,
    checks: [{ k: 'straight', at: 'peak', bad: (m) => Math.max(m.knee.L, m.knee.R) < 150, pen: 10 }],
    cues: { depth: '엉덩이를 뒤로 빼며 더 앉으세요', straight: '반대쪽 다리는 쭉 펴세요', tempo: '천천히 내려가세요' },
    note: { relaxed: '골반이 충분히 내려가면 인정해요.', strict: '굽힌 쪽 허벅지가 바닥과 평행에 가까울 만큼 앉아야 인정해요.' },
    place: '휴대폰을 허리 높이에 세로로 세우고, 정면을 보고 서요. 양옆으로 공간이 필요해요.',
    setupMsg: '정면을 보고 발을 넓게 벌린 채 잠깐 멈춰 주세요',
  },
  calfraise: {
    kind: 'rep', view: 'side', down: 'stand', axis: 'y', chain: 'leg', arcAt: 3,
    // 발끝 대비 발목·뒤꿈치 높이(다리 길이 대비) — 준비 자세 값을 0으로
    sig: (m) => { const n = m.J[m.near]; return ((n.toe.y - n.ankle.y) + (n.toe.y - n.heel.y)) / 2 / m.leg; }, base: true,
    dir: 1, ready: 0.02, start: 0.02, ret: 0.012, gap: 0.012, minMs: 700, still: 0.02,
    depth: { relaxed: 0.035, strict: 0.05 }, slowBackMs: 600,
    cues: { depth: '뒤꿈치를 더 높이 드세요', back: '천천히 내려오세요' },
    note: { relaxed: '뒤꿈치를 들어 올리면 인정해요.', strict: '뒤꿈치를 최대한 높이 들어야 인정해요.' },
    place: '휴대폰을 무릎 높이에 세로로 세우고, 옆모습이 보이게 서요. 발이 화면에 다 보여야 해요.',
    setupMsg: '옆으로 서서 잠깐 멈춰 주세요',
  },
  wallsit: {
    kind: 'hold', view: 'side', down: 'stand', axis: 'y', chain: 'leg', arcAt: 2,
    sig: (m) => Math.min(m.knee.L, m.knee.R),
    pose: (m) => Math.min(m.knee.L, m.knee.R) < 140,
    fault: (m, t) => { const k = Math.min(m.knee.L, m.knee.R); return k > t.high ? 'high' : k < 65 ? 'low' : m.lean > 25 ? 'back' : null; },
    hold: { relaxed: { high: 120 }, strict: { high: 105 } },
    cues: { high: '조금 더 내려가세요', low: '너무 낮아요. 조금 올라오세요', back: '등을 벽에 붙이세요' },
    note: { relaxed: '무릎이 120°보다 굽은 동안 시간이 흘러요.', strict: '허벅지가 거의 평행(무릎 105° 이하)일 때만 시간이 흘러요.' },
    place: '벽에 등을 대고, 휴대폰은 허리 높이에 세로로 세워 옆모습이 보이게 해요.',
    setupMsg: '벽에 등을 대고 내려가 앉으세요',
  },
  slrdl: {
    kind: 'rep', view: 'side', down: 'stand', axis: 'y', chain: 'hinge', arcAt: 2,
    sig: (m) => m.lean, dir: 1, ready: 20, start: 22, ret: 15, gap: 12, minMs: 1000,
    depth: { relaxed: 45, strict: 65 }, fastMs: 900,
    checks: [{ k: 'knee', at: 'peak', bad: (m) => Math.max(m.knee.L, m.knee.R) < 130, pen: 10 }],
    cues: { depth: '등을 편 채로 조금 더 숙이세요', knee: '디딘 다리 무릎은 살짝만 굽히세요', tempo: '천천히 숙이세요' },
    note: { relaxed: '상체를 45° 정도 숙이면 인정해요.', strict: '상체가 바닥과 거의 평행(65°)할 만큼 숙여야 인정해요.' },
    place: '휴대폰을 허리 높이에 세로로 세우고, 옆모습이 보이게 서요. 필요하면 벽을 가볍게 짚어요.',
    setupMsg: '한 발로 바르게 서서 잠깐 멈춰 주세요',
  },
  // ─ 바닥 ─
  bridge: {
    kind: 'rep', view: 'side', down: 'shin', axis: 'x', chain: 'bridge', arcAt: 1,
    sig: (m) => m.hipX[m.near], dir: 1, ready: 152, start: 155, ret: 150, gap: 10, minMs: 900,
    depth: { relaxed: 160, strict: 168 }, holdMs: { strict: 400 },
    checks: [{ k: 'arch', at: 'peak', bad: (m) => m.hipX[m.near] > 195, pen: 10 }],
    cues: { arch: '허리를 과하게 꺾지 말고 일직선까지만 드세요', depth: '어깨부터 무릎까지 일직선이 되게 더 들어요', hold: '위에서 잠깐 멈췄다 내려오세요' },
    note: { relaxed: '엉덩이를 160° 정도까지 들면 인정해요.', strict: '어깨-엉덩이-무릎이 거의 일직선이 되고 잠깐 멈춰야 인정해요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 누워요.',
    setupMsg: '무릎을 세우고 누운 채 잠깐 멈춰 주세요',
  },
  slbridge: {
    kind: 'rep', view: 'side', down: 'shin', axis: 'x', chain: 'bridge', arcAt: 1, chainSide: 'bentKnee',
    sig: (m) => m.hipX[m.bent], dir: 1, ready: 152, start: 155, ret: 150, gap: 10, minMs: 900,
    depth: { relaxed: 155, strict: 165 },
    checks: [{ k: 'arch', at: 'peak', bad: (m) => m.hipX[m.bent] > 195, pen: 10 }],
    cues: { arch: '허리를 과하게 꺾지 말고 일직선까지만 드세요', depth: '바닥 디딘 다리로 엉덩이를 더 들어요' },
    note: { relaxed: '엉덩이를 155° 정도까지 들면 인정해요.', strict: '어깨-엉덩이-무릎이 거의 일직선(165°)이 돼야 인정해요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 누워요.',
    setupMsg: '한쪽 다리를 펴고 누운 채 잠깐 멈춰 주세요',
  },
  chairdip: {
    kind: 'rep', view: 'side', down: 'torso', axis: 'y', chain: 'arm', arcAt: 2,
    sig: (m) => m.elbow[m.near], dir: -1, ready: 150, start: 140, ret: 150, gap: 15, minMs: 800,
    depth: { relaxed: 110, strict: 95 }, fastMs: 600,
    checks: [{ k: 'deep', at: 'peak', bad: (m) => m.elbow[m.near] < 70, pen: 10 }],
    cues: { depth: '팔꿈치를 90도 가까이 굽히세요', deep: '너무 깊어요. 팔꿈치 90도까지만 내려가세요', tempo: '천천히 내려가세요' },
    note: { relaxed: '팔꿈치가 110° 정도까지 굽으면 인정해요.', strict: '팔꿈치가 95°까지 굽어야 인정해요.' },
    place: '의자 앞에 앉아 옆모습이 보이게 해요. 휴대폰은 바닥이나 낮은 곳에 세로로.',
    setupMsg: '의자를 짚고 팔을 편 채 잠깐 멈춰 주세요',
  },
  pikepush: {
    kind: 'rep', view: 'side', down: 'pike', axis: 'x', chain: 'arm', arcAt: 2,
    sig: (m) => m.elbow[m.near], dir: -1, ready: 150, start: 140, ret: 150, gap: 15, minMs: 800,
    depth: { relaxed: 115, strict: 100 }, fastMs: 600,
    checks: [{ k: 'pike', at: 'peak', bad: (m) => angle(m.J[m.near].shoulder, m.J[m.near].hip, m.J[m.near].ankle) > 120, pen: 10 }],
    cues: { depth: '머리가 바닥에 가까워지게 더 굽히세요', pike: '엉덩이를 더 높이 들어요', tempo: '천천히 내려가세요' },
    note: { relaxed: '팔꿈치가 115° 정도까지 굽으면 인정해요.', strict: '팔꿈치가 100°까지 굽어야 인정해요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 자리를 잡아요.',
    setupMsg: '엉덩이를 높이 들고 팔을 편 채 잠깐 멈춰 주세요',
  },
  yraise: {
    kind: 'rep', view: 'side', down: 'face', axis: 'x', chain: 'arm', arcAt: 0,
    sig: (m) => m.armLift, base: 'abs', dir: 1, ready: 0.05, start: 0.06, ret: 0.04, gap: 0.04, minMs: 800, still: 0.05,
    depth: { relaxed: 0.12, strict: 0.18 }, holdMs: { strict: 400 },
    cues: { depth: '팔을 조금 더 높이 드세요', hold: '위에서 잠깐 멈췄다 내려요' },
    note: { relaxed: '팔을 바닥에서 들어 올리면 인정해요.', strict: '팔을 충분히 들고 잠깐 멈춰야 인정해요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 엎드려요.',
    setupMsg: '엎드려 팔을 머리 위로 뻗고 잠깐 멈춰 주세요',
  },
  wraise: {
    kind: 'rep', view: 'side', down: 'face', axis: 'x', chain: 'arm', arcAt: 0,
    sig: (m) => m.armLift, base: 'abs', dir: 1, ready: 0.05, start: 0.06, ret: 0.04, gap: 0.04, minMs: 800, still: 0.05,
    depth: { relaxed: 0.1, strict: 0.15 }, holdMs: { strict: 400 },
    cues: { depth: '팔꿈치를 조금 더 높이 드세요', hold: '위에서 잠깐 멈췄다 내려요' },
    note: { relaxed: '팔을 바닥에서 들어 올리면 인정해요.', strict: '팔을 충분히 들고 잠깐 멈춰야 인정해요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 엎드려요.',
    setupMsg: '엎드려 팔을 W자로 두고 잠깐 멈춰 주세요',
  },
  superman: {
    kind: 'rep', view: 'side', down: 'face', axis: 'x', chain: 'body', arcAt: 1,
    sig: (m) => (m.armLift + m.legLift) / 2, base: 'abs', dir: 1, ready: 0.05, start: 0.05, ret: 0.035, gap: 0.03, minMs: 800, still: 0.05,
    depth: { relaxed: 0.08, strict: 0.12 },
    checks: [{ k: 'legs', at: 'peak', bad: (m, t, c) => c.legLift != null && c.legLift < 0.03, pen: 10 }],
    track: (m, c, base) => { c.legLift = Math.max(c.legLift ?? 0, Math.abs(m.legLift - (base.legLift ?? m.legLift))); },
    cues: { depth: '팔과 다리를 조금 더 높이 드세요', legs: '다리도 같이 들어요' },
    note: { relaxed: '팔과 다리를 바닥에서 들면 인정해요.', strict: '팔과 다리를 충분히 들어야 인정해요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 엎드려요.',
    setupMsg: '엎드려 팔을 앞으로 뻗고 잠깐 멈춰 주세요',
  },
  kneeplank: {
    kind: 'hold', view: 'side', down: 'fore', axis: 'x', chain: 'kneeline', arcAt: 2,
    sig: (m) => m.sagK,
    pose: (m) => m.flat < 35,
    fault: (m, t) => m.sagK > t.sag ? 'sag' : -m.sagK > t.pike ? 'pike' : null,
    hold: { relaxed: { sag: 15, pike: 25 }, strict: { sag: 10, pike: 18 } },
    cues: { sag: '엉덩이를 조금 올려 일직선으로', pike: '엉덩이를 조금 내려 일직선으로' },
    note: { relaxed: '어깨-엉덩이-무릎이 대체로 일직선인 동안 시간이 흘러요.', strict: '일직선에서 10° 넘게 벗어나면 시간이 멈춰요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 엎드려요.',
    setupMsg: '팔꿈치와 무릎을 대고 엎드려 주세요',
  },
  plank: {
    kind: 'hold', view: 'side', down: 'fore', axis: 'x', chain: 'line', arcAt: 2,
    sig: (m) => m.sag,
    pose: (m) => m.flat < 35,
    fault: (m, t) => m.sag > t.sag ? 'sag' : -m.sag > t.pike ? 'pike' : null,
    hold: { relaxed: { sag: 12, pike: 22 }, strict: { sag: 8, pike: 15 } },
    cues: { sag: '엉덩이가 처졌어요. 배에 힘주고 올리세요', pike: '엉덩이를 조금 내려 일직선으로' },
    note: { relaxed: '머리부터 발까지 대체로 일직선인 동안 시간이 흘러요.', strict: '일직선에서 8° 넘게 처지면 시간이 멈춰요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 엎드려요.',
    setupMsg: '팔꿈치를 대고 엎드려 몸을 일직선으로',
  },
  sideplankknee: {
    kind: 'hold', view: 'any', down: 'support', axis: 'x', chain: 'kneeline', arcAt: 2,
    sig: (m) => m.sagK,
    pose: (m) => m.flat < 40,
    fault: (m, t) => m.sagK > t.sag ? 'sag' : null,
    hold: { relaxed: { sag: 15 }, strict: { sag: 10 } },
    cues: { sag: '엉덩이를 들어 어깨부터 무릎까지 일직선으로' },
    note: { relaxed: '엉덩이를 든 동안 시간이 흘러요.', strict: '일직선에서 10° 넘게 처지면 시간이 멈춰요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 몸 앞쪽이 보이게 옆으로 누워요.',
    setupMsg: '옆으로 누워 팔꿈치를 짚고 엉덩이를 들어요',
  },
  sideplank: {
    kind: 'hold', view: 'any', down: 'support', axis: 'x', chain: 'line', arcAt: 2,
    sig: (m) => m.sag,
    pose: (m) => m.flat < 40,
    fault: (m, t) => m.sag > t.sag ? 'sag' : null,
    hold: { relaxed: { sag: 12 }, strict: { sag: 8 } },
    cues: { sag: '엉덩이가 처졌어요. 머리부터 발까지 일직선으로' },
    note: { relaxed: '엉덩이를 든 동안 시간이 흘러요.', strict: '일직선에서 8° 넘게 처지면 시간이 멈춰요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 몸 앞쪽이 보이게 옆으로 누워요.',
    setupMsg: '옆으로 누워 팔꿈치를 짚고 엉덩이를 들어요',
  },
  birddog: {
    kind: 'rep', view: 'side', down: 'arms', axis: 'x', chain: 'bird', arcAt: 1, lockRot: true,
    // 반대쪽 팔·다리를 함께 뻗은 정도: 어깨 굽힘(엉덩이-어깨-손목)과 엉덩이 폄(어깨-엉덩이-무릎) 중 작은 쪽
    sig: (m) => Math.max(Math.min(m.arm.L, m.hipA.R), Math.min(m.arm.R, m.hipA.L)), dir: 1, ready: 120, start: 128, ret: 120, gap: 12, minMs: 1200,
    depth: { relaxed: 145, strict: 155 }, holdMs: { relaxed: 700, strict: 1200 },
    cues: { depth: '팔과 다리를 바닥과 평행하게 더 뻗어요', hold: '뻗은 채 2초 버티고 돌아와요' },
    note: { relaxed: '반대쪽 팔·다리를 뻗고 잠깐 버티면 인정해요.', strict: '바닥과 거의 평행하게 뻗고 1초 넘게 버텨야 인정해요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 네발 자세를 해요.',
    setupMsg: '네발 자세로 잠깐 멈춰 주세요',
  },
  deadbug: {
    kind: 'rep', view: 'side', down: 'up', axis: 'x', chain: 'bird', arcAt: 1, lockRot: true,
    // 팔은 머리 위로(어깨 굽힘 커짐), 다리는 펴짐(무릎각 커짐)
    sig: (m) => Math.max(Math.min(m.arm.L, m.knee.R), Math.min(m.arm.R, m.knee.L)), dir: 1, ready: 125, start: 130, ret: 122, gap: 12, minMs: 1200,
    depth: { relaxed: 145, strict: 155 }, fastMs: 800,
    cues: { depth: '팔과 다리를 더 길게 뻗어요', tempo: '천천히 뻗으세요' },
    note: { relaxed: '반대쪽 팔·다리를 뻗으면 인정해요.', strict: '팔·다리를 거의 끝까지 뻗어야 인정해요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 누워요.',
    setupMsg: '누워서 팔은 천장으로, 무릎은 90도로 들고 잠깐 멈춰 주세요',
  },
  curlup: {
    kind: 'rep', view: 'side', down: 'shin', axis: 'x', chain: 'body', arcAt: 1,
    sig: (m) => 180 - angle(m.J[m.near].shoulder, m.J[m.near].hip, m.J[m.near].ankle), base: true, dir: 1, ready: 6, start: 4, ret: 3, gap: 3, minMs: 700, still: 6,
    depth: { relaxed: 7, strict: 11 },
    checks: [{ k: 'high', at: 'peak', bad: (m, t, c) => c.peak > 45, pen: 10 }],
    cues: { depth: '어깨를 조금 더 들어요', high: '어깨만 살짝 드세요. 허리는 바닥에' },
    note: { relaxed: '머리와 어깨가 바닥에서 뜨면 인정해요.', strict: '어깨뼈가 바닥에서 떨어질 만큼 들어야 인정해요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 누워요.',
    setupMsg: '무릎을 세우고 누운 채 잠깐 멈춰 주세요',
  },
  mountain: {
    kind: 'cardio', view: 'side', down: 'arms', axis: 'x', chain: 'leg', arcAt: 1, lockRot: true,
    legs: (m) => [m.hipA.L, m.hipA.R], dir: -1, on: { relaxed: 115, strict: 100 }, off: 140, every: 10,
    pose: (m) => m.flat < 45,
    fault: (m) => -m.sag > 30 ? 'pike' : null,
    cues: { pike: '엉덩이를 낮게 유지하세요' },
    note: { relaxed: '무릎을 가슴 쪽으로 당길 때마다 세요.', strict: '무릎을 가슴 가까이 깊게 당겨야 세요.' },
    place: '휴대폰을 바닥에 가로로 세우고, 옆모습이 보이게 팔을 편 플랭크 자세를 해요.',
    setupMsg: '팔을 펴고 플랭크 자세로',
  },
  burpee: {
    kind: 'rep', view: 'side', down: 'stand', axis: 'y', chain: 'line', arcAt: 2, lockRot: true,
    sig: (m) => m.bodyTilt, dir: 1, ready: 25, start: 35, ret: 25, gap: 12, minMs: 400,
    depth: { relaxed: 60, strict: 70 },
    checks: [{ k: 'sag', at: 'peak', bad: (m) => m.sag > 20, pen: 10 }],
    cues: { depth: '다리를 뒤로 쭉 뻗어 플랭크까지 가요', sag: '플랭크에서 엉덩이가 처지지 않게' },
    note: { relaxed: '서기 → 플랭크 → 서기를 하면 1회로 세요.', strict: '다리를 끝까지 뻗은 플랭크까지 가야 세요.' },
    place: '휴대폰을 허리 높이에 세로로 세우고, 옆모습이 보이게 서요. 앞으로 몸 길이만큼 공간이 필요해요.',
    setupMsg: '옆으로 바르게 서서 잠깐 멈춰 주세요',
  },
  // ─ 유산소 (시간) ─
  jumpingjack: {
    kind: 'cardio', view: 'front', down: 'stand', axis: 'y', chain: 'armup', arcAt: 1,
    one: (m) => Math.min(m.arm.L, m.arm.R), dir: 1, on: { relaxed: 130, strict: 150 }, off: 70, every: 10,
    fault: null,
    checks: [{ k: 'feet', bad: (m) => m.feet < 1.3 }],
    cues: { feet: '팔을 올릴 때 발도 벌려요', arms: '팔을 머리 위까지 올려요' },
    note: { relaxed: '팔이 머리 높이까지 올라가면 1회로 세요.', strict: '팔을 머리 위로 끝까지 올려야 세요.' },
    place: '휴대폰을 허리 높이에 세로로 세우고, 정면을 보고 서요. 몸 전체가 보여야 해요.',
    setupMsg: '정면을 보고 서 주세요',
  },
  stepjack: {
    kind: 'cardio', view: 'front', down: 'stand', axis: 'y', chain: 'armup', arcAt: 1,
    one: (m) => Math.min(m.arm.L, m.arm.R), dir: 1, on: { relaxed: 130, strict: 150 }, off: 70, every: 10,
    fault: null,
    cues: { arms: '팔을 머리 위까지 올려요' },
    note: { relaxed: '팔이 머리 높이까지 올라가면 1회로 세요.', strict: '팔을 머리 위로 끝까지 올려야 세요.' },
    place: '휴대폰을 허리 높이에 세로로 세우고, 정면을 보고 서요. 몸 전체가 보여야 해요.',
    setupMsg: '정면을 보고 서 주세요',
  },
  highknees: {
    kind: 'cardio', view: 'side', down: 'stand', axis: 'y', chain: 'leg', arcAt: 1,
    legs: (m) => [m.hipA.L, m.hipA.R], dir: -1, on: { relaxed: 120, strict: 105 }, off: 150, every: 10,
    fault: null,
    cues: { low: '무릎을 허리 높이까지 들어요' },
    note: { relaxed: '무릎을 들 때마다 세요.', strict: '허벅지가 바닥과 거의 평행할 만큼 들어야 세요.' },
    place: '휴대폰을 허리 높이에 세로로 세우고, 옆모습이 보이게 서요.',
    setupMsg: '옆으로 서 주세요',
  },
};

// 사슬(화면에 빛나는 선으로 그릴 관절 5개)
export const CHAINS = {
  leg: ['shoulder', 'hip', 'knee', 'ankle', 'toe'],
  hinge: ['ear', 'shoulder', 'hip', 'knee', 'ankle'],
  bridge: ['shoulder', 'hip', 'knee', 'ankle', 'toe'],
  arm: ['shoulder', 'elbow', 'wrist', 'wrist', 'wrist'],
  body: ['wrist', 'shoulder', 'hip', 'knee', 'ankle'],
  line: ['ear', 'shoulder', 'hip', 'knee', 'ankle'],
  kneeline: ['ear', 'shoulder', 'hip', 'knee', 'knee'],
  bird: ['wrist', 'shoulder', 'hip', 'knee', 'ankle'],
  armup: ['wrist', 'shoulder', 'hip', 'knee', 'ankle'],
};
export const chainIdx = (key, side) => CHAINS[key].map((k) => IX[k][side === 'R' ? 1 : 0]);
export const downOf = (key) => DOWN[SPECS[key].down] || DOWN.fore;
// 옆으로 버티기: 바닥을 짚은 팔(엉덩이에서 먼 팔꿈치)의 어깨 → 팔꿈치가 아래쪽. 위쪽 팔은 손을 엉덩이에 둬서 방향이 다름
export function downVec(key, lm, aspect = 1) {
  if (SPECS[key].down !== 'support') return null;
  const hx = (lm[23].x + lm[24].x) / 2 * aspect, hy = (lm[23].y + lm[24].y) / 2;
  const far = (i) => Math.hypot(lm[i].x * aspect - hx, lm[i].y - hy);
  const [sh, el] = far(13) >= far(14) ? [11, 13] : [12, 14];
  return { dx: (lm[el].x - lm[sh].x) * aspect, dy: lm[el].y - lm[sh].y };
}

export const THRESHOLDS = { minVisibility: 0.5, edgeMargin: 0.01, sideMaxSpread: 0.45, readyMs: 800, readyMotion: 8, lostMs: 2500, smoothing: 0.5, minMs: 700, gap: 12 };

export function measure(key, lm, aspect = 1) {
  const S = SPECS[key], t = THRESHOLDS;
  if (!lm || lm.length < 33) return { visible: false, reason: 'none' };
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, v: lm[i].visibility ?? 0, rx: lm[i].x });
  const J = { L: {}, R: {} };
  for (const k in IX) { J.L[k] = P(IX[k][0]); J.R[k] = P(IX[k][1]); }
  J.nose = P(0);
  const core = ['shoulder', 'hip', 'knee', 'ankle'];
  const vis = (s) => core.reduce((a, k) => a + J[s][k].v, 0);
  const near = vis('L') >= vis('R') ? 'L' : 'R', n = J[near];
  const minVis = Math.min(...core.map((k) => n[k].v));
  const inF = (p) => p.rx > t.edgeMargin && p.rx < 1 - t.edgeMargin && p.y > t.edgeMargin && p.y < 1 - t.edgeMargin;
  if (minVis < t.minVisibility || !core.every((k) => inF(n[k]))) return { visible: false, reason: 'not_in_frame' };
  const torso = dist(n.shoulder, n.hip), leg = dist(n.hip, n.knee) + dist(n.knee, n.ankle);
  if (torso < 0.04 || leg < 0.06) return { visible: false, reason: 'too_far' };
  const spread = (Math.abs(J.L.shoulder.x - J.R.shoulder.x) * 0.4 + Math.abs(J.L.hip.x - J.R.hip.x) * 0.6) / torso;
  const per = (f) => ({ L: f(J.L), R: f(J.R) });
  const m = {
    visible: true, side: near === 'L' ? 'left' : 'right', near, J, spread, torso, leg,
    sideView: spread < t.sideMaxSpread,
    knee: per((s) => angle(s.hip, s.knee, s.ankle)),
    hipA: per((s) => angle(s.shoulder, s.hip, s.knee)),
    // 엉덩이 폄(부호 있음): 엉덩이가 어깨-무릎 선보다 위(천장 쪽)로 올라가면 180° 넘게 (허리 과신전)
    hipX: per((s) => { const a = angle(s.shoulder, s.hip, s.knee), k = (s.hip.x - s.shoulder.x) / ((s.knee.x - s.shoulder.x) || 1e-6), ly = s.shoulder.y + (s.knee.y - s.shoulder.y) * k; return s.hip.y < ly && k > 0 && k < 1 ? 360 - a : a; }),
    elbow: per((s) => angle(s.shoulder, s.elbow, s.wrist)),
    arm: per((s) => angle(s.hip, s.shoulder, s.wrist)),
    lean: tilt(n.shoulder, n.hip),
  };
  m.bent = m.knee.L <= m.knee.R ? 'L' : 'R';
  m.front = J.L.ankle.y >= J.R.ankle.y ? 'L' : 'R'; // 바닥에 디딘 앞발 = 더 아래에 있는 발목 (뒷발은 의자 위)
  const sh = mid(J.L.shoulder, J.R.shoulder), hp = mid(J.L.hip, J.R.hip), an = mid(J.L.ankle, J.R.ankle), kn = mid(J.L.knee, J.R.knee);
  m.bodyTilt = tilt(sh, an);
  m.flat = 90 - tilt(n.shoulder, n.ankle); // 몸이 바닥과 이루는 각(0 = 수평)
  // 처짐: 어깨-발목(무릎) 선에서 엉덩이가 아래(바닥 쪽, 화면 아래)로 내려간 각도. +처짐, -솟음
  const sagOf = (a, b) => { const o = offLine(a, b, n.hip), down = (b.x - a.x) >= 0 ? 1 : -1; return -deg(Math.atan2(o * down, dist(a, b) / 2)); };
  m.sag = sagOf(n.shoulder, n.ankle);
  m.sagK = sagOf(n.shoulder, n.knee);
  // 엎드려 팔·다리 들기: 어깨-엉덩이 선에서 손목·발목이 떨어진 거리(몸통 길이 대비, 부호 있음 → 준비 자세 기준 변화량을 씀)
  m.armLift = offLine(hp, sh, mid(J.L.wrist, J.R.wrist)) / torso;
  m.legLift = offLine(sh, hp, an) / torso;
  m.feet = dist(J.L.ankle, J.R.ankle) / (dist(J.L.hip, J.R.hip) || 0.01);
  void kn;
  return m;
}

const CUE_ORDER = ['arch', 'torso', 'pike', 'sag', 'deep', 'high', 'legs', 'straight', 'knee', 'jump', 'depth', 'hold', 'tempo', 'back'];
export function texts(key) {
  const S = SPECS[key];
  const CUE_TEXT = { ...C, ...S.cues, shallow: (S.cues && S.cues.depth) || C.depth };
  const NOREP_TEXT = { ...NR, ...(S.noreps || {}) };
  for (const k of Object.keys(CUE_TEXT)) if (!NOREP_TEXT[k]) NOREP_TEXT[k] = CUE_TEXT[k].replace(/[.!]?$/, '') + ' — 이번은 세지 않아요';
  return { CUE_TEXT, NOREP_TEXT };
}

export class MoveCounter {
  constructor(key, mode = 'relaxed') { this.key = key; this.S = SPECS[key]; this.setMode(mode); this.reset(); }
  setMode(mode) {
    const S = this.S; this.mode = mode === 'strict' ? 'strict' : 'relaxed';
    this.t = { ...THRESHOLDS, ...S, depth: S.depth && S.depth[this.mode], holdMs: S.holdMs && S.holdMs[this.mode], on: S.on && S.on[this.mode], ...(S.hold ? S.hold[this.mode] : {}) };
  }
  reset() {
    Object.assign(this, { state: 'setup', reps: 0, attempts: 0, repLog: [], readySince: null, readyVals: [], lostSince: null, s: null, cur: null, leaveAt: null, lastRepAt: -1e9, base: null, baseLeg: null, shallowSpoken: 0,
      held: 0, lastAt: null, faultSince: null, fault: null, faultSpokenAt: -1e9, faultCount: {}, limb: [false, false], one: false, lastMoveAt: -1e9, moveSpokenAt: -1e9, startAt: null });
  }
  get kind() { return this.S.kind; }
  _raw(m) { return this.S.sig ? this.S.sig(m, this.S) : 0; }
  _sig(m) {
    let v = this._raw(m);
    if (this.S.base && this.base != null) v = this.S.base === 'abs' ? Math.abs(v - this.base) : v - this.base;
    this.s = this.s == null ? v : this.t.smoothing * v + (1 - this.t.smoothing) * this.s;
    return this.s;
  }
  _past(x, th) { return this.S.dir < 0 ? x <= th : x >= th; }
  _viewOk(m) { return this.S.view === 'any' || (this.S.view === 'front' ? m.spread > 0.3 : m.sideView); } // 정면: 어깨·엉덩이 너비가 몸통의 30% 넘게 보이면

  update(m, now) {
    const t = this.t;
    if (!m || !m.visible || !this._viewOk(m)) {
      this.readySince = null; this.readyVals = []; this.lastAt = null;
      if (this.state !== 'setup' && this.kind === 'rep') {
        if (this.lostSince === null) this.lostSince = now;
        if (now - this.lostSince > t.lostMs) { this.state = 'setup'; this.cur = null; this.s = null; return { event: 'lost' }; }
      }
      return { event: m && m.visible ? 'not_side' : 'not_visible', reason: m && m.reason };
    }
    this.lostSince = null;
    if (this.kind === 'hold') return this._hold(m, now);
    if (this.kind === 'cardio') return this._cardio(m, now);
    return this._rep(m, now);
  }

  // ─ 횟수 ─
  _rep(m, now) {
    const t = this.t, S = this.S;
    if (this.state === 'setup') {
      const raw = this._raw(m);
      // 기준값 종목은 준비 자세 값 자체를 0으로 잡으므로 '가만히 있는지'만 봄
      const inPose = S.base ? true : S.dir < 0 ? raw >= t.ready : raw <= t.ready;
      if (!inPose) { this.readySince = null; this.readyVals = []; return { event: 'setup', hint: 'pose' }; }
      if (this.readySince === null) this.readySince = now;
      this.readyVals.push(raw);
      const lo = Math.min(...this.readyVals), hi = Math.max(...this.readyVals);
      if (hi - lo > (t.still ?? t.readyMotion)) { this.readySince = now; this.readyVals = [raw]; return { event: 'setup', hint: 'still' }; }
      if (now - this.readySince >= t.readyMs) {
        const v = [...this.readyVals].sort((a, b) => a - b);
        this.base = S.base ? v[Math.floor(v.length / 2)] : null;
        this.baseLeg = m.legLift; this.baseAnkle = Math.max(m.J.L.ankle.y, m.J.R.ankle.y);
        this.state = 'up'; this.s = null; this.readyVals = [];
        return { event: 'ready', resumed: this.attempts > 0 };
      }
      return { event: 'setup', hint: 'hold', progress: (now - this.readySince) / t.readyMs };
    }
    const s = this._sig(m);
    if (this.state === 'up') {
      // 기준값 종목: 준비 자세보다 더 '낮은' 값이 나오면 기준을 천천히 따라 내림 (들고 있을 때 기준이 잡혀도 회복)
      if (S.base === true && s < 0) this.base += s * 0.2;
      const leave = S.dir < 0 ? s < (t.ready + t.start) / 2 : s > (t.ready + t.start) / 2;
      if (leave) { if (this.leaveAt == null) this.leaveAt = now; } else this.leaveAt = null;
      if (this._past(s, t.start)) {
        this.state = 'down';
        this.cur = { startAt: this.leaveAt ?? now, peak: s, peakAt: now, inZone: 0, zoneSince: null, f: {}, nr: {}, frames: 0, baseAnkle: this.baseAnkle };
      }
      return { event: 'tracking', sig: s };
    }
    const c = this.cur;
    c.frames += 1;
    if (this._past(s, c.peak)) { c.peak = s; c.peakAt = now; }
    if (S.track) S.track(m, c, { legLift: this.baseLeg });
    // 인정 깊이 안에 머문 시간
    if (t.depth != null && this._past(s, t.depth)) { if (c.zoneSince == null) c.zoneSince = now; c.inZone = Math.max(c.inZone, now - c.zoneSince); } else c.zoneSince = null;
    const nearPeak = S.dir < 0 ? s <= c.peak + 6 * (t.gap / 12) : s >= c.peak - Math.abs(t.gap) / 2;
    for (const ck of S.checks || []) {
      if (ck.at === 'end') continue;
      if (ck.at === 'peak' && !nearPeak) continue;
      if (ck.bad(m, t, c)) { c.f[ck.k] = (c.f[ck.k] || 0) + 1; if (ck.noRep && ck.noRep(m, t, c)) c.nr[ck.k] = (c.nr[ck.k] || 0) + 1; }
    }
    if (!this._past(s, t.ret)) {
      this.state = 'up'; this.cur = null; this.leaveAt = null;
      if (now - c.startAt < t.minMs || now - this.lastRepAt < t.minMs * 0.6) return { event: 'ignored', ms: Math.round(now - c.startAt) };
      const countZone = S.dir < 0 ? t.start - (t.start - t.depth) * 0.5 : t.start + (t.depth - t.start) * 0.5;
      if (!this._past(c.peak, countZone)) {
        const speak = this.shallowSpoken < 2; if (speak) this.shallowSpoken += 1;
        return { event: 'shallow', speak };
      }
      this.lastRepAt = now;
      c.endAt = now;
      return this._finishRep(c, m);
    }
    return { event: 'tracking', sig: s };
  }

  _finishRep(c, m) {
    const t = this.t, S = this.S, faults = [];
    const depthOk = this._past(c.peak, t.depth);
    const gapLine = S.dir < 0 ? t.depth + t.gap : t.depth - t.gap;
    const minFrames = Math.max(2, Math.round(c.frames * 0.15));
    for (const ck of S.checks || []) {
      if (ck.at === 'end') { if (ck.bad(c, t, c)) faults.push(ck.k); continue; }
      if ((c.f[ck.k] || 0) >= minFrames) faults.push(ck.k);
    }
    if (!depthOk) faults.push('depth');
    const descent = c.peakAt - c.startAt, back = c.endAt - c.peakAt;
    if (t.fastMs && descent < t.fastMs) faults.push('tempo');
    if (t.slowBackMs && back < t.slowBackMs) faults.push('back');
    if (t.holdMs && depthOk && c.inZone < t.holdMs) faults.push('hold');
    let noRep = null;
    for (const ck of S.checks || []) if (ck.noRep && (c.nr[ck.k] || 0) >= minFrames) { noRep = ck.k; break; }
    if (!noRep && !this._past(c.peak, gapLine)) noRep = 'depth';
    if (!noRep && this.mode === 'strict' && faults.includes('hold')) noRep = 'hold';
    let score = 100;
    for (const f of faults) score -= f === 'depth' ? 20 : f === 'tempo' || f === 'back' ? 10 : 15;
    score = Math.max(0, score);
    const cue = CUE_ORDER.find((k) => faults.includes(k)) || null;
    this.attempts += 1;
    if (!noRep) this.reps += 1;
    const r = (x) => Math.abs(x) < 2 ? Math.round(x * 1000) / 1000 : Math.round(x);
    const rec = { n: this.attempts, count: this.reps, counted: !noRep, noRep, score, faults, cue, depthOk, peak: r(c.peak), descentMs: Math.round(descent), topMs: Math.round(c.inZone) };
    this.repLog.push(rec);
    return { event: noRep ? 'norep' : 'rep', rep: rec };
  }

  // ─ 버티기: 바른 자세일 때만 시간이 흐름 ─
  _hold(m, now) {
    const t = this.t, S = this.S;
    const inPose = S.pose(m), f = inPose ? S.fault(m, t) : 'pose';
    this.s = S.sig(m);
    if (this.state === 'setup') {
      if (!inPose) { this.readySince = null; return { event: 'setup', hint: 'pose' }; }
      if (this.readySince === null) this.readySince = now;
      if (now - this.readySince >= 500) { this.state = 'hold'; this.lastAt = now; this.startAt = now; return { event: 'ready', resumed: this.held > 0 }; }
      return { event: 'setup', hint: 'hold', progress: (now - this.readySince) / 500 };
    }
    const dt = this.lastAt == null ? 0 : Math.min(250, now - this.lastAt); this.lastAt = now;
    if (f) {
      if (this.fault !== f) { this.fault = f; this.faultSince = now; }
      if (now - this.faultSince >= 400) {
        const k = f === 'pose' ? 'pose' : f;
        const speak = now - this.faultSpokenAt > 3500; if (speak) { this.faultSpokenAt = now; this.faultCount[k] = (this.faultCount[k] || 0) + 1; }
        return { event: 'holdfault', fault: k, speak, sec: this.held / 1000 };
      }
    } else { if (this.fault) this.faultSpokenAt = -1e9; this.fault = null; }
    this.held += dt;
    return { event: 'hold', sec: this.held / 1000, resumedNow: false };
  }

  // ─ 유산소: 움직이는 동안만 시간이 흐르고 횟수도 셈 ─
  _cardio(m, now) {
    const t = this.t, S = this.S;
    if (this.state === 'setup') {
      if (S.pose && !S.pose(m)) { this.readySince = null; return { event: 'setup', hint: 'pose' }; }
      if (this.readySince === null) this.readySince = now;
      if (now - this.readySince >= 500) { this.state = 'go'; this.lastAt = now; this.lastMoveAt = now; return { event: 'ready', resumed: this.held > 0 }; }
      return { event: 'setup', hint: 'hold', progress: (now - this.readySince) / 500 };
    }
    const dt = this.lastAt == null ? 0 : Math.min(250, now - this.lastAt); this.lastAt = now;
    const past = (x, th) => (S.dir < 0 ? x <= th : x >= th);
    let rep = null;
    const step = (i, v) => {
      if (!this.limb[i] && past(v, t.on)) { this.limb[i] = true; rep = { limb: i }; }
      else if (this.limb[i] && !past(v, t.off)) this.limb[i] = false;
    };
    if (S.legs) S.legs(m).forEach((v, i) => step(i, v)); else step(0, S.one(m));
    const ff = S.fault ? S.fault(m, t) : null;
    if (ff) this.faultCount[ff] = (this.faultCount[ff] || 0) + 1;
    for (const ck of S.checks || []) if (rep && ck.bad(m)) this.faultCount[ck.k] = (this.faultCount[ck.k] || 0) + 1;
    if (rep) {
      this.reps += 1; this.attempts += 1; this.lastMoveAt = now;
      const bad = (S.checks || []).find((ck) => ck.bad(m));
      const cue = ff || (bad && bad.k) || null;
      const speakCue = cue && now - this.faultSpokenAt > 4000; if (speakCue) this.faultSpokenAt = now;
      this.held += dt;
      return { event: 'beat', count: this.reps, sec: this.held / 1000, cue: speakCue ? cue : null, speakCount: this.reps % t.every === 0 };
    }
    if (now - this.lastMoveAt > 2500) {
      const speak = now - this.moveSpokenAt > 4000; if (speak) this.moveSpokenAt = now;
      return { event: 'holdfault', fault: 'move', speak, sec: this.held / 1000 };
    }
    this.held += dt;
    return { event: 'hold', sec: this.held / 1000 };
  }

  // 버티기·유산소 세트 기록 한 줄 (요약·점수용)
  summary() {
    const fc = this.faultCount, total = Object.values(fc).reduce((a, b) => a + b, 0);
    const faults = Object.entries(fc).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const score = Math.max(40, 100 - (this.kind === 'hold' ? total * 8 : Math.round(total / Math.max(1, this.reps) * 60)));
    return { n: 1, count: 1, counted: true, noRep: null, score, faults: faults.slice(0, 2), cue: faults[0] || null, depthOk: true, sec: Math.round(this.held / 1000), reps: this.reps };
  }
}
