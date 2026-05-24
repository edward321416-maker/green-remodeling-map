/**
 * emit/summary_stats.mjs
 * 빌드 요약 통계 — 콘솔 출력용 집계.
 */

/**
 * @param records    Silver 레코드
 * @param fetchStats 동별 표제부 통계 [{dong, ok, totalCount, received, fromCache, reason?}]
 */
export function computeSummary(records, fetchStats) {
  const s = {
    total: records.length,
    matched: 0, no_road_address: 0, road_no_match: 0,
    target: 0,
    titlesReceived: 0,
    dongTotal: 0, dongCached: 0, dongFetched: 0, dongFailed: 0,
  };
  for (const r of records) {
    if (r.match_status in s) s[r.match_status]++;
    if (r.is_target) s.target++;
  }
  if (fetchStats && fetchStats.length) {
    s.dongTotal = fetchStats.length;
    for (const d of fetchStats) {
      if (!d.ok) { s.dongFailed++; continue; }
      s.titlesReceived += d.received;
      if (d.fromCache) s.dongCached++;
      else s.dongFetched++;
    }
  }
  return s;
}

/** 요약 객체 → 콘솔 출력 문자열 */
export function formatSummary(s) {
  const pct = (n) => (s.total ? (n / s.total * 100).toFixed(1) : '0.0') + '%';
  const lines = [
    '──────── 빌드 요약 ────────',
    `  건물 총수              : ${s.total}`,
    `  매칭 성공 (shp+api)    : ${s.matched}  (${pct(s.matched)})`,
    `  도로명 없음            : ${s.no_road_address}  (${pct(s.no_road_address)})`,
    `  도로명 매칭 실패       : ${s.road_no_match}  (${pct(s.road_no_match)})`,
    `  최종 대상 (15년·500㎡) : ${s.target}  (${pct(s.target)})`,
    `  표제부 수신            : ${s.titlesReceived}건`,
    `  법정동                 : ${s.dongTotal}개 (신규 ${s.dongFetched} / 캐시 ${s.dongCached} / 실패 ${s.dongFailed})`,
  ];
  return lines.join('\n');
}
