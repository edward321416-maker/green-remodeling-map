/**
 * 4-C 단위 테스트 — emit/geojson.mjs 의 priority 주입 검증.
 *
 * silver snapshot (2026_05) 을 그대로 emitGeoJSON 에 흘려서:
 *   1. features 의 priority_score / components / use_matched 가 부착되는지
 *   2. is_target=false 는 priority_score=null 인지
 *   3. meta.priority_* 통계가 4-B 분석 결과와 일치하는지
 *   4. 농민회관 등 spec 검증 케이스가 정확한 점수로 나오는지
 *
 * 빌드 실행 X — 메모리 검증만.
 */
import { readFile } from 'node:fs/promises';
import { emitGeoJSON } from '../build/emit/geojson.mjs';
import { loadConfig } from './computePriority.mjs';

const snapshot = JSON.parse(
  await readFile('./build/silver/snapshots/2026_05.json', 'utf-8'),
);
const priorityConfig = await loadConfig('./config/priority_score.json');

const fc = emitGeoJSON({
  records: snapshot.records,
  snapshotMonth: snapshot.meta.snapshot_month,
  sigunguCd: snapshot.meta.sigungu_cd,
  criteria: snapshot.meta.criteria,
  fence: snapshot.meta.outlier_fence,
  priorityConfig,
});

console.log('=== 1. 피처 출력 ===');
console.log(`총 features: ${fc.features.length}`);
const targets = fc.features.filter((f) => f.properties.is_target);
const nontargets = fc.features.filter((f) => !f.properties.is_target);
console.log(`  is_target=true : ${targets.length}`);
console.log(`  is_target=false: ${nontargets.length}`);

const withScore = targets.filter((f) => f.properties.priority_score !== null);
console.log(`  priority_score 부착(target): ${withScore.length} / ${targets.length}`);
const nontargetScores = nontargets.filter((f) => f.properties.priority_score !== null);
console.log(`  priority_score 부착(non-target): ${nontargetScores.length} (기대 0)`);

console.log('\n=== 2. meta.priority_* 통계 ===');
console.log({
  config_version: fc.meta.priority_score_config_version,
  formula: fc.meta.priority_formula_id,
  weights: fc.meta.priority_weights,
  stats: fc.meta.priority_score_stats,
  distribution: fc.meta.priority_score_distribution,
  use_match_rate: fc.meta.priority_use_match_rate,
});

console.log('\n=== 3. 4-B 결과와 일치 검증 ===');
const expected = {
  n: 4309, min: 18.1, max: 98, median: 55.3, q1: 42.3, q3: 66.5,
  matchRate: 1.0,
};
const s = fc.meta.priority_score_stats;
const ok = (k, exp, act) => {
  const eq = Math.abs(exp - act) < 0.05;
  console.log(`  ${k}: 기대 ${exp} / 실측 ${act}  ${eq ? '✓' : '✗ 불일치'}`);
  return eq;
};
ok('n', expected.n, s.n);
ok('min', expected.min, s.min);
ok('max', expected.max, s.max);
ok('median', expected.median, s.median);
ok('q1', expected.q1, s.q1);
ok('q3', expected.q3, s.q3);
ok('use_match_rate', expected.matchRate, fc.meta.priority_use_match_rate);

console.log('\n=== 4. spec 검증 케이스: 농민회관 ===');
const nongmin = fc.features.find((f) => f.properties.bldgName === '농민회관');
if (!nongmin) console.log('  (농민회관 없음 — snapshot 확인 필요)');
else {
  console.log({
    name: nongmin.properties.bldgName,
    age: nongmin.properties.buildingAge,
    gfa: nongmin.properties.grossFloorArea,
    use: nongmin.properties.mainUse,
    score: nongmin.properties.priority_score,
    components: nongmin.properties.priority_components,
    useMatched: nongmin.properties.priority_use_matched,
  });
  const score98 = nongmin.properties.priority_score === 98;
  console.log(`  점수 98.0 일치: ${score98 ? '✓' : '✗'}`);
}

console.log('\n=== 5. Top 5 (dedup 안 함, 모든 폴리곤) ===');
const sorted = [...withScore].sort((a, b) =>
  b.properties.priority_score - a.properties.priority_score);
sorted.slice(0, 5).forEach((f, i) => {
  const p = f.properties;
  console.log(`  ${i + 1}. ${(p.bldgName || '(이름없음)').slice(0, 22).padEnd(22)} | ${p.buildingAge}년 | ${Math.round(p.grossFloorArea).toLocaleString()}㎡ | ${p.mainUse} | ${p.priority_score} | match_key=${p.match_key}`);
});

console.log('\n=== 6. GeoJSON 크기 예상 ===');
const jsonSize = JSON.stringify(fc).length;
console.log(`  현재 emit 결과 JSON: ${(jsonSize / 1048576).toFixed(2)} MB`);
const oldSize = (await readFile('./build/gold/geojson/paldal_current.geojson')).length;
console.log(`  기존 GeoJSON: ${(oldSize / 1048576).toFixed(2)} MB`);
console.log(`  증분: ${((jsonSize - oldSize) / 1048576).toFixed(2)} MB (priority 필드 3개 추가)`);
