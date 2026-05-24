/**
 * 우선순위 점수 계산 — Phase 2 단순 가중합 (Phase 3 ROI 교체 대비 추상화).
 *
 * 입력 building 객체에서 buildingAge, grossFloorArea, mainUse 를 읽어
 * config (priority_score.json 파싱 결과) 의 weights/components 로 0~100 점수 산출.
 *
 * - age 또는 gfa 결측 → score=null (대상 자격 박탈)
 * - mainUse 가 components.use 에 없으면 _default 폴백 (useMatched=false 로 표시)
 * - formula_id 분기: 향후 'phase3_roi' 추가 시 같은 시그니처 유지
 */

import { readFile } from 'node:fs/promises';

/**
 * @param {object} building - 건물 properties 객체. 최소 { buildingAge, grossFloorArea, mainUse } 필요.
 * @param {object} config - priority_score.json 파싱 결과.
 * @returns {{ score: number|null, components: {age:number,area:number,use:number}|null, useMatched: boolean|null }}
 */
export function computePriority(building, config) {
  if (!config || !config.formula_id) {
    throw new Error('computePriority: config 또는 formula_id 누락');
  }

  const age = building?.buildingAge;
  const gfa = building?.grossFloorArea;
  const useName = building?.mainUse;

  // 결측 처리 — 대상 자격 박탈
  if (typeof age !== 'number' || typeof gfa !== 'number') {
    return { score: null, components: null, useMatched: null };
  }

  switch (config.formula_id) {
    case 'phase2_simple':
      return _computePhase2Simple(age, gfa, useName, config);
    // case 'phase3_roi': ...  (향후 추가)
    default:
      throw new Error(`computePriority: 미지원 formula_id "${config.formula_id}"`);
  }
}

/**
 * 사용 가능한 모든 건물의 use_score 매칭 통계.
 * pipeline 통합 시 진단용 카운터로 사용.
 *
 * @param {Array<object>} buildings
 * @param {object} config
 * @returns {{ matched: number, defaulted: number, missingScore: number, defaultedUses: Object<string,number> }}
 */
export function summarizeUseMatching(buildings, config) {
  const stat = { matched: 0, defaulted: 0, missingScore: 0, defaultedUses: {} };
  for (const b of buildings) {
    const r = computePriority(b, config);
    if (r.score === null) { stat.missingScore++; continue; }
    if (r.useMatched) stat.matched++;
    else {
      stat.defaulted++;
      const u = b.mainUse || '(null)';
      stat.defaultedUses[u] = (stat.defaultedUses[u] || 0) + 1;
    }
  }
  return stat;
}

/**
 * 헬퍼: priority_score.json 파일 로드.
 */
export async function loadConfig(path) {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw);
}

// ─────────────────────────────────────────────────────────────────
// 내부 구현
// ─────────────────────────────────────────────────────────────────

function _computePhase2Simple(age, gfa, useName, config) {
  const w = config.weights;
  const c = config.components;

  // 검증 — 가중치 합 100 (실수 누적 오차 허용)
  const wSum = w.age + w.area + w.use;
  if (Math.abs(wSum - 100) > 0.01) {
    throw new Error(`computePriority: weights 합이 100 이 아님 (${wSum})`);
  }

  // age component
  if (c.age.type !== 'linear_clip') {
    throw new Error(`computePriority: age component type 미지원 (${c.age.type})`);
  }
  const ageScore = _linearClip(age, c.age.min, c.age.max);

  // area component
  if (c.area.type !== 'linear_clip') {
    throw new Error(`computePriority: area component type 미지원 (${c.area.type})`);
  }
  const areaScore = _linearClip(gfa, c.area.min, c.area.max);

  // use component — 정확 매칭 후 _default 폴백
  const useTable = c.use;
  const useMatched = useName != null
    && Object.prototype.hasOwnProperty.call(useTable, useName)
    && useName !== '_default';
  const useScore = useMatched
    ? useTable[useName]
    : (useTable._default ?? 0.30);

  // 가중합 (0~100)
  const scoreRaw = w.age * ageScore + w.area * areaScore + w.use * useScore;

  return {
    score: _round1(scoreRaw),
    components: {
      age: _round3(ageScore),
      area: _round3(areaScore),
      use: _round3(useScore),
    },
    useMatched,
  };
}

function _linearClip(x, min, max) {
  if (max <= min) return 0;
  const t = (x - min) / (max - min);
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

function _round1(x) { return Math.round(x * 10) / 10; }
function _round3(x) { return Math.round(x * 1000) / 1000; }
