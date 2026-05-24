/**
 * 4-B 일회용 분석 스크립트 — 4,309동 전체 검증.
 * 실행: node scripts/scoring/_analyze_4b.mjs
 * 사용 후 삭제.
 */
import { readFile } from 'node:fs/promises';
import {
  computePriority, summarizeUseMatching, loadConfig,
} from './computePriority.mjs';

const config = await loadConfig('./config/priority_score.json');
const geo = JSON.parse(
  await readFile('./build/gold/geojson/paldal_current.geojson', 'utf-8'),
);
const targets = geo.features.filter((f) => f.properties.is_target === true);

const scored = targets.map((f) => ({
  props: f.properties,
  r: computePriority(f.properties, config),
}));

// ── 1. 점수 분포 통계 ─────────────────────────────────────────
const valid = scored.filter((s) => s.r.score !== null);
const vs = valid.map((s) => s.r.score);
const sorted = [...vs].sort((a, b) => a - b);
const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
const median = sorted[Math.floor(sorted.length / 2)];
const q1 = sorted[Math.floor(sorted.length * 0.25)];
const q3 = sorted[Math.floor(sorted.length * 0.75)];
const std = Math.sqrt(vs.reduce((a, v) => a + (v - mean) ** 2, 0) / vs.length);

console.log('=== 1. 점수 분포 통계 (n=' + vs.length + ') ===');
console.log({
  min: sorted[0], max: sorted[sorted.length - 1],
  mean: +mean.toFixed(2), median, q1, q3, std: +std.toFixed(2),
});

const bins = [0, 0, 0, 0, 0];
vs.forEach((s) => {
  if (s < 20) bins[0]++;
  else if (s < 40) bins[1]++;
  else if (s < 60) bins[2]++;
  else if (s < 80) bins[3]++;
  else bins[4]++;
});
console.log('히스토그램 (구간별 건수):');
['0-20', '20-40', '40-60', '60-80', '80-100'].forEach((lbl, i) => {
  const pct = ((bins[i] / vs.length) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(bins[i] / vs.length * 40));
  console.log(`  ${lbl.padEnd(8)} ${String(bins[i]).padStart(5)}  ${pct.padStart(5)}%  ${bar}`);
});

// ── 2. Top 10 ─────────────────────────────────────────────────
const byScoreDesc = [...valid].sort((a, b) => b.r.score - a.r.score);
console.log('\n=== 2. Top 10 ===');
byScoreDesc.slice(0, 10).forEach((s, i) => {
  const p = s.props;
  const dn = (p.address || '').match(/\(([^)]+)\)/);
  const dong = dn ? dn[1] : '?';
  console.log(`${String(i + 1).padStart(3)}. ${(p.bldgName || '(이름없음)').slice(0, 22).padEnd(22)} | ${p.approvalYear} | ${String(p.buildingAge) + '년'} | ${String(Math.round(p.grossFloorArea).toLocaleString() + '㎡').padStart(11)} | ${(p.mainUse || '').padEnd(11)} | ${dong.padEnd(8)} | ${s.r.score.toFixed(1)} (${s.r.components.age.toFixed(2)}/${s.r.components.area.toFixed(2)}/${s.r.components.use.toFixed(2)}) | matched=${s.r.useMatched} | card=${p.match_cardinality || '-'} | key=${p.match_key || '-'}`);
});

// ── 3. Bottom 10 ──────────────────────────────────────────────
console.log('\n=== 3. Bottom 10 (점수 오름차) ===');
byScoreDesc.slice(-10).reverse().forEach((s, i) => {
  const p = s.props;
  const dn = (p.address || '').match(/\(([^)]+)\)/);
  const dong = dn ? dn[1] : '?';
  console.log(`  ${(p.bldgName || '(이름없음)').slice(0, 22).padEnd(22)} | ${p.buildingAge}년 | ${Math.round(p.grossFloorArea).toLocaleString()}㎡ | ${(p.mainUse || '').padEnd(11)} | ${dong.padEnd(8)} | ${s.r.score.toFixed(1)} (${s.r.components.age.toFixed(2)}/${s.r.components.area.toFixed(2)}/${s.r.components.use.toFixed(2)})`);
});

// ── 4. use 매칭 통계 ──────────────────────────────────────────
const useStat = summarizeUseMatching(targets.map((f) => f.properties), config);
const totalU = useStat.matched + useStat.defaulted + useStat.missingScore;
console.log('\n=== 4. use 매칭 통계 ===');
console.log(`  정확 매칭: ${useStat.matched} (${(useStat.matched / totalU * 100).toFixed(1)}%)`);
console.log(`  _default 폴백: ${useStat.defaulted} (${(useStat.defaulted / totalU * 100).toFixed(1)}%)`);
console.log(`  점수=null: ${useStat.missingScore} (${(useStat.missingScore / totalU * 100).toFixed(1)}%)`);

const defaultedSorted = Object.entries(useStat.defaultedUses).sort((a, b) => b[1] - a[1]);
if (defaultedSorted.length) {
  console.log('  _default 폴백 주용도 Top 10:');
  defaultedSorted.slice(0, 10).forEach(([u, c]) => {
    console.log(`    ${u.padEnd(20)} ${c}`);
  });
} else {
  console.log('  _default 폴백된 주용도 없음 (모든 use_score 매칭 성공)');
}

// ── 5. score=null 분석 ────────────────────────────────────────
const nulls = scored.filter((s) => s.r.score === null);
console.log(`\n=== 5. score=null 분석 (${nulls.length}/${targets.length} = ${(nulls.length / targets.length * 100).toFixed(2)}%) ===`);
const reason = { ageNull: 0, gfaNull: 0, bothNull: 0 };
nulls.forEach((s) => {
  const p = s.props;
  const ageOk = typeof p.buildingAge === 'number';
  const gfaOk = typeof p.grossFloorArea === 'number';
  if (!ageOk && !gfaOk) reason.bothNull++;
  else if (!ageOk) reason.ageNull++;
  else reason.gfaNull++;
});
console.log(`  age 결측: ${reason.ageNull}`);
console.log(`  gfa 결측: ${reason.gfaNull}`);
console.log(`  둘 다 결측: ${reason.bothNull}`);

// ── 6. 카디널리티별 점수 분포 ─────────────────────────────────
const byCard = {};
valid.forEach((s) => {
  const c = s.props.match_cardinality || '미상';
  if (!byCard[c]) byCard[c] = [];
  byCard[c].push(s.r.score);
});
console.log('\n=== 6. 카디널리티별 점수 분포 ===');
Object.entries(byCard).sort().forEach(([c, vs]) => {
  const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
  console.log(`  ${c.padEnd(5)} n=${String(vs.length).padStart(5)}  평균=${avg.toFixed(2)}`);
});

// dedup sanity: N:1 / N:M 같은 match_key 점수 일관성
const byKey = {};
valid.filter((s) => ['N:1', 'N:M'].includes(s.props.match_cardinality))
  .forEach((s) => {
    const k = s.props.match_key;
    if (!k) return;
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push(s.r.score);
  });
const groups = Object.entries(byKey).filter(([, v]) => v.length > 1);
const consistent = groups.filter(([, v]) => new Set(v).size === 1);
console.log(`  N:1·N:M dedup sanity: ${groups.length} group(2+), 점수 일관: ${consistent.length} (불일치 ${groups.length - consistent.length})`);

// Top 10 중복 검사
console.log('\n=== 6b. Top 10 의 match_key 중복 ===');
const top10keys = byScoreDesc.slice(0, 10).map(s => s.props.match_key);
const seen = new Set();
const dup = [];
top10keys.forEach((k, i) => { if (k && seen.has(k)) dup.push({pos:i+1,k}); seen.add(k); });
console.log(dup.length ? '  중복 발견:' : '  Top 10 내 match_key 중복 없음', dup);

// Top 50 중복도 한번 보자
const top50keys = byScoreDesc.slice(0, 50).map(s => s.props.match_key);
const counter = {};
top50keys.forEach(k => { if (k) counter[k] = (counter[k] || 0) + 1; });
const dupKeys50 = Object.entries(counter).filter(([, v]) => v > 1);
console.log(`  Top 50: ${dupKeys50.length} 개 key 가 2회 이상 등장 (총 ${dupKeys50.reduce((s,[,v])=>s+v,0)} 행)`);
if (dupKeys50.length) {
  dupKeys50.slice(0, 5).forEach(([k, v]) => console.log(`    ${k} × ${v}`));
}

// ── 7. 가중치 민감도 (age 60 / area 25 / use 15) ──────────────
const alt = JSON.parse(JSON.stringify(config));
alt.weights = { age: 60, area: 25, use: 15 };
const altScored = targets.map((f) => ({
  props: f.properties,
  r: computePriority(f.properties, alt),
})).filter(s => s.r.score !== null);
const altTop = [...altScored].sort((a, b) => b.r.score - a.r.score).slice(0, 10);
const curIds = new Set(byScoreDesc.slice(0, 10).map(s => s.props.ufid));
const altIds = new Set(altTop.map(s => s.props.ufid));
const overlap = [...curIds].filter(x => altIds.has(x));
console.log('\n=== 7. 가중치 민감도 (age 60/area 25/use 15) ===');
console.log(`  Top 10 교집합: ${overlap.length}/10 (현재 50/30/20 vs 대안 60/25/15)`);
console.log('  대안 가중치 Top 5:');
altTop.slice(0, 5).forEach((s, i) => {
  const p = s.props;
  console.log(`    ${i + 1}. ${(p.bldgName || '').slice(0, 20).padEnd(20)} | ${p.buildingAge}년 | ${Math.round(p.grossFloorArea).toLocaleString()}㎡ | ${p.mainUse} | ${s.r.score.toFixed(1)}`);
});
