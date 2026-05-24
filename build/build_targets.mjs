/**
 * build_targets.mjs  —  v1 (rollback 전용, 비활성)
 *
 * 수원시 팔달구 그린리모델링 대상 건축물 데이터 파이프라인 (구버전).
 *
 * ⚠ 이 스크립트는 v2 pipeline 도입(2026-05-22) 이전의 단일 파일 파이프라인이며
 *   **rollback 목적으로만 유지**한다. 현재 정식 빌드는 `scripts/build/pipeline.mjs`
 *   (`npm run pipeline`) 이다.
 * ⚠ STEP 4-C(2026-05-23) 우선순위 점수 주입은 **v1 에는 적용되지 않는다**.
 *   v1 산출물은 priority_score / priority_components 필드를 갖지 않음.
 *
 * 입력
 *   - build/raw/*.shp  : GIS건물통합정보 SHP (국가공간정보포털 nsdi.go.kr)
 *   - .env             : DATA_GO_KR_KEY (건축HUB 건축물대장 API 키)
 * 출력
 *   - data/paldal_green_targets.geojson
 *   - data/paldal_green_targets.js   (window.GREEN_TARGETS = {...})
 *
 * 실행 (rollback 시에만)
 *   node --env-file=.env build/build_targets.mjs
 *   (또는 `npm run build`)
 *
 * 대상 기준: 준공 15년 경과 AND 연면적 500㎡ 이상 (수원시 팔달구 41115)
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import proj4 from 'proj4';
import { open } from 'shapefile';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_DIR = __dirname + '/raw';
const DATA_DIR = join(ROOT, 'data');
const CACHE_PATH = join(__dirname, '.api_cache.json');

// ── 설정 ────────────────────────────────────────────────────────────────
const SIGUNGU_CD = '41115';                 // 수원시 팔달구
const MIN_AGE_YEARS = 15;                   // 준공 경과연수 기준
const MIN_GFA = 500;                        // 연면적(㎡) 기준
const CURRENT_YEAR = new Date().getFullYear();
const API_DELAY_MS = 120;                   // 미캐시 API 호출 간 간격

// ── 좌표계 정의 (GIS건물통합정보는 대개 EPSG:5174) ───────────────────────
const PROJ_DEFS = {
  'EPSG:5174': '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.8,474.99,674.11,1.16,-2.31,-1.63,6.43',
  'EPSG:5186': '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5185': '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5187': '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5179': '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs',
};
for (const [code, def] of Object.entries(PROJ_DEFS)) proj4.defs(code, def);

// ── 후보 필드명 (데이터 버전마다 다를 수 있어 배열로 탐색) ────────────────
const FIELD = {
  pnu:      ['PNU', 'pnu', 'BULD_PNU', 'BLD_PNU', 'LDCODE_PNU'],
  bldgName: ['BULD_NM', 'BLDG_NM', 'BLD_NM', 'bldNm', 'BD_NM'],
  useAprDay:['USEAPR_DAY', 'USE_APR_DAY', 'USEAPRDAY', 'USEAPR_YMD', 'USE_DAY', 'useAprDay', 'USEAPR_YMDA'],
  gfa:      ['TOTAR', 'GRND_TOTAR', 'TTAR', 'TToAR', 'totArea', 'BULD_TOTAR', 'AR_TOT'],
  floorsUp: ['GRND_FLR_CO', 'GRND_FLR', 'groundFloorCo', 'GROUND_FLR'],
  floorsDn: ['UGRND_FLR_CO', 'UGRND_FLR', 'undgrndFloorCo'],
  address:  ['LNM_ADDR', 'LDONG_ADDR', 'ADDR', 'RDNMADR', 'RN_ADRES', 'BULD_ADDR'],
};

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('  ⚠ ', ...a);

/** props 객체에서 후보 키 중 처음 발견된 값을 반환 */
function pick(props, candidates) {
  for (const k of candidates) {
    if (props[k] !== undefined && props[k] !== null && props[k] !== '') return props[k];
  }
  return null;
}

/** .env 파일에서 키를 직접 읽는 폴백 (--env-file 미사용 시 대비) */
async function loadEnvFallback() {
  if (process.env.DATA_GO_KR_KEY) return;
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const text = await readFile(envPath, 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

/** .prj WKT 문자열로 좌표계를 추정 */
function detectEpsg(prjText) {
  if (!prjText) return null;
  const t = prjText.toLowerCase();
  if (/bessel/.test(t)) return 'EPSG:5174';
  const cm = parseFloat((prjText.match(/central_meridian["',\s]+(-?\d+\.?\d*)/i) || [])[1]);
  const fn = parseFloat((prjText.match(/false_northing["',\s]+(-?\d+\.?\d*)/i) || [])[1]);
  if (cm >= 127.4 && cm <= 127.6) return 'EPSG:5179';
  if (Math.round(cm) === 127) return 'EPSG:5186';
  if (Math.round(cm) === 125) return 'EPSG:5185';
  if (Math.round(cm) === 129) return 'EPSG:5187';
  if (fn === 500000) return 'EPSG:5174';
  return null;
}

/** 사용승인일(YYYYMMDD 등 다양한 포맷)에서 연도 추출 */
function parseApprovalYear(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[^0-9]/g, '');
  if (s.length < 4) return null;
  const y = parseInt(s.slice(0, 4), 10);
  if (y >= 1900 && y <= CURRENT_YEAR) return y;
  return null;
}

/** Polygon/MultiPolygon 좌표를 WGS84로 재투영 */
function reproject(geometry, srcCode) {
  const tx = (c) => {
    const [lng, lat] = proj4(srcCode, 'WGS84', [c[0], c[1]]);
    return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
  };
  const mapRing = (ring) => ring.map(tx);
  const mapPoly = (poly) => poly.map(mapRing);
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(mapRing) };
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(mapPoly) };
  }
  return null;
}

/** PNU(19자리)를 건축물대장 API 파라미터로 분해 */
function pnuToParcel(pnu) {
  const s = String(pnu).replace(/[^0-9]/g, '');
  if (s.length < 19) return null;
  return {
    sigunguCd: s.slice(0, 5),
    bjdongCd: s.slice(5, 10),
    platGbCd: s[10] === '2' ? '1' : '0',   // 1=산 → platGbCd 1, 그 외 0
    bun: s.slice(11, 15),
    ji: s.slice(15, 19),
  };
}

// ── 건축물대장 API 보강 ──────────────────────────────────────────────────
let apiCache = {};
async function loadCache() {
  if (existsSync(CACHE_PATH)) {
    try { apiCache = JSON.parse(await readFile(CACHE_PATH, 'utf-8')); } catch { apiCache = {}; }
  }
}
async function saveCache() {
  await writeFile(CACHE_PATH, JSON.stringify(apiCache), 'utf-8');
}

/** 한 필지의 표제부를 조회해 대표(주건축물·최대 연면적) 1건을 반환 */
async function fetchTitleInfo(parcel) {
  const key = `${parcel.sigunguCd}-${parcel.bjdongCd}-${parcel.platGbCd}-${parcel.bun}-${parcel.ji}`;
  if (key in apiCache) return apiCache[key];

  const endpoint = process.env.DATA_GO_KR_ENDPOINT
    || 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
  const params = new URLSearchParams({
    serviceKey: process.env.DATA_GO_KR_KEY,
    sigunguCd: parcel.sigunguCd, bjdongCd: parcel.bjdongCd,
    platGbCd: parcel.platGbCd, bun: parcel.bun, ji: parcel.ji,
    numOfRows: '100', pageNo: '1', _type: 'json',
  });

  let result = null;
  try {
    const res = await fetch(`${endpoint}?${params}`);
    const json = await res.json();
    let items = json?.response?.body?.items?.item ?? [];
    if (!Array.isArray(items)) items = [items];
    if (items.length) {
      // 주건축물 우선, 그 안에서 연면적 최대 1건을 대표로 채택
      const main = items.filter((it) => String(it.mainAtchGbCd ?? '0') === '0');
      const pool = main.length ? main : items;
      result = pool.reduce((a, b) =>
        (Number(b.totArea) || 0) > (Number(a.totArea) || 0) ? b : a);
    }
  } catch (e) {
    result = { __error: String(e.message || e) };
  }
  apiCache[key] = result;
  await new Promise((r) => setTimeout(r, API_DELAY_MS));
  return result;
}

// ── 메인 ────────────────────────────────────────────────────────────────
async function main() {
  await loadEnvFallback();
  log('▶ 수원시 팔달구 그린리모델링 대상 건축물 빌드 시작\n');

  // 1) SHP 파일 탐색
  let rawFiles = [];
  try { rawFiles = await readdir(RAW_DIR); } catch { /* 폴더 없음 */ }
  const shpFiles = rawFiles.filter((f) => f.toLowerCase().endsWith('.shp'));
  if (shpFiles.length === 0) {
    console.error('✖ build/raw/ 안에서 .shp 파일을 찾지 못했습니다.\n');
    console.error('  국가공간정보포털(nsdi.go.kr)에서 GIS건물통합정보(수원시) SHP를');
    console.error('  내려받아 build/raw/ 에 .shp/.dbf/.prj 를 함께 넣어주세요.');
    console.error('  자세한 절차는 README.md 를 참고하세요.');
    process.exit(1);
  }
  log(`· SHP ${shpFiles.length}개 발견: ${shpFiles.join(', ')}`);

  if (!process.env.DATA_GO_KR_KEY) {
    warn('DATA_GO_KR_KEY 가 없습니다. API 속성 보강을 건너뜁니다.');
    warn('SHP에 연면적이 없으면 500㎡ 필터를 적용할 수 없습니다 (.env 설정 권장).');
  }
  await loadCache();

  // 2) 각 SHP 처리
  const stats = {
    total: 0, paldal: 0, ageOk: 0, gfaUnknown: 0, targets: 0,
    apiTried: 0, apiOk: 0, apiFail: 0,
  };
  const candidates = [];   // 15년 필터 통과 (연면적 미확정 포함)
  let detectedFieldsLogged = false;
  let srcCode = process.env.SHP_EPSG || null;

  for (const shpName of shpFiles) {
    const shpPath = join(RAW_DIR, shpName);
    const dbfPath = shpPath.replace(/\.shp$/i, '.dbf');
    const prjPath = shpPath.replace(/\.shp$/i, '.prj');
    const cpgPath = shpPath.replace(/\.shp$/i, '.cpg');

    // 인코딩 (.cpg) — GIS건물통합정보는 보통 EUC-KR
    let encoding = 'euc-kr';
    if (existsSync(cpgPath)) {
      const cpg = (await readFile(cpgPath, 'utf-8')).trim().toLowerCase();
      if (cpg.includes('utf')) encoding = 'utf-8';
      else if (cpg.includes('949') || cpg.includes('euc') || cpg.includes('ks')) encoding = 'euc-kr';
    }

    // 좌표계 (.prj)
    if (!srcCode && existsSync(prjPath)) {
      srcCode = detectEpsg(await readFile(prjPath, 'utf-8'));
    }
    const useCode = srcCode || 'EPSG:5174';
    log(`\n· 처리 중: ${shpName}  (인코딩 ${encoding}, 좌표계 ${useCode}${srcCode ? '' : ' 추정'})`);

    const source = await open(shpPath, dbfPath, { encoding });
    let rec;
    while (!(rec = await source.read()).done) {
      const f = rec.value;
      if (!f || !f.geometry) continue;
      stats.total++;
      const props = f.properties || {};

      if (!detectedFieldsLogged) {
        log(`  · .dbf 필드: ${Object.keys(props).join(', ')}`);
        detectedFieldsLogged = true;
      }

      const pnu = pick(props, FIELD.pnu);
      const parcel = pnu ? pnuToParcel(pnu) : null;

      // 팔달구 필터 (PNU 우선, 없으면 시군구코드 필드)
      const sgg = parcel?.sigunguCd
        || pick(props, ['SIG_CD', 'SGG_CD', 'sigunguCd']);
      if (sgg && String(sgg).slice(0, 5) !== SIGUNGU_CD) continue;
      if (!sgg && pnu == null) {
        // 시군구를 판단할 근거가 없으면 일단 통과시키되 경고 (혼합 SHP 대비)
      }
      stats.paldal++;

      // 준공연도 / 경과연수
      const approvalYear = parseApprovalYear(pick(props, FIELD.useAprDay));
      const buildingAge = approvalYear != null ? CURRENT_YEAR - approvalYear : null;
      // 15년 필터: 미상은 보강 후 판단을 위해 후보엔 남기되 별도 표시
      if (buildingAge != null && buildingAge < MIN_AGE_YEARS) continue;
      stats.ageOk++;

      // 재투영
      const geometry = reproject(f.geometry, useCode);
      if (!geometry) continue;

      candidates.push({
        geometry,
        pnu: pnu ? String(pnu) : null,
        parcel,
        bldgName: pick(props, FIELD.bldgName),
        address: pick(props, FIELD.address),
        approvalYear,
        buildingAge,
        gfaFromShp: toNumber(pick(props, FIELD.gfa)),
        floorsAboveShp: toNumber(pick(props, FIELD.floorsUp)),
        floorsBelowShp: toNumber(pick(props, FIELD.floorsDn)),
      });
    }
  }
  log(`\n· 전체 ${stats.total} → 팔달구 ${stats.paldal} → 15년 경과 후보 ${stats.ageOk}`);

  // 3) API 속성 보강
  const features = [];
  for (const c of candidates) {
    let api = null;
    if (process.env.DATA_GO_KR_KEY && c.parcel) {
      stats.apiTried++;
      api = await fetchTitleInfo(c.parcel);
      if (api && !api.__error) stats.apiOk++;
      else if (api && api.__error) stats.apiFail++;
      if (stats.apiTried % 100 === 0) {
        log(`  · API 보강 ${stats.apiTried}건 진행…`);
        await saveCache();
      }
    }

    // 연면적: SHP 우선, 없으면 API
    const gfa = c.gfaFromShp ?? toNumber(api?.totArea);
    if (gfa == null) { stats.gfaUnknown++; continue; }   // 연면적 불명 → 제외
    if (gfa < MIN_GFA) continue;                          // 500㎡ 미만 → 제외
    stats.targets++;

    features.push({
      type: 'Feature',
      geometry: c.geometry,
      properties: {
        pnu: c.pnu,
        bldgName: c.bldgName || api?.bldNm || '(이름 없음)',
        address: c.address || api?.platPlc || api?.newPlatPlc || null,
        approvalYear: c.approvalYear,
        buildingAge: c.buildingAge,
        grossFloorArea: round1(gfa),
        mainUse: api?.mainPurpsCdNm || null,
        structure: api?.strctCdNm || null,
        floorsAbove: c.floorsAboveShp ?? toNumber(api?.grndFlrCnt),
        floorsBelow: c.floorsBelowShp ?? toNumber(api?.ugrndFlrCnt),
        height: toNumber(api?.heit),
        households: toNumber(api?.hhldCnt),
      },
    });
  }
  await saveCache();

  // 연면적을 한 건도 확정하지 못한 경우 → 명확히 실패 처리
  if (features.length === 0 && stats.gfaUnknown > 0 && stats.gfaUnknown === stats.ageOk) {
    console.error('\n✖ 연면적 정보를 SHP/API 어디에서도 확보하지 못해 500㎡ 필터를 적용할 수 없습니다.');
    console.error('  .env 의 DATA_GO_KR_KEY(건축HUB 건축물대장 API 키)를 설정한 뒤 다시 실행하세요.');
    process.exit(1);
  }

  // 4) 출력
  const fc = {
    type: 'FeatureCollection',
    meta: {
      generated: new Date().toISOString(),
      area: '수원시 팔달구',
      sigunguCd: SIGUNGU_CD,
      criteria: { minAgeYears: MIN_AGE_YEARS, minGrossFloorArea: MIN_GFA, baseYear: CURRENT_YEAR },
      crs: 'EPSG:4326',
      count: features.length,
    },
    features,
  };
  const geojsonPath = join(DATA_DIR, 'paldal_green_targets.geojson');
  const jsPath = join(DATA_DIR, 'paldal_green_targets.js');
  await writeFile(geojsonPath, JSON.stringify(fc), 'utf-8');
  await writeFile(jsPath, `window.GREEN_TARGETS = ${JSON.stringify(fc)};\n`, 'utf-8');

  // 5) 요약
  log('\n──────── 빌드 요약 ────────');
  log(`  전체 건물        : ${stats.total}`);
  log(`  팔달구           : ${stats.paldal}`);
  log(`  15년 경과 후보   : ${stats.ageOk}`);
  log(`  API 보강 (성공/실패): ${stats.apiOk}/${stats.apiFail} (시도 ${stats.apiTried})`);
  log(`  연면적 불명 제외 : ${stats.gfaUnknown}`);
  log(`  최종 대상 건물   : ${stats.targets}`);
  log(`\n✔ 산출물`);
  log(`  ${geojsonPath}`);
  log(`  ${jsPath}`);
  log('\n  index.html 을 브라우저로 열어 결과를 확인하세요.');
}

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

main().catch((e) => {
  console.error('\n✖ 빌드 실패:', e);
  process.exit(1);
});
