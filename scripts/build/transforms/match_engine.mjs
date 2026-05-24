/**
 * transforms/match_engine.mjs
 * 도로명 매칭 엔진 — 연속수치지도 건물 ⋈ 건축물대장 표제부.
 *
 * match_status   : matched | no_road_address | road_no_match
 * match_cardinality : 한 도로명키의 건물 폴리곤 수 P, 표제부 수 T 로 분류
 *                     1:1 / 1:N(P=1,T>1) / N:1(P>1,T=1) / N:M(P>1,T>1)
 */

import { buildingRoadKey, titleRoadKey } from '../identity_resolver.mjs';

/** 같은 도로명키의 표제부 여러 건 중 대표 1건: 주건축물 우선, 그중 연면적 최대 */
export function pickRepresentative(a, b) {
  const am = String(a.mainAtchGbCd ?? '0') === '0';
  const bm = String(b.mainAtchGbCd ?? '0') === '0';
  if (am !== bm) return am ? a : b;
  return (Number(b.totArea) || 0) > (Number(a.totArea) || 0) ? b : a;
}

/** 표제부 목록 → 도로명키 인덱스. Map(roadKey → { items:[], representative }) */
export function buildTitleIndex(titles) {
  const idx = new Map();
  for (const it of titles) {
    const k = titleRoadKey(it);
    if (!k) continue;
    let e = idx.get(k);
    if (!e) { e = { items: [], representative: null }; idx.set(k, e); }
    e.items.push(it);
    e.representative = e.representative ? pickRepresentative(e.representative, it) : it;
  }
  return idx;
}

/**
 * 건물 배열을 표제부 인덱스에 매칭.
 * @returns buildings 와 같은 순서의 결과 배열
 *          [{ road_key, match_status, match_key, match_cardinality, title }]
 */
export function runMatching(buildings, titleIndex, sigunguCd) {
  const keys = buildings.map((b) => buildingRoadKey(b.props, sigunguCd));

  // 1패스: 도로명키별 건물 폴리곤 수 P
  const polyCount = new Map();
  for (const k of keys) if (k) polyCount.set(k, (polyCount.get(k) || 0) + 1);

  // 2패스: 분류
  return buildings.map((_, i) => {
    const k = keys[i];
    if (!k) {
      return { road_key: null, match_status: 'no_road_address', match_key: null, match_cardinality: null, title: null };
    }
    const entry = titleIndex.get(k);
    if (!entry) {
      return { road_key: k, match_status: 'road_no_match', match_key: null, match_cardinality: null, title: null };
    }
    const P = polyCount.get(k) || 1;
    const T = entry.items.length;
    const match_cardinality = (P === 1 && T === 1) ? '1:1'
      : (P === 1) ? '1:N'
      : (T === 1) ? 'N:1'
      : 'N:M';
    return { road_key: k, match_status: 'matched', match_key: k, match_cardinality, title: entry.representative };
  });
}
