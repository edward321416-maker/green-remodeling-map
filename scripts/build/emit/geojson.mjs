/**
 * emit/geojson.mjs
 * Gold GeoJSON — Silver 레코드 → 지도용 FeatureCollection.
 *
 * 포함 범위 (data_engineering_plan.md D3):
 *   - 대상 건물 (is_target)
 *   - 미매칭 건물 (no_road_address / road_no_match) — "정보 미확보", 지도에서 회색
 *   - 매칭-기준미달 건물은 includeNonTarget=true 일 때만
 *
 * meta 에는 GeoJSON 수록분(count·breakdown)뿐 아니라 팔달구 **전체 데이터셋**
 * 통계(sigungu_total_buildings·match_success·카디널리티 등)를 함께 실어, 페이지가
 * GeoJSON 만으로도 전체 현황을 표시할 수 있게 한다.
 * 속성 별칭은 페이지(app.js) 호환을 위해 카멜케이스를 사용한다.
 *
 * STEP 4-C (2026-05-23): 우선순위 점수 주입.
 *   - is_target=true 인 features 에 priority_score / priority_components /
 *     priority_use_matched 부착 (config/priority_score.json 기준)
 *   - meta 에 priority_score_stats · priority_score_distribution ·
 *     priority_use_match_rate · priority_formula_id · priority_weights 추가
 *   - is_target=false (정보 미확보·기준미달) 은 priority_score=null
 */

import { computePriority } from '../../scoring/computePriority.mjs';

/** 이 레코드를 Gold GeoJSON 에 넣을지 */
export function shouldInclude(rec, includeNonTarget) {
  if (rec.is_target) return true;
  if (rec.match_status !== 'matched') return true;     // 미매칭 = 정보 미확보
  return includeNonTarget;                              // 매칭-기준미달
}

function toFeature(r) {
  return {
    type: 'Feature',
    geometry: r.geometry,
    properties: {
      ufid: r.ufid,
      bldgName: r.name_shp || r.anno_shp || r.bld_nm || null,
      // 매칭 신뢰도
      match_status: r.match_status,
      match_key: r.match_key,
      match_cardinality: r.match_cardinality,
      data_source: r.data_source,
      snapshot_month: r.snapshot_month,
      is_target: r.is_target,
      // 주소·속성 (페이지 호환 별칭)
      address: r.road_address || r.jibun_address || null,
      roadAddress: r.road_address,
      jibunAddress: r.jibun_address,
      approvalYear: r.approval_year,
      buildingAge: r.building_age,
      grossFloorArea: r.gross_floor_area,
      mainUse: r.main_use,
      structure: r.structure,
      floorsAbove: r.floors_above,
      floorsBelow: r.floors_below,
      height: r.height,
      households: r.households,
      // 형상 지표
      polygon_area_m2: r.polygon_area_m2,
      polygon_arch_ratio: r.polygon_arch_ratio,
      shpFloors: r.nmly_shp,
    },
  };
}

const emptyCard = () => ({ '1:1': 0, '1:N': 0, 'N:1': 0, 'N:M': 0 });

/**
 * Silver 레코드(전체) → Gold GeoJSON FeatureCollection.
 * @param fence computeOutlierFence() 결과 — meta.outlier_fence 에 [하한,상한] 으로 기록
 * @param priorityConfig priority_score.json 파싱 결과 (있으면 features 에 priority_* 부착)
 */
export function emitGeoJSON({
  records, snapshotMonth, sigunguCd, criteria, fence = null,
  includeNonTarget = false, trialDong = null,
  priorityConfig = null,
}) {
  const features = [];
  let target = 0, unmatched = 0, nonTarget = 0;

  // 팔달구 전체 데이터셋 집계 (records = 전체 Silver 레코드)
  const cardAll = emptyCard();
  const cardTarget = emptyCard();
  let matchSuccess = 0, noRoad = 0, roadNoMatch = 0, targetTotal = 0;

  // 우선순위 점수 통계 누적 (is_target=true 한정)
  const priorityScores = [];
  let useMatched = 0, useDefaulted = 0;

  for (const r of records) {
    if (r.match_status === 'matched') {
      matchSuccess++;
      if (r.match_cardinality in cardAll) cardAll[r.match_cardinality]++;
    } else if (r.match_status === 'no_road_address') {
      noRoad++;
    } else if (r.match_status === 'road_no_match') {
      roadNoMatch++;
    }
    if (r.is_target) {
      targetTotal++;
      if (r.match_cardinality in cardTarget) cardTarget[r.match_cardinality]++;
    }
    // GeoJSON 수록 피처
    if (!shouldInclude(r, includeNonTarget)) continue;
    if (r.is_target) target++;
    else if (r.match_status !== 'matched') unmatched++;
    else nonTarget++;

    const f = toFeature(r);

    // 우선순위 점수 부착 (is_target 한정. 그 외는 null 로 명시)
    if (priorityConfig) {
      if (r.is_target) {
        const pr = computePriority(f.properties, priorityConfig);
        f.properties.priority_score = pr.score;
        f.properties.priority_components = pr.components;
        f.properties.priority_use_matched = pr.useMatched;
        if (pr.score !== null) {
          priorityScores.push(pr.score);
          if (pr.useMatched) useMatched++;
          else useDefaulted++;
        }
      } else {
        f.properties.priority_score = null;
        f.properties.priority_components = null;
        f.properties.priority_use_matched = null;
      }
    }

    features.push(f);
  }

  const total = records.length;

  const meta = {
    build_timestamp: new Date().toISOString(),
    area: trialDong ? `수원시 팔달구 (시범: 법정동 ${trialDong})` : '수원시 팔달구',
    sigunguCd,
    snapshot_month: snapshotMonth,
    crs: 'EPSG:4326',
    build: 'v2-pipeline',
    trial: trialDong || null,
    criteria,
    // ── 팔달구 전체 데이터셋 통계 (패널 표시용) ──
    sigungu_total_buildings: total,
    match_success: matchSuccess,
    match_rate: total ? Math.round((matchSuccess / total) * 1000) / 1000 : 0,
    no_road_address: noRoad,
    road_no_match: roadNoMatch,
    target_buildings: targetTotal,
    target_criteria: `${criteria.minAgeYears}년+ AND ${criteria.minGrossFloorArea}㎡+`,
    cardinality_all: cardAll,
    cardinality_target: cardTarget,
    outlier_fence: (fence && !fence.insufficient) ? [fence.lower, fence.upper] : null,
    // ── GeoJSON 수록 분포 (지도에 그려지는 피처) ──
    count: features.length,
    breakdown: { target, unmatched, matched_non_target: nonTarget },
  };

  // 우선순위 점수 통계 (priorityConfig 가 있을 때만)
  if (priorityConfig) {
    meta.priority_score_config_version = priorityConfig.version ?? null;
    meta.priority_formula_id = priorityConfig.formula_id ?? null;
    meta.priority_weights = priorityConfig.weights ?? null;
    meta.priority_score_stats = _scoreStats(priorityScores);
    meta.priority_score_distribution = _scoreDistribution(priorityScores);
    const useDenom = useMatched + useDefaulted;
    meta.priority_use_match_rate = useDenom > 0
      ? Math.round((useMatched / useDenom) * 1000) / 1000
      : null;
  }

  return { type: 'FeatureCollection', meta, features };
}

// ─────────────────────────────────────────────────────────────────
// 점수 통계 유틸 (meta 용)
// ─────────────────────────────────────────────────────────────────

function _scoreStats(scores) {
  if (!scores.length) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const median = sorted[Math.floor(n / 2)];
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const std = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean: Math.round(mean * 100) / 100,
    median,
    q1,
    q3,
    std: Math.round(std * 100) / 100,
  };
}

function _scoreDistribution(scores) {
  const b = { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0 };
  for (const s of scores) {
    if (s < 20) b['0-20']++;
    else if (s < 40) b['20-40']++;
    else if (s < 60) b['40-60']++;
    else if (s < 80) b['60-80']++;
    else b['80-100']++;
  }
  return b;
}
