/**
 * transforms/attribute_join.mjs
 * Silver 레코드 빌드 — 건물(L1) + 매칭된 표제부(L2) + 파생 속성을 결합.
 * 스키마: docs/schema_v1.md
 */

import { reproject, polygonAreaM2 } from './reproject.mjs';
import { parseBjcd } from '../identity_resolver.mjs';

/** 숫자 변환 (단위·콤마 제거). 변환 불가/빈값 → null */
function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
/** 공백("  ")만 든 문자열 → null */
function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function round(n, d = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
/** 사용승인일(YYYYMMDD 등) → 준공연도. 유효범위(1900~baseYear) 밖이면 null */
function parseApprovalYear(raw, baseYear) {
  if (raw == null) return null;
  const s = String(raw).replace(/[^0-9]/g, '');
  if (s.length < 4) return null;
  const y = parseInt(s.slice(0, 4), 10);
  return (y >= 1900 && y <= baseYear) ? y : null;
}

/**
 * 건물 배열 + 매칭 결과 → Silver 레코드 배열 (건물 1동당 1행, 미매칭 포함).
 * @param buildings    [{ props, geometry(원본 EPSG:5179), srcCode }]
 * @param matchResults runMatching() 결과 (buildings 와 동일 순서)
 */
export function buildSilverRecords(buildings, matchResults, { snapshotMonth, baseYear, minAge, minGfa }) {
  const records = [];

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const m = matchResults[i];
    const props = b.props;
    const t = m.title;

    // 형상: 면적은 원본(EPSG:5179 미터)에서, geometry 는 WGS84로 재투영
    const polygon_area_m2 = round(polygonAreaM2(b.geometry), 2);
    const geometry = reproject(b.geometry, b.srcCode);
    if (!geometry) continue;                        // Polygon/MultiPolygon 아님 — 제외 (드묾)

    const id = parseBjcd(props.BJCD)
      || { bjcd: String(props.BJCD ?? ''), sigungu: '', dong: '' };

    // 표제부(L2) 속성 — 매칭 시에만, 미매칭은 전부 null
    let bld_nm = null, road_address = null, jibun_address = null, use_apr_day = null;
    let gross_floor_area = null, arch_area = null, plat_area = null;
    let main_use_cd = null, main_use = null, structure_cd = null, structure = null;
    let floors_above = null, floors_below = null, height = null, households = null;
    let approval_year = null, building_age = null;
    if (t) {
      bld_nm = cleanStr(t.bldNm);
      road_address = cleanStr(t.newPlatPlc);
      jibun_address = cleanStr(t.platPlc);
      use_apr_day = cleanStr(t.useAprDay);
      gross_floor_area = toNumber(t.totArea);
      arch_area = toNumber(t.archArea);
      plat_area = toNumber(t.platArea);
      main_use_cd = cleanStr(t.mainPurpsCd);
      main_use = cleanStr(t.mainPurpsCdNm);
      structure_cd = cleanStr(t.strctCd);
      structure = cleanStr(t.strctCdNm);
      floors_above = toNumber(t.grndFlrCnt);
      floors_below = toNumber(t.ugrndFlrCnt);
      height = toNumber(t.heit);
      households = toNumber(t.hhldCnt);
      approval_year = parseApprovalYear(t.useAprDay, baseYear);
      building_age = approval_year != null ? baseYear - approval_year : null;
    }

    // 폴리곤 면적 / 건축면적 비율 — 카디널리티 1:1 일 때만.
    // 폴리곤(1층 외형)과 차원이 같은 archArea(건축면적)와 비교한다. 1.0 에 가까울수록 정합.
    // (연면적 totArea 는 전 층 합이라 폴리곤과 차원이 다르므로 쓰지 않는다 — schema_v1.md 참조)
    let polygon_arch_ratio = null;
    if (m.match_cardinality === '1:1' && arch_area > 0) {
      polygon_arch_ratio = round(polygon_area_m2 / arch_area, 4);
    }

    const is_target = m.match_status === 'matched'
      && building_age != null && building_age >= minAge
      && gross_floor_area != null && gross_floor_area >= minGfa;

    records.push({
      // ── 식별자 ──
      ufid: cleanStr(props.UFID),
      snapshot_month: snapshotMonth,
      bjcd: id.bjcd, sigungu_cd: id.sigungu, bjdong_cd: id.dong,
      // ── 매칭 ──
      road_key: m.road_key,
      match_status: m.match_status,
      match_key: m.match_key,
      match_cardinality: m.match_cardinality,
      data_source: t ? 'shp+api' : 'shp_only',
      // ── L1 연속수치지도 원본 ──
      name_shp: cleanStr(props.NAME),
      anno_shp: cleanStr(props.ANNO),
      kind_shp: cleanStr(props.KIND),
      nmly_shp: toNumber(props.NMLY),
      rdnm: cleanStr(props.RDNM),
      bonu: Number(props.BONU) || 0,
      bunu: Number(props.BUNU) || 0,
      // ── L2 건축물대장 표제부 ──
      bld_nm, road_address, jibun_address, use_apr_day,
      gross_floor_area, arch_area, plat_area,
      main_use_cd, main_use, structure_cd, structure,
      floors_above, floors_below, height, households,
      // ── 파생 ──
      approval_year, building_age,
      polygon_area_m2, polygon_arch_ratio,
      is_target,
      quality_flags: [],                  // pipeline 이 validators 로 채움
      // ── 형상 (WGS84) ──
      geometry,
    });
  }

  return records;
}
