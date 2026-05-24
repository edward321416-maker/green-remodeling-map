/**
 * transforms/reproject.mjs
 * 좌표계 처리 — EPSG:5179(Korea 2000 / Unified) → WGS84 재투영 + 폴리곤 면적.
 *
 * detectEpsg / reproject / PROJ_DEFS 는 v1(build_targets.mjs)의 동작 검증된 코드를
 * 그대로 복사한 것이다 (변경 없음). polygonAreaM2 만 신규.
 */

import proj4 from 'proj4';

// ─── v1(build_targets.mjs)에서 복사 — 변경 없음 ───────────────────────────
export const PROJ_DEFS = {
  'EPSG:5174': '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.8,474.99,674.11,1.16,-2.31,-1.63,6.43',
  'EPSG:5186': '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5185': '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5187': '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5179': '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs',
};
for (const [code, def] of Object.entries(PROJ_DEFS)) proj4.defs(code, def);

/** .prj WKT 문자열로 좌표계를 추정 */
export function detectEpsg(prjText) {
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

/** Polygon/MultiPolygon 좌표를 WGS84로 재투영 */
export function reproject(geometry, srcCode) {
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
// ─── v1 복사 끝 ───────────────────────────────────────────────────────────

/**
 * 폴리곤 면적(㎡). 신발끈(shoelace) 공식.
 * ※ 반드시 재투영 전 원본 좌표(EPSG:5179, 미터 평면)로 호출할 것.
 *   외곽 링은 더하고 구멍(hole) 링은 뺀다.
 */
export function polygonAreaM2(geometry) {
  if (!geometry) return 0;
  const ringArea = (ring) => {
    let a = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  };
  const polyArea = (poly) =>
    poly.reduce((s, ring, i) => s + (i === 0 ? ringArea(ring) : -ringArea(ring)), 0);
  if (geometry.type === 'Polygon') {
    return Math.max(0, polyArea(geometry.coordinates));
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((s, p) => s + Math.max(0, polyArea(p)), 0);
  }
  return 0;
}
