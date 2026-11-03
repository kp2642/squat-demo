// 내 플랜 v1 (브라우저·Node 공용, 외부 의존성 없음, 화면 문구 없음 → 언어와 무관하게 다시 쓸 수 있음)
// 근거: ACSM 입문자 권장(주 2~3회 전신, 종목당 1~3세트 × 8~15회, 세트 사이 1~2분),
// NSCA 점진적 과부하(목표 횟수를 바른 자세로 다 하면 조금씩 올림), 11단계 기획(4주마다 회복 주, 체감 강도로 조절)

export const EXS = ['squat', 'goodmorning', 'pushup'];
export const PUSHUP_STEPS = ['incline', 'knees', 'full'];

// 경력별 시작 세트·횟수
const START = {
  new: { sets: 2, reps: { squat: 8, goodmorning: 8, pushup: 6 } },
  lt6: { sets: 2, reps: { squat: 10, goodmorning: 10, pushup: 8 } },
  ge6: { sets: 3, reps: { squat: 12, goodmorning: 12, pushup: 10 } },
};
// 목표별 휴식(초)과 횟수 상한. 다이어트는 횟수를 더 많이·휴식을 짧게, 근육은 상한을 낮게 두고 세트를 늘림
const GOAL = {
  diet: { rest: { squat: 60, goodmorning: 45, pushup: 45 }, cap: 20 },
  muscle: { rest: { squat: 90, goodmorning: 60, pushup: 60 }, cap: 15 },
  fitness: { rest: { squat: 75, goodmorning: 60, pushup: 60 }, cap: 15 },
};
export const LIMITS = { minReps: 5, maxSets: 3 };

export const bmi = (p) => p.weight / ((p.height / 100) ** 2);

// 건강 확인에 '예'가 있거나, 65세 이상이거나, BMI 30 이상이면 한 단계 쉽게 시작
export function cautious(p) { return (p.parq || []).some(Boolean) || p.age >= 65 || bmi(p) >= 30; }

export function makePlan(p, today = new Date()) {
  const s = START[p.level] || START.new, g = GOAL[p.goal] || GOAL.fitness, careful = cautious(p);
  let step = p.level === 'ge6' ? 2 : p.level === 'lt6' ? 1 : 0;
  if (careful) step = Math.max(0, step - 1);
  const ex = {};
  for (const k of EXS) ex[k] = { sets: careful ? Math.min(s.sets, 2) : s.sets, reps: s.reps[k], rest: g.rest[k] };
  return {
    v: 1, start: dayKey(monday(today)), days: p.days, goal: p.goal, level: p.level,
    mode: p.level === 'ge6' && !careful ? 'strict' : 'relaxed',
    pstyle: PUSHUP_STEPS[step], cap: g.cap, careful, ex,
  };
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

// 오늘 할 운동: 회복 주에는 세트를 하나 줄임(횟수는 그대로)
export function todayPlan(plan, today = new Date()) {
  const { week, recovery } = weekInfo(plan, today);
  const items = EXS.map(k => ({ ex: k, sets: recovery ? Math.max(1, plan.ex[k].sets - 1) : plan.ex[k].sets, reps: plan.ex[k].reps, rest: plan.ex[k].rest }));
  return { week, recovery, items };
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

// 운동이 끝난 뒤 종목별로 다음 운동의 횟수·세트 조절
// sets: [{ex, target, counted, rpe}] (rpe: easy/ok/hard/max/null). 돌려주는 값: {ex: {from, to, sets, style, why}}
// - 모든 세트를 목표만큼 바르게 했고 '쉬웠어요'가 많으면 +2, 그 외 다 했으면 +1
// - '한계예요'가 있거나 목표의 70%도 못 채우면 -1, 그 사이면 그대로
// - 횟수가 상한에 닿으면 세트를 하나 늘리고(최대 3) 횟수는 상한-4로. 3세트도 상한이면 푸시업은 다음 단계 자세로(8회부터)
// - 회복 주이거나 세트를 다 못 했으면 조절하지 않음
export function progress(plan, sets, recovery) {
  const out = {};
  for (const k of EXS) {
    const xs = sets.filter(s => s.ex === k);
    if (!xs.length) continue;
    const cur = plan.ex[k], from = { sets: cur.sets, reps: cur.reps, style: k === 'pushup' ? plan.pstyle : null };
    if (recovery) { out[k] = { from, to: from, why: 'recovery' }; continue; }
    if (xs.length < cur.sets) { out[k] = { from, to: from, why: 'partial' }; continue; } // 중간에 그만두면 그대로
    const hit = xs.every(s => s.counted >= s.target), done = xs.reduce((a, s) => a + s.counted, 0), want = xs.reduce((a, s) => a + s.target, 0);
    const rp = xs.map(s => s.rpe).filter(Boolean), easy = rp.filter(r => r === 'easy').length, max = rp.includes('max');
    let d = 0, why = 'same';
    if (max || done < want * 0.7) { d = -1; why = max ? 'max' : 'missed'; }
    else if (hit) { d = easy * 2 > rp.length ? 2 : 1; why = d === 2 ? 'easy' : 'hit'; }
    let reps = Math.max(LIMITS.minReps, cur.reps + d), nsets = cur.sets, style = from.style;
    if (reps >= plan.cap) {
      if (nsets < LIMITS.maxSets) { nsets += 1; reps = plan.cap - 4; why = 'addSet'; }
      else if (k === 'pushup' && PUSHUP_STEPS.indexOf(style) < PUSHUP_STEPS.length - 1) { style = PUSHUP_STEPS[PUSHUP_STEPS.indexOf(style) + 1]; nsets = 2; reps = 8; why = 'nextStyle'; }
      else { reps = plan.cap; why = 'top'; }
    }
    cur.reps = reps; cur.sets = nsets; if (k === 'pushup') plan.pstyle = style;
    out[k] = { from, to: { sets: nsets, reps, style }, why };
  }
  return out;
}
