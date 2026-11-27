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
  // v39: 모든 종목을 카메라로 보니, 휴대폰 자리(서서 → 의자 → 바닥)가 덜 바뀌게 서서 하는 종목을 앞에 모음
  A: ['knee', 'push', 'hingeA', 'backA', 'coreA'],
  B: ['lunge', 'hingeB', 'push', 'backB', 'coreB'],
  C: ['legc', 'calf', 'upper', 'hingeA', 'coreC', 'abs'],
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
  // v45: 강도 '높게' — 동작(단계)은 경력대로 두고, 횟수는 한 경력 위 시작값, 세트 +1(최대 3), 휴식 -15초. 건강 확인 '예' 등 조심해야 하면 무시
  const hard = p.intensity === 'high' && !careful, rlv = hard ? Math.min(2, slv + 1) : slv;
  const sets = careful ? Math.min(START_SETS[lv], 2) : Math.min(LIMITS.maxSets, START_SETS[lv] + (hard ? 1 : 0));
  const slots = {};
  for (const [k, s] of Object.entries(SLOTS)) {
    const tier = Math.min(s.startTier[slv], s.ladder.length - 1), ex = exOf(s.ladder[tier]);
    slots[k] = { tier, sets: s.short ? Math.min(sets, 2) : sets, reps: EXDEF[ex].start[rlv], rest: s.short ? 30 : Math.max(30, (s.main ? g.rest.main : g.rest.acc) - (hard ? 15 : 0)) };
  }
  return {
    v: 2, start: dayKey(monday(today)), days: p.days, goal: p.goal, level: p.level,
    mode: p.level === 'ge6' && !careful ? 'strict' : 'relaxed', cap: g.cap, careful, slots, intensity: hard ? 'high' : 'normal',
    // v40: 장소(첫 버전은 집 맨몸만), 기간(4·8·12주), 목표 체중(선택), 체중 감량 강화(유산소 주 250분)
    place: p.place || 'home', weeks: WEEKS.includes(p.weeks) ? p.weeks : 8, target: p.target || null, boost: !!p.boost, phase: 0,
  };
}

// ── v40: 기간과 목표 체중 ──
export const WEEKS = [4, 8, 12];
// 안전한 속도 (ACSM·대한비만학회 일반 권고): 감량은 주당 체중의 0.5~1%, 증량(근육 키우기)은 주당 0.25~0.5%
export const RATE = { lossMax: 0.01, lossGood: 0.0075, gainMax: 0.005, gainGood: 0.0035, minBMI: 18.5 };
// 목표 체중이 기간 안에 무리 없는지 확인. 돌려주는 값:
//  ok: 무리 없음 / kind: 'loss' | 'gain' / perWeek: 주당 변화(kg) / pct: 체중 대비 % / needWeeks: 권장 속도로 걸리는 주
//  extendTo: 늘리면 되는 기간(4·8·12주 중, 없으면 null) / safeTarget: 지금 기간에 맞는 목표 / lowBMI: 목표가 저체중(BMI 18.5 미만)
export function goalCheck({ weight, height, target, weeks, goal }) {
  if (!target || !weight || !weeks) return { ok: true, none: true };
  const diff = target - weight, kind = diff < 0 ? 'loss' : 'gain', abs = Math.abs(diff);
  const perWeek = abs / weeks, pct = perWeek / weight;
  const max = kind === 'loss' ? RATE.lossMax : RATE.gainMax, good = kind === 'loss' ? RATE.lossGood : RATE.gainGood;
  const needWeeks = Math.ceil(abs / (weight * good));
  const extendTo = WEEKS.find(w => w >= weeks && abs / w / weight <= max) ?? null;
  const safeTarget = Math[diff < 0 ? 'ceil' : 'floor']((weight + Math.sign(diff) * weight * max * weeks) * 2) / 2; // 0.5kg 단위, 늘 안전한 쪽으로 반올림
  const lowBMI = height ? target / ((height / 100) ** 2) < RATE.minBMI : false;
  const wrongWay = (goal === 'diet' && kind === 'gain') || (goal === 'muscle' && kind === 'loss' && abs > 0.5);
  return { ok: pct <= max && !lowBMI && !wrongWay, kind, perWeek: Math.round(perWeek * 100) / 100, pct: Math.round(pct * 1000) / 10, needWeeks, extendTo, safeTarget, lowBMI, wrongWay };
}
// 플랜 진행: 몇 주 중 몇 주차, 끝났는지
export function planSpan(plan, today = new Date()) {
  const { week } = weekInfo(plan, today), weeks = plan.weeks || 8;
  return { week, weeks, over: week > weeks, left: Math.max(0, weeks - week + 1) };
}
// v44: 목표 점검 — 남은 기간에 목표까지 필요한 주당 변화가 안전 속도(감량 1%·증량 0.5%)를 넘으면 behind
// 컨디션 때문에 덜 한 날을 다음에 몰아서 보충하지 않음(부상 위험) → 대신 기간 늘리기·목표 조정을 고르게 함
// 3주차부터, 기록된 최근 체중 기준. 돌려주는 값: null(안내 없음) | {behind, kind, need, pct, weeksLeft, extendTo, safeTarget, cut, stale}
export function goalPace(plan, weights = [], history = [], today = new Date()) {
  if (!plan.target || !weights.length) return null;
  const sp = planSpan(plan, today); if (sp.over || sp.week < 3) return null;
  const last = weights[weights.length - 1], now = last.kg, toGo = plan.target - now, kind = plan.goal === 'muscle' ? 'gain' : 'loss';
  if ((kind === 'loss' && toGo >= 0) || (kind === 'gain' && toGo <= 0)) return null; // 목표 달성
  const from = new Date(today); from.setDate(from.getDate() - 13);
  const cut = history.filter(h => !h.quick && h.cond && (['tired', 'low'].includes(h.cond.level) || (h.cond.parts || []).length) && h.day >= dayKey(from)).length;
  const stale = (today - parseDay(last.day)) / 864e5 > 10; // 10일 넘게 체중을 안 적음
  const max = kind === 'loss' ? RATE.lossMax : RATE.gainMax, weeksLeft = Math.max(1, sp.left), abs = Math.abs(toGo);
  const need = abs / weeksLeft, pct = need / now, behind = pct > max + 1e-9;
  if (!behind) return cut >= 3 ? { behind: false, kind, cut, stale } : null;
  const extendTo = WEEKS.find(w => w > (plan.weeks || 8) && abs / (w - sp.week + 1) / now <= max) ?? null;
  const safeTarget = Math[kind === 'loss' ? 'ceil' : 'floor']((now + Math.sign(toGo) * now * max * weeksLeft) * 2) / 2;
  return { behind, kind, need: Math.round(need * 100) / 100, pct: Math.round(pct * 1000) / 10, weeksLeft, extendTo, safeTarget, cut, stale };
}
// 체중 기록: [{day, kg}] → 처음·지금·목표까지 남은 양·최근 주당 변화
export function weightTrend(log = [], target = null) {
  if (!log.length) return null;
  const first = log[0], last = log[log.length - 1];
  const days = Math.max(1, (parseDay(last.day) - parseDay(first.day)) / 864e5);
  return { start: first.kg, now: last.kg, change: Math.round((last.kg - first.kg) * 10) / 10, perWeek: log.length > 1 ? Math.round((last.kg - first.kg) / days * 7 * 100) / 100 : null, toGo: target ? Math.round((target - last.kg) * 10) / 10 : null };
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

// ── v42: 단계 구성 (4주씩, 끝 주는 회복 주) ──
// 근거: 입문자 블록 주기화(NSCA·ACSM) — 처음엔 자세·적응, 다음엔 운동량(세트), 그다음엔 강도(더 어려운 동작)
//  base(기초, 1~4주): 자세를 익히는 시기. 한 번에 1칸씩만 올리고, 더 어려운 동작으로는 안 넘어감
//  build(발전, 5~8주): 큰 근육 종목 세트 +1(최대 3). 평소처럼 올리고 다음 동작으로도 넘어감
//  peak(강화, 9~12주): 큰 근육 종목 휴식 +15초, 상한보다 2칸 앞에서 다음 동작으로(강도 위주)
// 4주 플랜 = 기초, 8주 = 기초→발전, 12주 = 기초→발전→강화. 기간을 넘기면 마지막 단계 유지
export const PHASES = { 4: ['base'], 8: ['base', 'build'], 12: ['base', 'build', 'peak'] };
export function phaseOf(plan, today = new Date()) {
  const list = PHASES[plan.weeks] || PHASES[8], { week } = weekInfo(plan, today);
  const idx = Math.min(list.length - 1, Math.floor((week - 1) / 4));
  return { key: list[idx], idx, of: list.length, from: idx * 4 + 1, to: idx * 4 + 4, next: list[idx + 1] || null, list };
}
// 새 단계에 들어서면 한 번만 칸(슬롯) 설정을 바꿈. 바뀐 게 있으면 {key, changes} (화면 안내용), 없으면 null
export function enterPhase(plan, today = new Date()) {
  const ph = phaseOf(plan, today);
  if (plan.phase == null) { plan.phase = ph.idx; return null; } // v41 이전 플랜은 지금 단계부터 (바꾸지 않음)
  else if (plan.phase >= ph.idx) return null;
  const changes = [];
  for (let i = plan.phase + 1; i <= ph.idx; i++) {
    const key = ph.list[i];
    for (const [k, sl] of Object.entries(plan.slots)) {
      if (!SLOTS[k] || !SLOTS[k].main) continue;
      if (key === 'build' && sl.sets < LIMITS.maxSets && !plan.careful) { sl.sets += 1; changes.push(k); }
      if (key === 'peak') { sl.rest += 15; changes.push(k); }
    }
  }
  plan.phase = ph.idx;
  return { key: ph.key, changes: [...new Set(changes)] };
}

// 다음에 할 요일 구성: 마지막으로 끝까지 한(빠른 체험 아닌) 운동의 다음 순서
export function nextDay(plan, history = []) {
  const order = plan.days >= 3 ? ['A', 'B', 'C'] : ['A', 'B'];
  const last = [...history].reverse().find(h => !h.quick && h.wk);
  return last ? order[(order.indexOf(last.wk) + 1) % order.length] : 'A';
}

// 오늘 할 운동: 회복 주에는 세트를 하나 줄임(횟수는 그대로)
// pick: 빠른 체험에서 고른 구성(A/B/C). 없으면 기록대로 다음 구성
export function todayPlan(plan, history = [], today = new Date(), pick = null) {
  const { week, recovery } = weekInfo(plan, today), wk = pick && DAYS[pick] ? pick : nextDay(plan, history);
  const keys = [...DAYS[wk], ...(plan.goal === 'diet' ? ['cardio'] : [])];
  const items = keys.map(slot => {
    const s = plan.slots[slot], entry = SLOTS[slot].ladder[s.tier], ex = exOf(entry), d = EXDEF[ex];
    return { slot, ex, style: styleOf(entry), unit: d.unit, side: !!d.side, judged: !!d.judged, sets: recovery ? Math.max(1, s.sets - 1) : s.sets, reps: s.reps, rest: s.rest };
  });
  return { week, recovery, wk, items };
}

// ── v43: 오늘 컨디션으로 오늘 운동만 조절 (플랜 자체는 그대로) ──
// 부위별 부담: 그 부위가 아프거나(knee·back·shoulder·wrist·ankle) 근육통(legs·arms)이면 그 종목을 빼고 다른 부위 종목으로 채움
// 허리: 굽히고 펴며 버티는 동작(굿모닝·한 다리 RDL·슈퍼맨·Y·W)만 뺌. 버드독·데드버그·컬업·플랭크·엉덩이 들기는 허리 통증에도 흔히 쓰는 안정화 운동이라 남김(McGill)
export const LOAD = {
  chairsquat: ['knee', 'legs'], squat: ['knee', 'legs'], jumpsquat: ['knee', 'ankle', 'legs'], splitsquat: ['knee', 'legs'], lunge: ['knee', 'legs'],
  bulgarian: ['knee', 'legs'], wallsit: ['knee', 'legs'], sidelunge: ['knee', 'legs'], calfraise: ['ankle', 'legs'], bridge: ['legs'], slbridge: ['legs'],
  goodmorning: ['back', 'legs'], slrdl: ['back', 'legs', 'ankle'], pushup: ['shoulder', 'wrist', 'arms'], chairdip: ['shoulder', 'wrist', 'arms'],
  pikepush: ['shoulder', 'wrist', 'arms'], yraise: ['shoulder', 'back', 'arms'], wraise: ['shoulder', 'back', 'arms'], superman: ['back'],
  kneeplank: ['shoulder'], plank: ['shoulder'], mountain: ['shoulder', 'wrist'], sideplankknee: ['shoulder'], sideplank: ['shoulder'],
  birddog: ['wrist', 'knee', 'shoulder'], deadbug: [], curlup: [], stepjack: ['knee', 'ankle', 'legs'], jumpingjack: ['knee', 'ankle', 'legs'],
  highknees: ['knee', 'ankle', 'legs'], burpee: ['knee', 'ankle', 'wrist', 'shoulder', 'back', 'legs', 'arms'],
};
export const PARTS = ['knee', 'back', 'shoulder', 'wrist', 'ankle', 'legs', 'arms'];
export const PAIN = ['knee', 'back', 'shoulder', 'wrist', 'ankle']; // 관절 통증(근육통이 아닌 것)
// 대신 넣을 칸 순서: 오늘 구성에 없는 칸 중에서, 고른 부위에 부담이 없는 것
const FILL = ['hingeA', 'upper', 'coreC', 'abs', 'backB', 'calf', 'coreB', 'backA', 'push', 'coreA', 'knee', 'lunge', 'legc', 'hingeB'];
const loads = (ex, parts) => (LOAD[ex] || []).some(p => parts.includes(p));
function itemOf(plan, slot, recovery, entry) {
  const s = plan.slots[slot], e = entry || SLOTS[slot].ladder[s.tier], ex = exOf(e), d = EXDEF[ex];
  return { slot, ex, style: styleOf(e), unit: d.unit, side: !!d.side, judged: !!d.judged, sets: recovery ? Math.max(1, s.sets - 1) : s.sets, reps: entry ? d.start[1] : s.reps, rest: s.rest };
}
// cond: {level: 'good'|'tired'|'low', parts: [...]}
//  tired(조금 피곤): 세트 -1(최소 1) / low(많이 피곤): 1세트씩, 횟수 80%
//  → 세트를 다 안 하므로 progress()는 'partial'로 보고 다음 운동을 올리지 않음
// 돌려주는 값: {items, removed:[{slot,ex}], added:[{slot,ex,for}], swapped:[{slot,from,to}]}
export function adjustToday(plan, tp, cond) {
  const parts = (cond && cond.parts) || [], level = (cond && cond.level) || 'good';
  const removed = [], added = [], swapped = [], rows = [], used = new Set(tp.items.map(x => x.slot));
  let items = [];
  for (const it of tp.items) {
    const n0 = items.length;
    if (!loads(it.ex, parts)) items.push({ ...it });
    else rowsFill(it);
    rows.push({ from: it, i: items.length > n0 ? n0 : -1 });
  }
  function rowsFill(it) {
    if (it.slot === 'cardio') { // 유산소는 같은 칸에서 부담 없는 동작으로 바꿈(시간 종목만)
      const alt = SLOTS.cardio.ladder.find(e => EXDEF[exOf(e)].unit === 'sec' && !loads(exOf(e), parts));
      if (alt) { const n = itemOf(plan, 'cardio', tp.recovery, alt); n.reps = it.unit === 'sec' ? it.reps : n.reps; items.push(n); swapped.push({ slot: 'cardio', from: it.ex, to: n.ex }); }
      else removed.push({ slot: it.slot, ex: it.ex });
      return;
    }
    removed.push({ slot: it.slot, ex: it.ex });
    const k = FILL.find(k => !used.has(k) && plan.slots[k] && !loads(exOf(SLOTS[k].ladder[plan.slots[k].tier]), parts));
    if (k) { used.add(k); const n = itemOf(plan, k, tp.recovery); n.fill = it.slot; items.push(n); added.push({ slot: k, ex: n.ex, for: it.ex }); }
  }
  // great(최상): 큰 근육 종목만 오늘 한 세트 더(최대 4). 회복 주·아픈 곳을 고른 날은 늘리지 않음
  const greatBlocked = level === 'great' ? (tp.recovery ? 'recovery' : parts.length ? 'parts' : null) : null;
  if (level === 'great') { if (!greatBlocked) items = items.map(x => SLOTS[x.slot] && SLOTS[x.slot].main ? { ...x, sets: Math.min(LIMITS.maxSets + 1, x.sets + 1) } : x); }
  else if (level !== 'good') items = items.map(x => {
    const min = x.unit === 'sec' ? LIMITS.minSec : LIMITS.minReps, step = stepOf(x.ex);
    if (level === 'tired') return { ...x, sets: Math.max(1, x.sets - 1) };
    return { ...x, sets: 1, reps: Math.max(min, Math.round(x.reps * 0.8 / step) * step) };
  });
  // rows: 원래 종목마다 {from, to(바뀐 뒤 종목, 빠지면 null)} — 화면에서 바뀐 곳을 줄 그어 보여 줌
  return { items, removed, added, swapped, greatBlocked, rows: rows.map(r => ({ from: r.from, to: r.i >= 0 ? items[r.i] : null })) };
}
// v46: 복귀 미션 — 정해진 날을 건너뛰고 돌아온 날, 마지막에 1분 안팎의 가벼운 미션 하나(선택, 언제든 뺄 수 있음)
// 벌칙이 아니라 '돌아온 걸 반기는' 느낌: 벌로 느끼면 건너뛴 뒤 앱을 아예 안 여는 일이 많아짐(행동과학)
// 건너뜀: 마지막 운동(빠른 체험 제외) 뒤 지난 날 > 주 횟수로 본 간격(7÷횟수 올림) + 1  예) 주 3회 → 5일 이상
// 회복 주, 피곤하거나 아픈 곳을 고른 날은 없음. 오늘 구성에 없는 코어·유산소 칸에서 1세트
export function mission(plan, history = [], tp, cond, today = new Date()) {
  const last = [...history].reverse().find(h => !h.quick); if (!last) return null;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()), gap = Math.round((t0 - parseDay(last.day)) / 864e5);
  if (gap <= Math.ceil(7 / (plan.days || 3)) + 1) return null;
  if (tp.recovery || (cond && ((cond.parts || []).length || ['tired', 'low'].includes(cond.level)))) return { gap, off: true };
  const used = new Set(tp.items.map(x => x.slot));
  const k = ['coreA', 'cardio', 'abs', 'coreC'].find(k => !used.has(k) && plan.slots[k]);
  if (!k) return null;
  return { gap, item: { ...itemOf(plan, k, false), sets: 1, mission: true } };
}
// 같은 관절 통증이 최근 기록(빠른 체험 제외)에서 이번까지 몇 번 연속인지 — 3번이면 진료 권유
export function painStreak(history, parts) {
  const real = history.filter(h => !h.quick), out = {};
  for (const p of parts.filter(p => PAIN.includes(p))) {
    let n = 1; for (let i = real.length - 1; i >= 0 && ((real[i].cond && real[i].cond.parts) || []).includes(p); i--) n++;
    out[p] = n;
  }
  return out;
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
export function progress(plan, sets, recovery, today = new Date()) {
  const out = {}, phase = phaseOf(plan, today).key;
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
    else if (hit) { d = (easy * 2 > rp.length || plan.intensity === 'high') && phase !== 'base' ? 2 : 1; why = d === 2 ? (easy * 2 > rp.length ? 'easy' : 'hard') : 'hit'; } // 강도 높게: 다 채우면 두 칸
    const min = EXDEF[ex].unit === 'sec' ? LIMITS.minSec : LIMITS.minReps, cap = capOf(plan, ex);
    let reps = Math.max(min, cur.reps + d * step), nsets = cur.sets, tier = cur.tier;
    // 강화 단계: 3세트에서 상한 2칸 앞이면 다음 동작으로
    const early = phase === 'peak' && nsets >= LIMITS.maxSets && tier < lad.length - 1 && d > 0 && reps >= cap - 2 * step;
    if (reps >= cap || early) {
      if (nsets < LIMITS.maxSets) { nsets += 1; reps = Math.max(min, cap - 4 * step); why = 'addSet'; }
      else if (tier < lad.length - 1 && phase !== 'base') { tier += 1; nsets = 2; reps = EXDEF[exOf(lad[tier])].start[1]; why = 'nextStep'; }
      else if (tier < lad.length - 1) { reps = cap; why = 'phaseHold'; } // 기초 단계: 다음 동작은 발전 단계부터
      else { reps = cap; why = 'top'; }
    }
    Object.assign(cur, { reps, sets: nsets, tier });
    out[k] = { ex, from, to: { sets: nsets, reps, entry: lad[tier] }, why };
  }
  return out;
}
