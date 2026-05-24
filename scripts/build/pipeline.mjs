/**
 * scripts/build/pipeline.mjs
 * 수원시 팔달구 그린리모델링 데이터 파이프라인 — 전체 흐름 오케스트레이션.
 *
 * 흐름: Bronze(SHP + 표제부 일괄 다운로드)
 *     → Silver(도로명 매칭 → 통합 → 검증 → 스냅샷 → 품질 리포트)
 *     → Gold(GeoJSON)
 *
 * 실행:
 *   node --env-file=.env scripts/build/pipeline.mjs                   # 팔달구 전체 (현재 월)
 *   node --env-file=.env scripts/build/pipeline.mjs --trial=13800     # 우만동 시범 빌드
 *   node --env-file=.env scripts/build/pipeline.mjs --month=2026_05   # 스냅샷 월 지정
 *   옵션: --no-cache            기존 표제부 캐시 무시하고 전량 재수신 (디버깅용)
 *         --include-non-target  매칭-기준미달 건물도 GeoJSON 에 포함
 *
 * 임계값: config/target_criteria.json (단일 출처)
 * 기준 문서: docs/data_engineering_plan.md · docs/schema_v1.md
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, relative } from 'node:path';
import { open } from 'shapefile';

import { detectEpsg } from './transforms/reproject.mjs';
import { fetchDongTitles } from './fetchers/buildingHub.mjs';
import { buildTitleIndex, runMatching } from './transforms/match_engine.mjs';
import { buildSilverRecords } from './transforms/attribute_join.mjs';
import { validateRecord, computeOutlierFence } from './quality/validators.mjs';
import { generateQualityReport } from './quality/report_generator.mjs';
import { emitGeoJSON } from './emit/geojson.mjs';
import { computeSummary, formatSummary } from './emit/summary_stats.mjs';
import { loadConfig as loadPriorityConfig } from '../scoring/computePriority.mjs';

// ── 경로 ─────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const BUILD = join(PROJECT_ROOT, 'build');

// ── 운영 상수 (도메인 임계값이 아닌 운영 파라미터 — 단일 가시 위치) ──────────
const SIGUNGU_CD = '41115';                          // 수원시 팔달구
const BUILDING_LAYER_RE = /^N3A_B0010000.*\.shp$/i;  // 연속수치지도 건물(면) 레이어
const NUM_OF_ROWS = 100;                             // 표제부 페이지 크기 (API 가 100 으로 제한)
const API_DELAY_MS = 100;                            // 페이지 요청 간 간격
const MAX_RETRY = 3;                                 // 페이지 재시도 횟수
const MAX_FAILED_DONG_RATIO = 0.5;                   // 법정동 실패율 ≥ 이 값 → 전체 중단
// ※ 그린리모델링 대상·품질 임계값(15년·500㎡·5% 등)은 config/target_criteria.json 참조.

// ── 유틸 ────────────────────────────────────────────────────────────────
const log = (...a) => console.log(...a);
const rel = (p) => relative(PROJECT_ROOT, p).replace(/\\/g, '/');
const show = (v) => { const s = v == null ? '' : String(v).trim(); return s.length ? s : '∅'; };

function eachCoord(geom, cb) {
  const walk = (a) => {
    if (typeof a[0] === 'number') { cb(a[0], a[1]); return; }
    for (const x of a) walk(x);
  };
  if (geom && geom.coordinates) walk(geom.coordinates);
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split('=')[1] : null;
  };
  const now = new Date();
  const defMonth = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
  return {
    month: get('month') || defMonth,
    trialDong: get('trial') || null,
    includeNonTarget: argv.includes('--include-non-target'),
    noCache: argv.includes('--no-cache') || argv.includes('--force-refresh'),
  };
}

function paths(month) {
  return {
    shpDir: join(BUILD, 'bronze', 'raw', 'shp', month),
    cacheDir: join(BUILD, 'bronze', 'api_cache', month),       // 법정동별 파일 디렉토리
    errorDir: join(BUILD, 'bronze', 'api_errors', month),
    masterDir: join(BUILD, 'bronze', 'master'),
    snapshotFile: join(BUILD, 'silver', 'snapshots', `${month}.json`),
    reportFile: join(BUILD, 'silver', 'quality_reports', `${month}.md`),
    goldGeojson: join(BUILD, 'gold', 'geojson', `paldal_${month}.geojson`),
    goldCurrent: join(BUILD, 'gold', 'geojson', 'paldal_current.geojson'),
    goldCurrentJs: join(BUILD, 'gold', 'geojson', 'paldal_current.js'),
  };
}

async function ensureDirs(P) {
  for (const d of [
    P.cacheDir, P.errorDir, P.masterDir,
    dirname(P.snapshotFile), dirname(P.reportFile), dirname(P.goldGeojson),
  ]) {
    await mkdir(d, { recursive: true });
  }
}

/** --env-file 미사용 시 .env 직접 로드 폴백 */
async function loadEnvFallback() {
  if (process.env.DATA_GO_KR_KEY) return;
  const envPath = join(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of (await readFile(envPath, 'utf-8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

/** 임계값 단일 출처 — config/target_criteria.json 로드 */
async function loadCriteria(baseYear) {
  const f = join(PROJECT_ROOT, 'config', 'target_criteria.json');
  if (!existsSync(f)) throw new Error(`설정 파일이 없습니다: ${rel(f)}`);
  const cfg = JSON.parse(await readFile(f, 'utf-8'));
  const ts = cfg.target_selection || {};
  const qt = cfg.quality_thresholds || {};
  const out = {
    minAgeYears: ts.min_age_years,
    minGrossFloorArea: ts.min_gross_floor_area_m2,
    baseYear,
    outlierMethod: qt.outlier_method,
    outlierIqrMultiplier: qt.outlier_iqr_multiplier,
    polygonMinAreaM2: qt.polygon_min_area_m2,
  };
  for (const k of ['minAgeYears', 'minGrossFloorArea', 'outlierIqrMultiplier', 'polygonMinAreaM2']) {
    if (typeof out[k] !== 'number') {
      throw new Error(`config/target_criteria.json: '${k}' 값이 없거나 숫자가 아닙니다.`);
    }
  }
  if (typeof out.outlierMethod !== 'string') {
    throw new Error("config/target_criteria.json: 'outlier_method' 값이 없습니다.");
  }
  return out;
}

// ── 안전장치 D: 법정동 단위 캐시 / 에러 격리 ─────────────────────────────
/** api_cache/<월>/<법정동>.json 로드. 에러 캐시·손상 파일은 무시(null) → 재시도 */
async function loadDongCache(cacheDir, dong) {
  const f = join(cacheDir, `${dong}.json`);
  if (!existsSync(f)) return null;
  try {
    const data = JSON.parse(await readFile(f, 'utf-8'));
    if (!data || data.__error || !Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}
async function saveDongCache(cacheDir, dong, data) {
  await writeFile(join(cacheDir, `${dong}.json`), JSON.stringify(data), 'utf-8');
}
async function saveErrors(dir, errors) {
  // 항상 기록 — 빈 배열도 써서 errors.json 이 직전 실패 잔재가 아닌 이번 런을 반영하게 함
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'errors.json'), JSON.stringify(errors, null, 2), 'utf-8');
}

// ── Bronze: 건물 레이어 로드 ─────────────────────────────────────────────
async function readBuildingLayer(shpDir, trialDong) {
  if (!existsSync(shpDir)) {
    throw new Error(`SHP 디렉토리가 없습니다: ${rel(shpDir)}\n`
      + '  연속수치지도 건물 레이어를 해당 월 디렉토리에 배치하세요.');
  }
  const shpFiles = [];
  for (const e of await readdir(shpDir, { withFileTypes: true })) {
    if (e.isFile() && BUILDING_LAYER_RE.test(e.name)) {
      shpFiles.push(join(shpDir, e.name));
    } else if (e.isDirectory()) {
      for (const n of await readdir(join(shpDir, e.name))) {
        if (BUILDING_LAYER_RE.test(n)) shpFiles.push(join(shpDir, e.name, n));
      }
    }
  }
  if (!shpFiles.length) {
    throw new Error(`건물 레이어(N3A_B0010000*.shp)를 찾지 못했습니다: ${rel(shpDir)}`);
  }

  const buildings = [];
  const dongSet = new Set();
  for (const shpPath of shpFiles) {
    const dbfPath = shpPath.replace(/\.shp$/i, '.dbf');
    const prjPath = shpPath.replace(/\.shp$/i, '.prj');
    const cpgPath = shpPath.replace(/\.shp$/i, '.cpg');

    let encoding = 'euc-kr';                          // 연속수치지도는 .cpg 없음
    if (existsSync(cpgPath)) {
      const cpg = (await readFile(cpgPath, 'utf-8')).trim().toLowerCase();
      if (cpg.includes('utf')) encoding = 'utf-8';
    }
    let srcCode = process.env.SHP_EPSG || null;
    if (!srcCode && existsSync(prjPath)) srcCode = detectEpsg(await readFile(prjPath, 'utf-8'));
    srcCode = srcCode || 'EPSG:5179';

    const source = await open(shpPath, dbfPath, { encoding });
    let rec;
    while (!(rec = await source.read()).done) {
      const f = rec.value;
      if (!f || !f.geometry) continue;
      const props = f.properties || {};
      const bjcd = String(props.BJCD ?? '');
      if (bjcd.slice(0, 5) !== SIGUNGU_CD) continue;               // 팔달구만
      const dong = bjcd.slice(5, 10);
      if (trialDong && dong !== trialDong) continue;               // 시범 빌드 범위
      dongSet.add(dong);
      buildings.push({ props, geometry: f.geometry, srcCode, dong });
    }
  }
  return {
    buildings,
    dongs: [...dongSet].sort(),
    srcInfo: shpFiles.map((p) => basename(p)).join(', '),
  };
}

// ── Bronze: 코드 마스터 부수 산출 ────────────────────────────────────────
async function writeMasters(dir, month, titles) {
  const mainPurpose = {};
  const structure = {};
  for (const t of titles) {
    const pc = String(t.mainPurpsCd ?? '').trim();
    const pn = String(t.mainPurpsCdNm ?? '').trim();
    if (pc && pn) mainPurpose[pc] = pn;
    const sc = String(t.strctCd ?? '').trim();
    const sn = String(t.strctCdNm ?? '').trim();
    if (sc && sn) structure[sc] = sn;
  }
  const master = {
    snapshot_month: month,
    generated: new Date().toISOString(),
    note: '표제부 응답에서 발견된 코드. 법정동·도로명 마스터는 Phase 3 확장 예정.',
    main_purpose: mainPurpose,
    structure,
  };
  await writeFile(join(dir, `codes_${month}.json`), JSON.stringify(master, null, 2), 'utf-8');
}

function countsOf(records) {
  const c = { total: records.length, matched: 0, no_road_address: 0, road_no_match: 0, target: 0 };
  for (const r of records) {
    if (r.match_status in c) c[r.match_status]++;
    if (r.is_target) c.target++;
  }
  return c;
}

// ── 시범 빌드 진단 (STEP D) ──────────────────────────────────────────────
function reportTrial({ buildings, matchResults, records, fc, fence, dong, reportFile }) {
  log(`\n════════ 시범 빌드 진단 — 법정동 ${dong} ════════`);
  const withRoad = matchResults.filter((m) => m.road_key).length;
  const matched = matchResults.filter((m) => m.match_status === 'matched');
  const noRoad = matchResults.filter((m) => m.match_status === 'no_road_address');
  const roadNoMatch = matchResults.filter((m) => m.match_status === 'road_no_match');
  log(`건물 수      : ${buildings.length}`);
  log(`도로명 보유  : ${withRoad}`);
  log(`매칭 성공    : ${matched.length}`);
  log(`매칭 실패    : ${noRoad.length + roadNoMatch.length} `
    + `(도로명없음 ${noRoad.length} / 도로명매칭실패 ${roadNoMatch.length})`);

  log('\n── 매칭 성공 5건 ──');
  let shown = 0;
  for (let i = 0; i < buildings.length && shown < 5; i++) {
    const m = matchResults[i];
    if (m.match_status !== 'matched') continue;
    const p = buildings[i].props;
    const t = m.title;
    log(`  BJCD=${p.BJCD} RDNM=${p.RDNM} BONU=${p.BONU} BUNU=${p.BUNU}  카디널리티=${m.match_cardinality}`);
    log(`    → useAprDay=${show(t.useAprDay)} · totArea=${show(t.totArea)} · mainPurpsCdNm=${show(t.mainPurpsCdNm)}`);
    shown++;
  }
  if (!shown) log('  (매칭 성공 사례 없음)');

  log('\n── 매칭 실패 5건 (이유 구분) ──');
  const rnm = [], nra = [];
  for (let i = 0; i < buildings.length; i++) {
    const m = matchResults[i];
    if (m.match_status === 'road_no_match') rnm.push(buildings[i].props);
    else if (m.match_status === 'no_road_address') nra.push(buildings[i].props);
  }
  const pick = [];
  for (let a = 0, b = 0; pick.length < 5 && (a < rnm.length || b < nra.length);) {
    if (a < rnm.length) pick.push(['road_no_match', rnm[a++]]);
    if (pick.length < 5 && b < nra.length) pick.push(['no_road_address', nra[b++]]);
  }
  for (const [reason, p] of pick) {
    log(`  [${reason}] BJCD=${p.BJCD} RDNM="${show(p.RDNM)}" BONU=${p.BONU} BUNU=${p.BUNU}`);
  }
  if (!pick.length) log('  (매칭 실패 사례 없음)');

  // STEP D 추가 분석
  const mr = records.filter((r) => r.match_status === 'matched');
  const card = { '1:1': 0, '1:N': 0, 'N:1': 0, 'N:M': 0 };
  for (const r of mr) if (r.match_cardinality in card) card[r.match_cardinality]++;
  const cp = (n) => (mr.length ? (n / mr.length * 100).toFixed(1) : '0.0') + '%';
  log('\n── 매칭 카디널리티 분포 (매칭 건물 기준) ──');
  for (const k of ['1:1', '1:N', 'N:1', 'N:M']) log(`  ${k} : ${card[k]}  (${cp(card[k])})`);

  const flagCount = {};
  for (const r of records) for (const f of r.quality_flags) flagCount[f] = (flagCount[f] || 0) + 1;
  const mismatchN = flagCount['area_mismatch'] || 0;
  log('\n── D4 이상치 (Tukey IQR, 1:1 매칭 한정) ──');
  if (fence.insufficient) {
    log('  표본 부족 — 펜스 산출 생략');
  } else {
    log(`  펜스: Q1 ${fence.q1} · 중앙값 ${fence.median} · Q3 ${fence.q3} · IQR ${fence.iqr} → [${fence.lower}, ${fence.upper}]`);
    log(`  area_mismatch ${mismatchN} / 1:1 ${card['1:1']}건 = `
      + `${card['1:1'] ? (mismatchN / card['1:1'] * 100).toFixed(1) : '0.0'}%`);
  }

  const ratios = records.filter((r) => r.polygon_arch_ratio != null)
    .map((r) => r.polygon_arch_ratio).sort((a, b) => a - b);
  log('\n── polygon_arch_ratio 분포 (1:1 매칭 한정) ──');
  if (ratios.length) {
    const q = (p) => ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))];
    log(`  표본 ${ratios.length}건 · 중앙값 ${q(0.5).toFixed(3)} · `
      + `사분위 ${q(0.25).toFixed(3)}~${q(0.75).toFixed(3)} · 최소 ${ratios[0].toFixed(3)} 최대 ${ratios[ratios.length - 1].toFixed(3)}`);
  } else {
    log('  (1:1 매칭 표본 없음)');
  }

  log('\n── quality_flags 빈도 ──');
  const flagEntries = Object.entries(flagCount).sort((a, b) => b[1] - a[1]);
  if (flagEntries.length) for (const [f, n] of flagEntries) log(`  ${f} : ${n}`);
  else log('  (플래그 없음)');

  log('\n── 생성된 GeoJSON (우만동) ──');
  log(`피처 수      : ${fc.features.length}  ${JSON.stringify(fc.meta.breakdown)}`);
  if (fc.features.length) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const f of fc.features) {
      eachCoord(f.geometry, (lng, lat) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      });
    }
    log(`좌표 범위    : 경도 ${minLng.toFixed(6)} ~ ${maxLng.toFixed(6)}`);
    log(`               위도 ${minLat.toFixed(6)} ~ ${maxLat.toFixed(6)}`);
  }
  log(`\n품질 리포트  : ${rel(reportFile)}`);
  log('시범 빌드 완료. 품질 리포트를 검토 후 전체 빌드 진행 여부를 결정하세요.');
}

// ── 메인 ────────────────────────────────────────────────────────────────
async function main() {
  await loadEnvFallback();
  const { month, trialDong, includeNonTarget, noCache } = parseArgs();
  const baseYear = parseInt(month.slice(0, 4), 10);
  const cfg = await loadCriteria(baseYear);                       // Q2: 임계값 단일 출처
  const criteria = {
    minAgeYears: cfg.minAgeYears, minGrossFloorArea: cfg.minGrossFloorArea, baseYear,
  };

  // 우선순위 점수 설정 — main 초반에 로드 (report_generator + emit 모두에서 사용)
  const priorityConfigPath = join(PROJECT_ROOT, 'config', 'priority_score.json');
  let priorityConfig = null;
  if (existsSync(priorityConfigPath)) {
    priorityConfig = await loadPriorityConfig(priorityConfigPath);
  }

  log(`▶ 팔달구 그린리모델링 파이프라인 — ${month}`
    + `${trialDong ? ` · 시범 빌드(법정동 ${trialDong})` : ' · 전체'}`);
  log(`  기준: 준공 ${criteria.minAgeYears}년+ · 연면적 ${criteria.minGrossFloorArea}㎡+ · `
    + `이상치 ${cfg.outlierMethod}  (config/target_criteria.json)\n`);

  const apiKey = process.env.DATA_GO_KR_KEY;
  if (!apiKey) {
    console.error('✖ DATA_GO_KR_KEY 가 없습니다. .env 를 확인하세요.');
    process.exit(1);
  }
  const endpoint = process.env.DATA_GO_KR_ENDPOINT || undefined;

  const P = paths(month);
  await ensureDirs(P);

  // ── BRONZE 1: 연속수치지도 건물 레이어 ──
  log('· [Bronze] 연속수치지도 건물 레이어 로드');
  const { buildings, dongs, srcInfo } = await readBuildingLayer(P.shpDir, trialDong);
  log(`  건물 ${buildings.length}동 · 법정동 ${dongs.length}개 · ${srcInfo}\n`);
  if (!buildings.length) {
    console.error(`✖ 처리할 건물이 없습니다.${trialDong ? ` (법정동 ${trialDong} 없음)` : ''}`);
    process.exit(1);
  }

  // ── BRONZE 2: 건축물대장 표제부 일괄 다운로드 (법정동 단위 캐시 / 부분실패 허용) ──
  log('· [Bronze] 건축물대장 표제부 일괄 다운로드 (법정동 단위)');
  if (noCache) log('  (--no-cache: 기존 캐시 무시, 전량 재수신)');
  const errors = [];
  const fetchStats = [];
  const allTitles = [];
  const failedDongs = [];
  for (const dong of dongs) {
    let dc = noCache ? null : await loadDongCache(P.cacheDir, dong);
    const fromCache = !!dc;
    if (!dc) {
      try {
        const r = await fetchDongTitles({
          endpoint, serviceKey: apiKey, sigunguCd: SIGUNGU_CD, bjdongCd: dong,
          errors, numOfRows: NUM_OF_ROWS, delayMs: API_DELAY_MS, maxRetry: MAX_RETRY,
        });
        if (!r.ok) {                                           // 안전장치 C: 페이지네이션 불일치
          errors.push({
            when: new Date().toISOString(), bjdongCd: dong,
            kind: 'count_mismatch', totalCount: r.totalCount, received: r.received,
          });
          failedDongs.push(dong);
          fetchStats.push({ dong, ok: false, reason: 'count_mismatch', totalCount: r.totalCount, received: r.received });
          log(`  ${dong}: total=${r.totalCount} 수신=${r.received} [불일치 → 동 스킵]`);
          continue;
        }
        dc = {
          dong, fetched_at: new Date().toISOString(),
          totalCount: r.totalCount, received: r.received, items: r.items,
        };
        await saveDongCache(P.cacheDir, dong, dc);             // 정상 응답만 캐시
      } catch (e) {                                            // 안전장치 D: 수신 실패 → 동 스킵
        failedDongs.push(dong);
        fetchStats.push({ dong, ok: false, reason: 'fetch_error' });
        log(`  ${dong}: API 실패 → 동 스킵 (${e.message})`);
        continue;
      }
    }
    fetchStats.push({ dong, ok: true, totalCount: dc.totalCount, received: dc.received, fromCache });
    allTitles.push(...dc.items);
    log(`  ${dong}: total=${dc.totalCount} 수신=${dc.received} [OK·${fromCache ? '캐시' : '신규'}]`);
  }
  await saveErrors(P.errorDir, errors);

  // 부분 실패 정책 (Q5): 과반 실패 → 시스템적 문제로 보고 전체 중단, 그 이하면 계속
  if (dongs.length && failedDongs.length / dongs.length >= MAX_FAILED_DONG_RATIO) {
    console.error(`\n✖ 법정동 ${failedDongs.length}/${dongs.length} 실패 `
      + `(${(failedDongs.length / dongs.length * 100).toFixed(0)}% ≥ ${MAX_FAILED_DONG_RATIO * 100}%) `
      + '— 시스템적 문제로 판단해 빌드를 중단합니다.');
    console.error(`  ${rel(P.errorDir)}/errors.json 확인.`);
    process.exit(1);
  }
  if (failedDongs.length) {
    log(`  ⚠ ${failedDongs.length}개 법정동 수신 실패 [${failedDongs.join(', ')}] `
      + '→ 해당 동 건물은 매칭 불가 처리, 빌드 계속');
  }
  log(`  표제부 ${allTitles.length}건 수신 (성공 ${dongs.length - failedDongs.length}/${dongs.length} 동)\n`);

  // ── BRONZE 3: 코드 마스터 부수 산출 ──
  await writeMasters(P.masterDir, month, allTitles);

  // ── SILVER: 매칭 → 통합 → 검증 ──
  log('· [Silver] 도로명 매칭 → 통합 → 검증');
  const titleIndex = buildTitleIndex(allTitles);
  const matchResults = runMatching(buildings, titleIndex, SIGUNGU_CD);
  const records = buildSilverRecords(buildings, matchResults, {
    snapshotMonth: month, baseYear,
    minAge: criteria.minAgeYears, minGfa: criteria.minGrossFloorArea,
  });
  // D4: Tukey IQR 이상치 펜스 — 1:1 매칭 polygon_arch_ratio 분포에서 산출
  const fence = computeOutlierFence(records, cfg.outlierMethod, cfg.outlierIqrMultiplier);
  log(`  이상치 펜스(${fence.method}): `
    + (fence.insufficient
      ? '표본 부족 — area_mismatch 판정 생략'
      : `Q1 ${fence.q1} · Q3 ${fence.q3} · IQR ${fence.iqr} → [${fence.lower}, ${fence.upper}] (표본 ${fence.sampleSize})`));
  const failedSet = new Set(failedDongs);
  for (const r of records) {
    r.quality_flags = validateRecord(r, { polygonMinAreaM2: cfg.polygonMinAreaM2 }, fence);
    if (failedSet.has(r.bjdong_cd)) r.quality_flags.push('dong_fetch_failed');   // Q5
  }

  const snapshot = {
    meta: {
      schema: 'v1', snapshot_month: month, generated: new Date().toISOString(),
      area: '수원시 팔달구', sigungu_cd: SIGUNGU_CD, criteria,
      source: { shp: srcInfo, titles_received: allTitles.length, failed_dongs: failedDongs },
      outlier_fence: fence,
      counts: countsOf(records),
    },
    records,
  };
  await writeFile(P.snapshotFile, JSON.stringify(snapshot), 'utf-8');
  log(`  스냅샷       : ${rel(P.snapshotFile)}  (${records.length} 레코드)`);

  const reportMd = generateQualityReport({
    records, fetchStats, snapshotMonth: month, trialDong, criteria, fence, sourceInfo: srcInfo,
    priorityConfig,
  });
  await writeFile(P.reportFile, reportMd, 'utf-8');
  log(`  품질 리포트  : ${rel(P.reportFile)}`
    + (priorityConfig ? ' (§8 priority 포함)' : '') + '\n');

  if (priorityConfig) {
    log(`  우선순위 점수 : formula=${priorityConfig.formula_id} · weights age/area/use=${priorityConfig.weights.age}/${priorityConfig.weights.area}/${priorityConfig.weights.use}`);
  } else {
    log('  (priority_score.json 없음 — 우선순위 점수 주입 생략)');
  }

  // ── GOLD: GeoJSON ──
  log('\n· [Gold] GeoJSON 산출');
  const fc = emitGeoJSON({
    records, snapshotMonth: month, sigunguCd: SIGUNGU_CD, criteria, fence,
    includeNonTarget, trialDong, priorityConfig,
  });
  const fcJson = JSON.stringify(fc);
  await writeFile(P.goldGeojson, fcJson, 'utf-8');
  log(`  ${rel(P.goldGeojson)}  (${fc.features.length} 피처)`);
  if (fc.meta.priority_score_stats) {
    const s = fc.meta.priority_score_stats;
    log(`  점수 분포    : n=${s.n} · min=${s.min} max=${s.max} mean=${s.mean} median=${s.median} Q1=${s.q1} Q3=${s.q3} std=${s.std}`);
    log(`               use 매칭률 ${(fc.meta.priority_use_match_rate * 100).toFixed(1)}%`);
  }
  if (!trialDong) {                                       // 시범 빌드는 최신 포인터를 갱신하지 않음
    await writeFile(P.goldCurrent, fcJson, 'utf-8');       // 최신 포인터 (copy)
    await writeFile(P.goldCurrentJs, `window.GREEN_TARGETS = ${fcJson};\n`, 'utf-8');
    log(`  ${rel(P.goldCurrent)}  (최신 포인터)`);
    log(`  ${rel(P.goldCurrentJs)}  (페이지 로드용)`);
  } else {
    log('  (시범 빌드 — paldal_current 는 갱신하지 않음)');
  }
  log('');

  // ── 요약 ──
  log(formatSummary(computeSummary(records, fetchStats)));
  if (errors.length) log(`  ⚠ API 오류 ${errors.length}건 격리 → ${rel(P.errorDir)}/errors.json`);

  if (trialDong) reportTrial({ buildings, matchResults, records, fc, fence, dong: trialDong, reportFile: P.reportFile });
  else log('\n빌드 완료.');
}

main().catch((e) => {
  console.error('\n✖ 빌드 실패:', e);
  process.exit(1);
});
