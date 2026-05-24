/**
 * identity_resolver.mjs
 * 건물·표제부의 식별자 처리 — BJCD(법정동코드) 파싱과 도로명 조인키 생성.
 *
 * 도로명 조인 규칙 (data_engineering_plan.md §7):
 *   건물(연속수치지도): "41115" + RDNM(7) + "-" + BONU + "-" + BUNU
 *   표제부(건축물대장):  naRoadCd(12)      + "-" + naMainBun + "-" + naSubBun
 *   "41115"+RDNM == naRoadCd 이면 동일 도로명주소.
 */

export const SIGUNGU_CD_DEFAULT = '41115';   // 수원시 팔달구

/** BJCD(법정동코드 10자리) → { bjcd, sigungu, dong }. 형식 불량 시 null */
export function parseBjcd(bjcd) {
  const s = String(bjcd ?? '').trim();
  if (s.length < 10 || !/^\d{10}/.test(s)) return null;
  return { bjcd: s.slice(0, 10), sigungu: s.slice(0, 5), dong: s.slice(5, 10) };
}

/** 연속수치지도 건물 속성 → 도로명 조인키. RDNM(도로명코드) 없으면 null */
export function buildingRoadKey(props, sigunguCd = SIGUNGU_CD_DEFAULT) {
  const rdnm = String(props?.RDNM ?? '').trim();
  if (!rdnm) return null;
  const bonu = Number(props?.BONU) || 0;
  const bunu = Number(props?.BUNU) || 0;
  return `${sigunguCd}${rdnm}-${bonu}-${bunu}`;
}

/** 건축물대장 표제부 item → 도로명 조인키. naRoadCd(12자리) 불량 시 null */
export function titleRoadKey(item) {
  const road = String(item?.naRoadCd ?? '').trim();
  if (road.length < 12) return null;
  const mb = parseInt(String(item?.naMainBun ?? '').replace(/[^0-9]/g, '') || '0', 10);
  const sb = parseInt(String(item?.naSubBun ?? '').replace(/[^0-9]/g, '') || '0', 10);
  return `${road}-${mb}-${sb}`;
}
