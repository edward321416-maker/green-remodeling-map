/**
 * quality/validators.mjs
 * Silver 레코드 품질 검증.
 *   - 필드 유효성 → quality_flags 코드
 *   - 이상치(area_mismatch): polygon_arch_ratio 의 Tukey IQR 펜스 밖 판정
 *
 * 임계값·방법은 config/target_criteria.json 에서 pipeline 이 읽어 주입한다 (단일 출처).
 *
 * 이상치 판정 배경: 연속수치지도 폴리곤 면적은 대장 건축면적보다 체계적으로 ~20% 크다
 * (도화상 외곽선 vs 건축법상 건축면적 — 측정 기준 차이, 데이터 오류 아님). 따라서
 * "비율 1.0 ±고정%" 검사는 부적합하고, 분포 자체에서 펜스를 잡는 Tukey IQR 을 쓴다.
 */

/** quality_flags 코드 → 설명 */
export const QUALITY_CODES = {
  use_apr_day_missing: '매칭됐으나 사용승인일 없음',
  use_apr_day_invalid: '사용승인일이 유효 연도 범위(1900~기준연도) 밖',
  gfa_missing: '매칭됐으나 연면적 없음',
  gfa_nonpositive: '연면적이 0 이하',
  polygon_degenerate: '폴리곤 면적이 임계 미만 (형상 불량)',
  area_mismatch: 'polygon_arch_ratio 가 Tukey IQR 펜스 밖 (1:1 매칭 한정)',
  dong_fetch_failed: '소속 법정동의 표제부 API 수신 실패 — 매칭 불가 처리',
};

const round4 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 1e4) / 1e4);

/** 정렬된 배열의 p분위수 — 선형보간 (numpy 'linear', R type 7 과 동일) */
function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * 1:1 매칭 건물의 polygon_arch_ratio 분포로 이상치 펜스를 산출.
 * 펜스 = [Q1 - multiplier*IQR, Q3 + multiplier*IQR].
 *
 * @returns {{method, multiplier, sampleSize, q1, median, q3, iqr, lower, upper, insufficient}}
 *          표본 < 4 면 insufficient:true (펜스 null → area_mismatch 판정 생략)
 */
export function computeOutlierFence(records, method = 'tukey_iqr', multiplier = 1.5) {
  if (method !== 'tukey_iqr') {
    // 향후 다른 방법(예: z-score, MAD) 도입 시 여기서 분기
    throw new Error(`지원하지 않는 outlier_method: '${method}' (현재 'tukey_iqr' 만 지원)`);
  }
  const ratios = records
    .filter((r) => r.match_cardinality === '1:1' && r.polygon_arch_ratio != null)
    .map((r) => r.polygon_arch_ratio)
    .sort((a, b) => a - b);

  if (ratios.length < 4) {
    return {
      method, multiplier, sampleSize: ratios.length,
      q1: null, median: null, q3: null, iqr: null, lower: null, upper: null,
      insufficient: true,
    };
  }
  const q1 = quantile(ratios, 0.25);
  const q3 = quantile(ratios, 0.75);
  const iqr = q3 - q1;
  return {
    method, multiplier, sampleSize: ratios.length,
    q1: round4(q1), median: round4(quantile(ratios, 0.5)), q3: round4(q3), iqr: round4(iqr),
    lower: round4(q1 - multiplier * iqr),
    upper: round4(q3 + multiplier * iqr),
    insufficient: false,
  };
}

/**
 * 레코드 1건 검증 → 위반 코드 배열 (없으면 []).
 * @param rec        Silver 레코드 (approval_year·polygon_arch_ratio 등 파생 완료 상태)
 * @param thresholds { polygonMinAreaM2 } — config 에서 주입
 * @param fence      computeOutlierFence() 결과 — area_mismatch 판정 기준
 *
 * 주의: dong_fetch_failed 는 법정동 단위 정보라 여기서 판정하지 않는다 (pipeline 이 부여).
 */
export function validateRecord(rec, thresholds, fence) {
  const { polygonMinAreaM2 } = thresholds;
  const flags = [];

  if (rec.match_status === 'matched') {
    if (rec.approval_year == null) {
      flags.push(rec.use_apr_day ? 'use_apr_day_invalid' : 'use_apr_day_missing');
    }
    if (rec.gross_floor_area == null) flags.push('gfa_missing');
    else if (rec.gross_floor_area <= 0) flags.push('gfa_nonpositive');
  }

  if (!(rec.polygon_area_m2 > polygonMinAreaM2)) flags.push('polygon_degenerate');

  // 이상치: 1:1 매칭 건물의 polygon_arch_ratio 가 Tukey IQR 펜스 밖일 때
  if (rec.match_cardinality === '1:1' && rec.polygon_arch_ratio != null
      && fence && !fence.insufficient) {
    if (rec.polygon_arch_ratio < fence.lower || rec.polygon_arch_ratio > fence.upper) {
      flags.push('area_mismatch');
    }
  }

  return flags;
}
