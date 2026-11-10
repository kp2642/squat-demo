// 내 플랜 v2 (브라우저·Node 공용, 외부 의존성 없음, 화면 문구 없음 → 언어와 무관하게 다시 쓸 수 있음)
// 근거: ACSM 입문자 권장(주 2~3회 전신, 주요 근육군마다 1~3세트 × 8~15회, 세트 사이 1~2분),
// NSCA 점진적 과부하(목표 횟수를 바른 자세로 다 하면 조금씩 올리고, 충분하면 더 어려운 동작으로),
// 11단계 기획(4주마다 회복 주, 체감 강도로 조절), 18단계(집 맨몸 약 30종목, 요일마다 다른 구성)

// 종목 정의. unit: rep(횟수) | sec(버티기 초). side: 한쪽씩 하는 종목(횟수·초는 한쪽 기준)
// start: 경력별 시작값 [처음, 6개월 미만, 6개월 이상]. cap: 이만큼 되면 세트 추가 또는 다음 단계(없으면 목표별 상한). step: 초 종목의 한 칸
export const EXDEF = {
  chairsquat: { unit: 'rep', start: [8, 10, 12] },
  squat: { unit: 'rep', start: [8, 10, 12], judged: true },
  jumpsquat: { unit: 'rep', start: [6, 8, 10], cap: 15 },
  splitsquat: { unit: 'rep', side: true, start: [6, 8, 10], cap: 12 },
  lunge: { unit: 'rep', side: true, start: [6, 8, 10], cap: 12 },
  bulgarian: { unit: 'rep', side: true, start: [6, 8, 10], cap: 12 },
  wallsit: { unit: 'sec', start: [20, 30, 40], cap: 60, step: 5 },
  sidelunge: { unit: 'rep', side: true, start: [6, 8, 10], cap: 12 },
  calfraise: { unit: 'rep', start: [12, 15, 15], cap: 25 },
  bridge: { unit: 'rep', start: [10, 12, 15], cap: 20 },
  slbridge: { unit: 'rep', side: true, start: [6, 8, 10], cap: 12 },
  goodmorning: { unit: 'rep', start: [8, 10, 12], judged: true },
  slrdl: { unit: 'rep', side: true, start: [6, 8, 10], cap: 12 },
  pushup: { unit: 'rep', start: [6, 8, 10], judged: true },
  chairdip: { unit: 'rep', start: [6, 8, 10], cap: 15 },
  pikepush: { unit: 'rep', start: [5, 6, 8], cap: 12 },
  yraise: { unit: 'rep', start: [8, 10, 12], cap: 15 },
  wraise: { unit: 'rep', start: [8, 10, 12], cap: 15 },
  superman: { unit: 'rep', start: [8, 10, 12], cap: 15 },
  kneeplank: { unit: 'sec', start: [20, 30, 30], cap: 45, step: 5 },
  plank: { unit: 'sec', start: [20, 30, 40], cap: 60, step: 5 },
  mountain: { unit: 'sec', start: [20, 30, 30], cap: 45, step: 5 },
  sideplankknee: { unit: 'sec', side: true, start: [15, 20, 20], cap: 40, step: 5 },
  sideplank: { unit: 'sec', side: true, start: [15, 20, 30], cap: 45, step: 5 },
  birddog: { unit: 'rep', side: true, start: [5, 6, 8], cap: 10 },
  deadbug: { unit: 'rep', side: true, start: [5, 6, 8], cap: 12 },
  curlup: { unit: 'rep', start: [8, 10, 12], cap: 15 },
  stepjack: { unit: 'sec', start: [30, 30, 30], cap: 60, step: 10 },
  jumpingjack: { unit: 'sec', start: [20, 30, 30], cap: 60, step: 10 },
  highknees: { unit: 'sec', start: [20, 30, 30], cap: 45, step: 5 },
  burpee: { unit: 'rep', start: [5, 6, 8], cap: 12 },
};

// 움직임 칸(슬롯). ladder: 쉬운 것 → 어려운 것('종목:자세'), startTier: 경력별 시작 단계, main: 큰 근육 종목(휴식 길게)
// 카메라로 판정하는 스쿼트·굿모닝·푸시업이 중간 단계에 오도록 해서, 6개월 이상도 판정 종목부터 시작
export const SLOTS = {
  knee: { main: true, ladder: ['chairsquat', 'squat', 'jumpsquat'], startTier: [0, 1, 1] },
  lunge: { main: true, ladder: ['splitsquat', 'lunge', 'bulgarian'], startTier: [0, 1, 1] },
  legc: { main: true, ladder: ['wallsit', 'sidelunge'], startTier: [0, 1, 1] },
  push: { main: true, ladder: ['pushup:incline', 'pushup:knees', 'pushup:full'], startTier: [0, 1, 2] },
  hingeA: { main: true, ladder: ['bridge', 'slbridge'], startTier: [0, 0, 1] },
  hingeB: { main: true, ladder: ['goodmorning', 'slrdl'], startTier: [0, 0, 0] },
  upper: { main: true, ladder: ['chairdip', 'pikepush'], startTier: [0, 0, 1] },
  backA: { ladder: ['yraise', 'wraise'], startTier: [0, 0, 1] },
  backB: { ladder: ['superman'], startTier: [0, 0, 0] },
  coreA: { ladder: ['kneeplank', 'plank'], startTier: [0, 1, 1] },
  coreB: { ladder: ['sideplankknee', 'sideplank'], startTier: [0, 1, 1] },
  coreC: { ladder: ['birddog', 'deadbug'], startTier: [0, 0, 1] },
  abs: { ladder: ['curlup'], startTier: [0, 0, 0] },
  calf: { ladder: ['calfraise'], startTier: [0, 0, 0] },
  cardio: { ladder: ['stepjack', 'jumpingjack', 'mountain', 'highknees', 'burpee'], startTier: [0, 1, 1], short: true },
};
// 요일 구성: 매번 하체(무릎) · 밀기 · 엉덩이 · 등 · 코어를 고르게. 주 2회는 A·B, 3회 이상은 A·B·C 순서로 돌아감
// 체중 감량 목표는 끝에 짧은 유산소(cardio)를 붙임
export const DAYS = {
  A: ['knee', 'push', 'hingeA', 'backA', 'coreA'],
  B: ['lunge', 'push', 'hingeB', 'backB', 'coreB'],
  C: ['legc', 'upper', 'hingeA', 'coreC', 'abs', 'calf'],
};
export const exOf = (entry) => entry.split(':')[0];
export const styleOf = (entry) => entry.split(':')[1] || null;
export const PUSHUP_STEPS = ['incline', 'knees', 'full'];

const LEVELS = ['new', 'lt6', 'ge6'];
const START_SETS = [2, 2, 3];
// 목표별 휴식(초)과 횟수 상한. 다이어트는 횟수를 더 많이·휴식을 짧게, 근육은 상한을 낮게 두고 세트를 늘림
const GOAL = {
  diet: { rest: { main: 60, acc: 30 }, cap: 20 },
  muscle: { rest: { main: 90, acc: 60 }, cap: 15 },
  fitness: { rest: { main: 75, acc: 45 }, cap: 15 },
};
export const LIMITS = { minReps: 5, minSec: 10, maxSets: 3 };

export const bmi = (p) => p.weight / ((p.height / 100) ** 2);
// 건강 확인에 '예'가 있거나, 65세 이상이거나, BMI 30 이상이면 한 단계 쉽게 시작
export function cautious(p) { return (p.parq || []).some(Boolean) || p.age >= 65 || bmi(p) >= 30; }

const capOf = (plan, ex) => EXDEF[ex].cap ?? plan.cap;
const stepOf = (ex) => EXDEF[ex].unit === 'sec' ? (EXDEF[ex].step || 5) : 1;

export function makePlan(p, today = new Date()) {
  const careful = cautious(p), g = GOAL[p.goal] || GOAL.fitness;
  const lv = Math.max(0, LEVELS.indexOf(p.level)), slv = careful ? Math.max(0, lv - 1) : lv;
  const sets = careful ? Math.min(START_SETS[lv], 2) : START_SETS[lv];
  const slots = {};
  for (const [k, s] of Object.entries(SLOTS)) {
    const tier = Math.min(s.startTier[slv], s.ladder.length - 1), ex = exOf(s.ladder[tier]);
    slots[k] = { tier, sets: s.short ? Math.min(sets, 2) : sets, reps: EXDEF[ex].start[slv], rest: s.short ? 30 : s.main ? g.rest.main : g.rest.acc };
  }
  return {
    v: 2, start: dayKey(monday(today)), days: p.days, goal: p.goal, level: p.level,
    mode: p.level === 'ge6' && !careful ? 'strict' : 'relaxed', cap: g.cap, careful, slots,
  };
}

// v1 플랜(스쿼트·굿모닝·푸시업만)을 v2로: 그동안 올린 횟수·세트·푸시업 자세는 이어받음
export function upgrade(plan, profile) {
  if (!plan || plan.v === 2) return plan;
  const np = makePlan(profile || { level: plan.level, goal: plan.goal, days: plan.days, age: 30, height: 170, weight: 65 });
  np.start = plan.start; np.mode = plan.mode; np.careful = plan.careful;
  const o = plan.ex || {};
  if (o.squat) Object.assign(np.slots.knee, { tier: 1, sets: o.squat.sets, reps: o.squat.reps });
  if (o.goodmorning) Object.assign(np.slots.hingeB, { tier: 0, sets: o.goodmorning.sets, reps: o.goodmorning.reps });
  if (o.pushup) Object.assign(np.slots.push, { tier: Math.max(0, PUSHUP_STEPS.indexOf(plan.pstyle)), sets: o.pushup.sets, reps: o.pushup.reps });
  return np;
}

// 날짜 도우미 (기기 시간대 기준)
export function monday(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
export function dayKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

// 몇 주차인지(1부터), 4·8·12…주차는 회복 주
export function weekInfo(plan, today = new Date()) {
  const w = Math.max(0, Math.round((monday(today) - parseDay(plan.start)) / (7 * 864e5)));
  return { week: w + 1, recovery: w % 4 === 3 };
}

// 다음에 할 요일 구성: 마지막으로 끝까지 한(빠른 체험 아닌) 운동의 다음 순서
export function nextDay(plan, history = []) {
  const order = plan.days >= 3 ? ['A', 'B', 'C'] : ['A', 'B'];
  const last = [...history].reverse().find(h => !h.quick && h.wk);
  return last ? order[(order.indexOf(last.wk) + 1) % order.length] : 'A';
}

// 오늘 할 운동: 회복 주에는 세트를 하나 줄임(횟수는 그대로)
export function todayPlan(plan, history = [], today = new Date()) {
  const { week, recovery } = weekInfo(plan, today), wk = nextDay(plan, history);
  const keys = [...DAYS[wk], ...(plan.goal === 'diet' ? ['cardio'] : [])];
  const items = keys.map(slot => {
    const s = plan.slots[slot], entry = SLOTS[slot].ladder[s.tier], ex = exOf(entry), d = EXDEF[ex];
    return { slot, ex, style: styleOf(entry), unit: d.unit, side: !!d.side, judged: !!d.judged, sets: recovery ? Math.max(1, s.sets - 1) : s.sets, reps: s.reps, rest: s.rest };
  });
  return { week, recovery, wk, items };
}

// 이번 주(월요일부터) 플랜대로 한 횟수, 최근 14일 운동 횟수
export function counts(history, today = new Date()) {
  const mon = dayKey(monday(today)), from = new Date(today); from.setDate(from.getDate() - 13);
  const real = history.filter(h => !h.quick);
  return {
    thisWeek: new Set(real.filter(h => h.day >= mon).map(h => h.day)).size,
    last14: new Set(real.filter(h => h.day >= dayKey(from)).map(h => h.day)).size,
  };
}

// 운동이 끝난 뒤 칸(슬롯)별로 다음 운동의 횟수·세트·단계 조절
// sets: [{slot, ex, target, counted, rpe}] (rpe: easy/ok/hard/max/null, 초 종목은 target·counted가 초)
// 돌려주는 값: {slot: {ex, from, to, why}}
// - 모든 세트를 목표만큼 했고 '쉬웠어요'가 많으면 +2칸, 그 외 다 했으면 +1칸 (횟수 종목 1칸 = 1회, 초 종목 = 5~10초)
// - '한계예요'가 있거나 목표의 70%도 못 채우면 -1칸, 그 사이면 그대로
// - 상한에 닿으면 세트를 하나 늘리고(최대 3), 3세트도 상한이면 다음 단계 동작으로(2세트, 그 동작의 중간 시작값)
// - 회복 주이거나 세트를 다 못 했으면 조절하지 않음
export function progress(plan, sets, recovery) {
  const out = {};
  const slots = [...new Set(sets.map(s => s.slot).filter(Boolean))];
  for (const k of slots) {
    const xs = sets.filter(s => s.slot === k), cur = plan.slots[k], lad = SLOTS[k].ladder;
    const entry = lad[cur.tier], ex = exOf(entry), step = stepOf(ex);
    const from = { sets: cur.sets, reps: cur.reps, entry };
    if (recovery) { out[k] = { ex, from, to: from, why: 'recovery' }; continue; }
    if (xs.length < cur.sets) { out[k] = { ex, from, to: from, why: 'partial' }; continue; } // 중간에 그만두면 그대로
    const hit = xs.every(s => s.counted >= s.target), done = xs.reduce((a, s) => a + s.counted, 0), want = xs.reduce((a, s) => a + s.target, 0);
    const rp = xs.map(s => s.rpe).filter(Boolean), easy = rp.filter(r => r === 'easy').length, max = rp.includes('max');
    let d = 0, why = 'same';
    if (max || done < want * 0.7) { d = -1; why = max ? 'max' : 'missed'; }
    else if (hit) { d = easy * 2 > rp.length ? 2 : 1; why = d === 2 ? 'easy' : 'hit'; }
    const min = EXDEF[ex].unit === 'sec' ? LIMITS.minSec : LIMITS.minReps, cap = capOf(plan, ex);
    let reps = Math.max(min, cur.reps + d * step), nsets = cur.sets, tier = cur.tier;
    if (reps >= cap) {
      if (nsets < LIMITS.maxSets) { nsets += 1; reps = Math.max(min, cap - 4 * step); why = 'addSet'; }
      else if (tier < lad.length - 1) { tier += 1; nsets = 2; reps = EXDEF[exOf(lad[tier])].start[1]; why = 'nextStep'; }
      else { reps = cap; why = 'top'; }
    }
    Object.assign(cur, { reps, sets: nsets, tier });
    out[k] = { ex, from, to: { sets: nsets, reps, entry: lad[tier] }, why };
  }
  return out;
}
