/**
 * quality/report_generator.mjs
 * Silver 품질 리포트(Markdown) 자동 생성 → build/silver/quality_reports/<월>.md
 *
 * STEP 4-F (2026-05-23): §8 우선순위 점수 섹션 추가.
 *   priorityConfig 매개변수 전달 시 priority_score 통계 + 분포 + use 매칭률 +
 *   Top 5 (raw 폴리곤 기준 — dedup 없음, 페이지 레이어가 dedup 담당).
 */

import { QUALITY_CODES } from './validators.mjs';
import { computePriority } from '../../scoring/computePriority.mjs';

const pct = (a, b) => (b ? (a / b * 100).toFixed(1) : '0.0') + '%';

/** silver record(snake_case) → computePriority 입력(camelCase) 어댑터 */
function recordToScoringInput(r) {
  return {
    buildingAge: r.building_age,
    grossFloorArea: r.gross_floor_area,
    mainUse: r.main_use,
  };
}

/**
 * @param records       Silver 레코드 (quality_flags 채워진 상태)
 * @param fetchStats    동별 표제부 통계 [{dong, ok, totalCount, received, fromCache, reason?}]
 * @param fence         computeOutlierFence() 결과 (Tukey IQR 펜스)
 * @param priorityConfig priority_score.json (있으면 §8 priority 섹션 생성)
 * @returns Markdown 문자열
 */
export function generateQualityReport({
  records, fetchStats, snapshotMonth, trialDong, criteria, fence, sourceInfo,
  priorityConfig = null,
}) {
  const L = [];
  const total = records.length;
  const matched = records.filter((r) => r.match_status === 'matched');
  const byStatus = { matched: 0, no_road_address: 0, road_no_match: 0 };
  for (const r of records) if (r.match_status in byStatus) byStatus[r.match_status]++;
  const targets = records.filter((r) => r.is_target);
  const failedDongs = (fetchStats || []).filter((d) => !d.ok);

  // ── 헤더 ──
  L.push(`# 품질 리포트 — ${snapshotMonth}${trialDong ? ` · 시범 빌드(법정동 ${trialDong})` : ''}`);
  L.push('');
  L.push(`- 생성 시각: ${new Date().toISOString()}`);
  L.push('- 대상: 수원시 팔달구 (41115)');
  L.push(`- 기준: 준공 ${criteria.minAgeYears}년 경과 AND 연면적 ${criteria.minGrossFloorArea}㎡ 이상 (기준연도 ${criteria.baseYear})`);
  L.push(`- 이상치 판정: ${fence?.method ?? '-'} (config/target_criteria.json)`);
  if (sourceInfo) L.push(`- 입력: ${sourceInfo}`);
  if (failedDongs.length) {
    L.push(`- ⚠ **표제부 수신 실패 법정동 ${failedDongs.length}개** — 해당 동 건물은 매칭 불가 처리됨 (2절 참조)`);
  }
  L.push('');

  // ── 1. 총괄 ──
  L.push('## 1. 총괄 · 매칭 통계');
  L.push('');
  L.push('| 항목 | 건수 | 비율 |');
  L.push('|------|------|------|');
  L.push(`| 건물 총수 | ${total} | 100% |`);
  L.push(`| 매칭 성공 (matched) | ${byStatus.matched} | ${pct(byStatus.matched, total)} |`);
  L.push(`| 도로명 없음 (no_road_address) | ${byStatus.no_road_address} | ${pct(byStatus.no_road_address, total)} |`);
  L.push(`| 도로명 매칭 실패 (road_no_match) | ${byStatus.road_no_match} | ${pct(byStatus.road_no_match, total)} |`);
  L.push(`| **최종 대상 (is_target)** | **${targets.length}** | ${pct(targets.length, total)} |`);
  L.push('');

  // ── 2. 페이지네이션 검증 / 법정동 수신 ──
  L.push('## 2. 페이지네이션 검증 · 법정동 수신 (안전장치 C·부분실패정책)');
  L.push('');
  if (fetchStats && fetchStats.length) {
    L.push('| 법정동 | totalCount | 수신 | 상태 | 출처 |');
    L.push('|--------|-----------|------|------|------|');
    for (const d of fetchStats) {
      const status = d.ok ? 'OK' : `**실패(${d.reason || 'unknown'})**`;
      const src = !d.ok ? '-' : (d.fromCache ? '캐시' : '신규');
      L.push(`| ${d.dong} | ${d.totalCount ?? '-'} | ${d.received ?? '-'} | ${status} | ${src} |`);
    }
    L.push('');
    if (failedDongs.length) {
      L.push(`→ ⚠ ${failedDongs.length}개 법정동 수신 실패. 해당 동 건물은 \`dong_fetch_failed\` 플래그로 표기되고 `
        + '매칭 불가(no_road_address/road_no_match) 처리됨. 나머지 동은 정상 진행.');
    } else {
      L.push('→ 전 법정동 검증 통과.');
    }
  } else {
    L.push('(표제부 다운로드 통계 없음)');
  }
  L.push('');

  // ── 3. 결측률 ──
  L.push('## 3. 결측률');
  L.push('');
  L.push('**L1 연속수치지도** — 전체 건물 기준');
  L.push('');
  L.push('| 필드 | 결측 | 결측률 |');
  L.push('|------|------|--------|');
  for (const f of ['name_shp', 'anno_shp', 'rdnm']) {
    const miss = records.filter((r) => r[f] == null).length;
    L.push(`| ${f} | ${miss} | ${pct(miss, total)} |`);
  }
  L.push('');
  L.push('**L2 건축물대장** — 매칭 건물 기준');
  L.push('');
  L.push('| 필드 | 결측 | 결측률 |');
  L.push('|------|------|--------|');
  for (const f of ['use_apr_day', 'gross_floor_area', 'arch_area', 'main_use', 'structure', 'floors_above', 'height', 'households']) {
    const miss = matched.filter((r) => r[f] == null).length;
    L.push(`| ${f} | ${miss} | ${pct(miss, matched.length)} |`);
  }
  L.push('');

  // ── 4. 매칭 신뢰도 (카디널리티) ──
  L.push('## 4. 매칭 신뢰도 — 카디널리티');
  L.push('');
  const card = { '1:1': 0, '1:N': 0, 'N:1': 0, 'N:M': 0 };
  for (const r of matched) if (r.match_cardinality in card) card[r.match_cardinality]++;
  L.push('| 카디널리티 | 건수 | 비율(매칭 중) | 의미 |');
  L.push('|-----------|------|--------------|------|');
  L.push(`| 1:1 | ${card['1:1']} | ${pct(card['1:1'], matched.length)} | 폴리곤1 ↔ 표제부1 (최고 신뢰) |`);
  L.push(`| 1:N | ${card['1:N']} | ${pct(card['1:N'], matched.length)} | 폴리곤1 ↔ 표제부N (집합건물 등) |`);
  L.push(`| N:1 | ${card['N:1']} | ${pct(card['N:1'], matched.length)} | 폴리곤N ↔ 표제부1 (형상 분할) |`);
  L.push(`| N:M | ${card['N:M']} | ${pct(card['N:M'], matched.length)} | 폴리곤N ↔ 표제부M (복합) |`);
  L.push('');

  // ── 5. 이상치 · Tukey IQR 펜스 · 품질 플래그 ──
  L.push('## 5. 이상치 · 품질 플래그');
  L.push('');
  L.push('### Tukey IQR 이상치 펜스 (D4)');
  L.push('');
  L.push('1:1 매칭 건물 `polygon_arch_ratio`(폴리곤면적÷건축면적) 분포에서 펜스를 산출하고,');
  L.push('펜스 밖을 `area_mismatch` 로 플래그한다. 재현·시계열 비교용으로 값을 명시한다.');
  L.push('');
  if (fence && !fence.insufficient) {
    L.push('| 항목 | 값 |');
    L.push('|------|------|');
    L.push(`| 방법 | ${fence.method} |`);
    L.push(`| 표본 (1:1 매칭) | ${fence.sampleSize} |`);
    L.push(`| Q1 / 중앙값 / Q3 | ${fence.q1} / ${fence.median} / ${fence.q3} |`);
    L.push(`| IQR | ${fence.iqr} |`);
    L.push(`| 승수 (k) | ${fence.multiplier} |`);
    L.push(`| **펜스 [하한, 상한]** | **[${fence.lower}, ${fence.upper}]** |`);
  } else {
    L.push(`(표본 부족 — ${fence?.sampleSize ?? 0}건, 펜스 산출 생략)`);
  }
  L.push('');
  const flagCount = {};
  for (const r of records) for (const f of r.quality_flags) flagCount[f] = (flagCount[f] || 0) + 1;
  L.push('### 품질 플래그 빈도');
  L.push('');
  L.push('| 플래그 | 건수 | 설명 |');
  L.push('|--------|------|------|');
  for (const code of Object.keys(QUALITY_CODES)) {
    L.push(`| ${code} | ${flagCount[code] || 0} | ${QUALITY_CODES[code]} |`);
  }
  L.push('');
  const mismatchN = flagCount['area_mismatch'] || 0;
  const denom = card['1:1'];
  L.push(`**area_mismatch (펜스 밖) 비율**: ${mismatchN} / ${denom} (1:1 매칭) = **${pct(mismatchN, denom)}**`);
  if (denom > 0 && mismatchN / denom > 0.5) {
    L.push('');
    L.push('> ⚠ 펜스 밖 비율이 50%를 초과합니다. 분포·매칭 정합성 원인 분석이 필요합니다.');
  }
  L.push('');
  const mismatch = records.filter((r) => r.quality_flags.includes('area_mismatch'));
  if (mismatch.length) {
    L.push('펜스 밖 표본 (최대 10건):');
    L.push('');
    L.push('| ufid | 폴리곤면적㎡ | 건축면적㎡ | polygon_arch_ratio |');
    L.push('|------|-------------|-----------|--------------------|');
    for (const r of mismatch.slice(0, 10)) {
      L.push(`| ${r.ufid} | ${r.polygon_area_m2} | ${r.arch_area} | ${r.polygon_arch_ratio} |`);
    }
    L.push('');
  }

  // ── 6. 사용승인일 분포 ──
  L.push('## 6. 사용승인일(경과연수) 분포 — 매칭 건물 기준');
  L.push('');
  const buckets = { '0-15년': 0, '15-25년': 0, '25-35년': 0, '35년+': 0, '미상': 0 };
  for (const r of matched) {
    const a = r.building_age;
    if (a == null) buckets['미상']++;
    else if (a < 15) buckets['0-15년']++;
    else if (a < 25) buckets['15-25년']++;
    else if (a < 35) buckets['25-35년']++;
    else buckets['35년+']++;
  }
  L.push('| 구간 | 건수 | 비율 | |');
  L.push('|------|------|------|---|');
  for (const [k, v] of Object.entries(buckets)) {
    const bar = '█'.repeat(Math.round(v / Math.max(1, matched.length) * 30));
    L.push(`| ${k} | ${v} | ${pct(v, matched.length)} | ${bar} |`);
  }
  L.push('');

  // ── 7. polygon_arch_ratio 분포 ──
  L.push('## 7. polygon_arch_ratio 분포 (1:1 매칭 한정)');
  L.push('');
  L.push('폴리곤 면적 ÷ 건축면적(archArea). 연속수치지도 외곽선이 건축법상 건축면적보다');
  L.push('체계적으로 크므로 중앙값은 1.0 보다 큰 것이 정상이다.');
  L.push('');
  const ratios = records
    .filter((r) => r.polygon_arch_ratio != null)
    .map((r) => r.polygon_arch_ratio)
    .sort((a, b) => a - b);
  if (ratios.length) {
    L.push(`- 표본 ${ratios.length}건 · 최소 ${ratios[0].toFixed(3)} · 최대 ${ratios[ratios.length - 1].toFixed(3)}`);
    if (fence && !fence.insufficient) {
      L.push(`- Q1 ${fence.q1} · 중앙값 ${fence.median} · Q3 ${fence.q3} · IQR ${fence.iqr}`);
      L.push(`- Tukey 펜스 [${fence.lower}, ${fence.upper}] → 이 범위 밖이 area_mismatch`);
    }
  } else {
    L.push('- (1:1 매칭 표본 없음)');
  }
  L.push('');

  // ── 8. 우선순위 점수 (priorityConfig 가 있을 때만) ──
  if (priorityConfig) {
    L.push('## 8. 우선순위 점수 (Priority Score)');
    L.push('');
    L.push(`- 공식 ID: \`${priorityConfig.formula_id}\``);
    var w = priorityConfig.weights || {};
    L.push(`- 가중치: age ${w.age} · area ${w.area} · use ${w.use} (합 ${w.age + w.area + w.use})`);
    L.push(`- 모집단: ${targets.length}동 (is_target=true)`);
    L.push('- 설정 파일: `config/priority_score.json` (version ' + priorityConfig.version + ')');
    L.push('');

    // 4,309동에 점수 계산
    var pTargets = targets.map((r) => ({
      r,
      pr: computePriority(recordToScoringInput(r), priorityConfig),
    }));
    var withScore = pTargets.filter((x) => x.pr.score !== null);
    var nullScore = pTargets.length - withScore.length;

    // 통계
    var scores = withScore.map((x) => x.pr.score);
    var sorted = scores.slice().sort((a, b) => a - b);
    var n = sorted.length;
    var mean = scores.reduce((s, v) => s + v, 0) / n;
    var median = sorted[Math.floor(n / 2)];
    var q1 = sorted[Math.floor(n * 0.25)];
    var q3 = sorted[Math.floor(n * 0.75)];
    var std = Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / n);

    L.push('### 통계');
    L.push('');
    L.push('| 항목 | 값 |');
    L.push('|------|------|');
    L.push(`| 표본(n) | ${n} |`);
    L.push(`| 최소 / 최대 | ${sorted[0]} / ${sorted[n - 1]} |`);
    L.push(`| 평균 | ${mean.toFixed(2)} |`);
    L.push(`| 중간값 | ${median} |`);
    L.push(`| Q1 / Q3 | ${q1} / ${q3} |`);
    L.push(`| 표준편차 | ${std.toFixed(2)} |`);
    L.push(`| 점수=null (대상 자격 박탈) | ${nullScore} |`);
    L.push('');

    // 분포
    var bins = { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0 };
    scores.forEach((s) => {
      if (s < 20) bins['0-20']++;
      else if (s < 40) bins['20-40']++;
      else if (s < 60) bins['40-60']++;
      else if (s < 80) bins['60-80']++;
      else bins['80-100']++;
    });

    L.push('### 분포 히스토그램');
    L.push('');
    L.push('| 구간 | 건수 | 비율 | |');
    L.push('|------|------|------|---|');
    for (var [k, v] of Object.entries(bins)) {
      var bar = '█'.repeat(Math.round(v / Math.max(1, n) * 30));
      L.push(`| ${k} | ${v} | ${pct(v, n)} | ${bar} |`);
    }
    L.push('');

    // use 매칭 통계
    var matched_n = withScore.filter((x) => x.pr.useMatched === true).length;
    var defaulted = withScore.filter((x) => x.pr.useMatched === false).length;

    L.push('### use_score 매칭');
    L.push('');
    L.push('| 항목 | 건수 | 비율 |');
    L.push('|------|------|------|');
    L.push(`| 정확 매칭 | ${matched_n} | ${pct(matched_n, n)} |`);
    L.push(`| _default 폴백 | ${defaulted} | ${pct(defaulted, n)} |`);
    L.push('');

    if (defaulted > 0) {
      var defaultedUses = {};
      withScore.filter((x) => x.pr.useMatched === false).forEach((x) => {
        var u = x.r.main_use || '(null)';
        defaultedUses[u] = (defaultedUses[u] || 0) + 1;
      });
      L.push('**_default 폴백된 주용도** (config 보강 후보):');
      L.push('');
      L.push('| 주용도 | 건수 |');
      L.push('|--------|------|');
      Object.entries(defaultedUses).sort((a, b) => b[1] - a[1]).forEach(([u, c]) => {
        L.push(`| ${u} | ${c} |`);
      });
      L.push('');
    }

    // Top 5 (raw 폴리곤 기준 — 같은 표제부 중복 가능)
    var top = withScore.slice().sort((a, b) => b.pr.score - a.pr.score).slice(0, 5);
    L.push('### Top 5 미리보기 (raw 폴리곤 기준 · dedup 없음)');
    L.push('');
    L.push('| 순위 | 건물명 | 사용승인 | 경과 | 연면적 | 주용도 | 점수 | components(age/area/use) |');
    L.push('|------|--------|----------|------|--------|--------|------|--------------------------|');
    top.forEach((x, i) => {
      var r = x.r;
      var name = r.name_shp || r.anno_shp || r.bld_nm || '(이름없음)';
      var gfa = r.gross_floor_area != null ? Math.round(r.gross_floor_area).toLocaleString() + '㎡' : '—';
      var c = x.pr.components || {};
      L.push(`| ${i + 1} | ${name} | ${r.approval_year || '—'} | ${r.building_age ?? '—'}년 | ${gfa} | ${r.main_use || '—'} | ${x.pr.score.toFixed(1)} | ${c.age}/${c.area}/${c.use} |`);
    });
    L.push('');
    L.push('> N:1·N:M 카디널리티로 같은 `match_key` 폴리곤이 중복 등장할 수 있다. 페이지 레이어에서 `match_key` 기준 dedup 적용 (≈ 2,196 건물 그룹).');
    L.push('');
  }

  L.push('---');
  L.push('_자동 생성: scripts/build/quality/report_generator.mjs_');
  return L.join('\n');
}
