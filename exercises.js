// 종목별 설정: 판정 로직, 안내 문구, 그리기, 결과 기록 형식 (v40: app.js에서 분리)
// C: 앱 상태를 읽는 함수들 { pstyle(), counter() }
import * as SQ from './squat-logic.js?v=41';
import * as PU from './pushup-logic.js?v=41';
import * as GM from './goodmorning-logic.js?v=41';
import * as MV from './move-logic.js?v=41';
import { GX, PLACE } from './data-ko.js?v=41';
export const JUDGED3 = ['squat', 'pushup', 'goodmorning'];
export function makeExercises(C) {
  // 종목별 설정: 판정 로직, 안내 문구, 그리기, 결과 기록 형식
  const EXERCISES = {
    squat: {
      name: '스쿼트', lib: SQ, Counter: SQ.SquatCounter,
      intro: '휴대폰을 세로로 세워두고 몸 옆면이 보이게 서서, 똑바로 선 채 1초 멈추면 시작해요. 어깨부터 발목까지만 보이면 돼요(초광각이면 1m까지 가까이). 스쿼트를 하면 횟수를 세고, 자세를 소리로 알려드려요. 영상은 이 휴대폰 밖으로 나가지 않아요.',
      tips: ['1.5m', '허리 높이'], minSpan: 0.3, axis: 'y', core: () => [11, 23, 25, 27], down: [11, 12, 27, 28], // 어깨 → 발목이 아래쪽
      modeNote: {
        relaxed: '편안한 깊이까지 앉으면 인정해요. 운동이 처음이거나 유연성이 부족하면 이걸로 시작하세요.',
        strict: '허벅지가 바닥과 평행할 만큼 앉아야 인정하고, 상체 숙임도 더 엄격하게 봐요. 평행보다 깊이 앉는 건 괜찮지만 바닥까지 털썩 주저앉으면 세지 않아요.',
      },
      startSay: '옆으로 서서 어깨부터 발목까지 보이게 해주세요. 똑바로 서서 잠깐 멈추면 시작해요.',
      startStatus: '옆으로 서서 어깨부터 발목까지 화면에 들어오게 해주세요',
      notSide: ['몸 옆면이 카메라를 향하게 서주세요', '옆으로 서주세요'],
      setupMsg: '똑바로 서서 잠깐 멈춰주세요',
      lostMsg: '다시 똑바로 서서 잠깐 멈춰주세요',
      measure: (lm, aspect) => SQ.measure(lm, aspect),
      debug: (m, c) => `무릎각 ${m.knee.toFixed(0)}°\n상체-정강이 ${(m.torsoLean - m.shinLean).toFixed(0)}°\n측면 ${m.sideView ? '예' : '아니오'} (${m.spread.toFixed(2)})\n단계 ${c.state}`,
      joints: (m) => m && m.side === 'right' ? [12, 24, 26, 28, 32] : [11, 23, 25, 27, 31],
      arc: { at: 2, value: (m) => m.knee },
      colors(m, t) {
        const ok = m && m.visible && m.sideView;
        const k = ok && (m.knee <= t.depthKnee || m.hipY >= m.kneeY - 0.01) ? '#6FCF97' : '#6FA0FF';
        return [ok && m.torsoLean - m.shinLean > t.leanTol ? '#FFA94D' : '#6FA0FF', k, k, '#6FA0FF'];
      },
      detail: (r) => `무릎 ${r.minKnee}° · 허벅지 ${r.thigh}° · 하강 ${r.drop}% · 상체-정강이 ${r.leanGap}° · 상체 ${r.torso}°`,
      line: (r) => `무릎 ${r.minKnee}° / 허벅지 ${r.thigh}° / 하강 ${r.drop}% / 상체-정강이 ${r.leanGap}° / 상체 ${r.torso}° / 뒤꿈치 ${r.heel} / 하강시간 ${r.descentMs}ms`,
    },
    pushup: {
      name: '푸시업', lib: PU, Counter: PU.PushupCounter,
      intro: '휴대폰을 바닥에 가로로 세워두고 몸 옆면이 보이게 엎드려요(초광각이면 1m까지 가까이). 팔을 편 자세로 1초 멈추면 시작해요. 팔꿈치 각도로 깊이를, 어깨-엉덩이-발목 선으로 엉덩이 처짐을 봐요. 영상은 이 휴대폰 밖으로 나가지 않아요.',
      tips: ['가로 1.5m', '바닥'], minSpan: 0.2, axis: 'x', core: () => [11, 13, 15, 23, C.pstyle() === 'knees' ? 25 : 27], down: [11, 12, 15, 16], // 어깨 → 손목이 아래쪽(바닥)
      modeNote: {
        relaxed: '팔꿈치가 120° 정도까지 굽으면 인정해요. 허리가 크게 처지거나 바닥까지 내려앉으면 세지 않아요.',
        strict: '팔꿈치가 100° 정도까지 굽어야 인정하고, 몸통이 일직선에서 벗어나면 세지 않아요.',
      },
      startSay: '몸 옆면이 보이게 엎드려 주세요. 팔을 펴고 잠깐 멈추면 시작해요.',
      startStatus: '옆모습이 보이게 엎드려서 어깨부터 발목까지 화면에 들어오게 해주세요',
      notSide: ['몸 옆면이 카메라를 향하게 엎드려 주세요', '옆모습이 보이게 해주세요'],
      setupMsg: '팔을 펴고 엎드린 자세로 잠깐 멈춰주세요',
      lostMsg: '다시 팔을 펴고 엎드려서 잠깐 멈춰주세요',
      measure: (lm, aspect) => PU.measure(lm, aspect, C.pstyle()),
      debug: (m, c) => `팔꿈치 ${m.elbow.toFixed(0)}°\n엉덩이 ${m.hipDev >= 0 ? '처짐' : '솟음'} ${Math.abs(m.hipDev).toFixed(0)}°\n엎드림 ${m.plank ? '예' : '아니오'} · 측면 ${m.sideView ? '예' : '아니오'} (${m.spread.toFixed(2)})\n단계 ${c.state}`,
      arc: { at: 1, value: (m) => m.elbow },
      joints: (m) => { const r = m && m.side === 'right'; const a = C.pstyle() === 'knees' ? (r ? 26 : 25) : (r ? 28 : 27); return r ? [16, 14, 12, 24, a] : [15, 13, 11, 23, a]; },
      colors(m, t) {
        const ok = m && m.visible && m.sideView;
        const arm = ok && m.elbow <= t.depthElbow ? '#6FCF97' : '#6FA0FF';
        const body = ok && (m.hipDev > t.sagTol || -m.hipDev > t.pikeTol) ? '#FFA94D' : '#6FA0FF';
        return [arm, arm, body, body];
      },
      detail: (r) => `팔꿈치 ${r.minElbow}° · 처짐 ${r.sag}° · 솟음 ${r.pike}°`,
      line: (r) => `팔꿈치 ${r.minElbow}° / 어깨 하강 ${r.drop}% / 엉덩이 처짐 ${r.sag}° / 솟음 ${r.pike}° / 하강시간 ${r.descentMs}ms`,
    },
    goodmorning: {
      name: '굿모닝', lib: GM, Counter: GM.GoodMorningCounter,
      intro: '데드리프트의 기본이 되는 "엉덩이 접기" 동작이에요. 발은 골반 너비로 서서 손을 가슴 앞에 X자로 모으고, 무릎은 살짝만 굽혀요. 고개는 등과 일직선으로 두고, 등을 곧게 편 채 엉덩이를 뒤로 밀면서 2초쯤 천천히 상체를 숙이고, 허벅지 뒤가 당기면 엉덩이를 앞으로 밀며 일어나요. 휴대폰을 세로로 세워두고 옆모습이 보이게 서요(초광각이면 1m까지 가까이). 숙일 때 앞쪽으로 상체 길이만큼 공간이 필요해요. 영상은 이 휴대폰 밖으로 나가지 않아요.',
      tips: ['1.5m', '허리 높이'], minSpan: 0.3, axis: 'y', core: () => [11, 23, 25, 27], down: [23, 24, 27, 28], // 엉덩이 → 발목이 아래쪽 (숙여도 변하지 않음)
      modeNote: {
        relaxed: '상체를 45° 정도 숙이면 인정해요(40° 미만은 안 셈). 등이 크게 말리거나, 허리로만 숙이거나, 1초 남짓 만에 빠르게 숙이면 세지 않아요.',
        strict: '상체가 바닥과 거의 평행(70°)할 만큼 숙여야 인정해요. 등 굽힘, 허리로만 숙이기, 무릎을 다 편 채 숙이기, 1.2초보다 빠르게 숙이기는 세지 않아요.',
      },
      startSay: '옆으로 서서 손을 가슴에 모아 주세요. 똑바로 서서 잠깐 멈추면 시작해요. 등은 곧게, 엉덩이를 뒤로 빼면서 숙이세요.',
      startStatus: '옆으로 서서 어깨부터 발목까지 화면에 들어오게 해주세요',
      notSide: ['몸 옆면이 카메라를 향하게 서주세요', '옆으로 서주세요'],
      setupMsg: '손을 가슴에 모으고 똑바로 서서 잠깐 멈춰주세요',
      lostMsg: '다시 똑바로 서서 잠깐 멈춰주세요',
      measure: (lm, aspect) => GM.measure(lm, aspect),
      debug: (m, c) => `상체 숙임 ${m.lean.toFixed(0)}° · 등 휨 ${m.curve == null ? '-' : m.curve.toFixed(1) + '%'}\n엉덩이각 ${m.hip.toFixed(0)}° · 무릎각 ${m.knee.toFixed(0)}°\n엉덩이 뒤로 ${(m.hipBack * 100).toFixed(0)}% · 머리-등 ${m.head == null ? '-' : m.head.toFixed(0) + '°'}\n측면 ${m.sideView ? '예' : '아니오'} (${m.spread.toFixed(2)})\n단계 ${c.state}`,
      joints: (m) => m && m.side === 'right' ? [8, 12, 24, 26, 28] : [7, 11, 23, 25, 27],
      arc: { at: 2, value: (m) => m.hip },
      colors(m, t) {
        const ok = m && m.visible && m.sideView;
        const torso = ok && m.head != null && m.head < t.headFault ? '#FFA94D' : ok && m.lean >= t.depthLean ? '#6FCF97' : '#6FA0FF';
        const leg = ok && m.lean > t.startLean && (m.knee < t.kneeMin || m.knee > t.lockKnee) ? '#FFA94D' : '#6FA0FF';
        return [torso, torso, leg, leg];
      },
      detail: (r) => `상체 ${r.lean}° · 무릎 ${r.minKnee}° · 엉덩이 뒤로 ${r.hipBack}%`,
      line: (r) => `상체 숙임 ${r.lean}° / 엉덩이각 ${r.minHip}° / 무릎 ${r.minKnee}° / 엉덩이 뒤로 ${r.hipBack}% / 머리-등 ${r.head ?? '-'}° / 몸통 ${r.torso ?? '-'}% / 등 휨 ${r.curve ?? '-'}% / 하강시간 ${r.descentMs}ms`,
    },
  };
  function genEx(key) {
    const S = MV.SPECS[key], T = MV.texts(key), g = GX[key], floor = S.axis === 'x';
    const sideOf = (m) => S.chainSide === 'bentKnee' ? m.bent : S.chainSide === 'front' ? m.front : m.near;
    const names = MV.CHAINS[S.chain];
    const go = S.kind === 'rep' ? '준비 자세로 1초 멈추면 시작해요.' : S.kind === 'hold' ? '자세를 잡으면 시작하고, 바른 자세일 때만 시간이 흘러요.' : '자리를 잡으면 시작하고, 움직이는 동안 시간이 흐르며 횟수도 세요.';
    return {
      name: g[0], lib: T, kind: S.kind, lockRot: !!S.lockRot,
      Counter: function (md) { return new MV.MoveCounter(key, md); },
      intro: `${g[1]} ${S.place} ${go} 영상은 이 휴대폰 밖으로 나가지 않아요.`,
      tips: floor ? ['가로 1.5m', '바닥'] : ['1.5m', '허리 높이'], minSpan: floor ? 0.2 : 0.3, axis: S.axis,
      core: () => [11, 23, 25, 27], down: MV.downOf(key), modeNote: S.note,
      startSay: `${S.place} ${S.setupMsg}.`.replace('..', '.'),
      startStatus: S.view === 'front' ? '정면을 보고 몸 전체가 화면에 들어오게 해주세요' : '옆모습이 보이게, 어깨부터 발목까지 화면에 들어오게 해주세요',
      notSide: S.view === 'front' ? ['정면을 보고 서주세요', '정면을 봐 주세요'] : ['몸 옆면이 카메라를 향하게 해주세요', '옆모습이 보이게 해주세요'],
      setupMsg: S.setupMsg, lostMsg: '다시 준비 자세로 잠깐 멈춰 주세요',
      measure: (lm, aspect) => MV.measure(key, lm, aspect),
      debug: (m, c) => `신호 ${c.s == null ? '-' : (+c.s).toFixed(Math.abs(c.s) < 2 ? 3 : 0)} · 단계 ${c.state}\n${S.kind === 'rep' ? `${c.reps}회 / 시도 ${c.attempts}` : `${(c.held / 1000).toFixed(1)}초 · ${c.reps}회`}\n측면 ${m.sideView ? '예' : '아니오'} (${m.spread.toFixed(2)})`,
      joints: (m) => MV.chainIdx(S.chain, m && m.visible ? sideOf(m) : 'L'),
      arc: S.arcAt > 0 && S.arcAt < 4 ? { at: S.arcAt, value: (m) => { const j = m.J[sideOf(m)]; return MV.angle(j[names[S.arcAt - 1]], j[names[S.arcAt]], j[names[S.arcAt + 1]]); } } : null,
      colors(m, t) {
        const c = C.counter(), ok = m && m.visible;
        const good = ok && (S.kind === 'rep' ? c.s != null && t.depth != null && (S.dir < 0 ? c.s <= t.depth : c.s >= t.depth) : S.kind === 'hold' ? c.state === 'hold' && !c.fault : c.state === 'go');
        const col = ok && S.kind === 'hold' && c.fault ? '#FFA94D' : good ? '#6FCF97' : '#6FA0FF';
        return [col, col, col, col];
      },
      detail: (r) => r.sec != null ? `${r.sec}초${r.reps ? ' · ' + r.reps + '회' : ''}` : `깊이 ${r.peak} · 내려가는 시간 ${r.descentMs}ms${r.topMs ? ' · 끝 자세 ' + r.topMs + 'ms' : ''}`,
      line: (r) => r.sec != null ? `${r.sec}초 / ${r.reps}회 / 지적 ${r.faults.join('+') || '-'}` : `깊이 ${r.peak} / 하강 ${r.descentMs}ms / 끝 자세 ${r.topMs}ms`,
    };
  }
  for (const k of Object.keys(MV.SPECS)) { EXERCISES[k] = genEx(k); PLACE[k] = MV.SPECS[k].place; }
  EXERCISES.chairsquat = {
    ...EXERCISES.squat, name: GX.chairsquat[0],
    Counter: function () { return new SQ.SquatCounter('relaxed'); }, // 의자에 앉는 깊이라 늘 '편하게' 기준
    intro: `${GX.chairsquat[1]} 의자를 등 뒤에 두고, 휴대폰을 허리 높이에 세로로 세워 옆모습이 보이게 서요. 똑바로 선 채 1초 멈추면 시작해요. 영상은 이 휴대폰 밖으로 나가지 않아요.`,
    modeNote: { relaxed: '의자에 살짝 닿을 깊이(무릎 105° 정도)면 인정해요.', strict: '의자 스쿼트는 늘 편한 깊이 기준으로 봐요.' },
    startSay: '의자를 등 뒤에 두고 옆으로 서 주세요. 똑바로 서서 잠깐 멈추면 시작해요.',
  };
  PLACE.chairsquat = '의자를 등 뒤에 두고, 휴대폰을 허리 높이에 세로로 세워 옆모습이 보이게 서요.';

  return EXERCISES;
}
