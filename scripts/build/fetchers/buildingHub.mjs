/**
 * fetchers/buildingHub.mjs
 * 건축HUB 건축물대장 표제부(getBrTitleInfo) — 법정동 단위 일괄 다운로드.
 *
 * - 한 법정동을 numOfRows 페이지 단위로 끝까지 수신 (페이지네이션).
 * - 순수 네트워크 모듈: 캐시는 다루지 않는다 (pipeline 이 법정동 단위 파일로 캐시).
 * - 페이지 요청이 재시도 끝에 실패하면 errors 에 격리 후 throw → pipeline 이 동 단위로 처리.
 * - totalCount 와 실제 수신 건수를 비교해 ok 플래그로 반환 (안전장치 C — 검증은 pipeline).
 */

const ENDPOINT_DEFAULT = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';

/** Silver 빌드에 필요한 표제부 필드만 보존 (캐시 용량 절감) */
export const TITLE_FIELDS = [
  'naRoadCd', 'naMainBun', 'naSubBun', 'naBjdongCd',
  'sigunguCd', 'bjdongCd', 'platGbCd', 'bun', 'ji',
  'bldNm', 'newPlatPlc', 'platPlc',
  'useAprDay', 'totArea', 'archArea', 'platArea',
  'mainPurpsCd', 'mainPurpsCdNm', 'strctCd', 'strctCdNm',
  'grndFlrCnt', 'ugrndFlrCnt', 'heit', 'hhldCnt', 'mainAtchGbCd',
];

function projectItem(it) {
  const o = {};
  for (const f of TITLE_FIELDS) if (it[f] !== undefined) o[f] = it[f];
  return o;
}

/** 표제부 한 페이지 조회 (재시도 포함). 실패 시 errors 격리 후 throw */
async function fetchTitlePage({ endpoint, serviceKey, sigunguCd, bjdongCd, pageNo, numOfRows, maxRetry, errors }) {
  const params = new URLSearchParams({
    serviceKey, sigunguCd, bjdongCd,
    numOfRows: String(numOfRows), pageNo: String(pageNo), _type: 'json',
  });
  const url = `${endpoint}?${params}`;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) {
        lastErr = { kind: 'http', httpStatus: res.status, body: text.slice(0, 300) };
      } else {
        let json = null;
        try { json = JSON.parse(text); }
        catch { lastErr = { kind: 'parse', body: text.slice(0, 300) }; }
        if (json) {
          const rc = json?.response?.header?.resultCode;
          const rm = json?.response?.header?.resultMsg;
          if (rc === '00' || rc === '03') {            // 03 = NODATA (정상, 0건)
            const body = json?.response?.body ?? {};
            let items = body?.items?.item ?? [];
            if (!Array.isArray(items)) items = items ? [items] : [];
            return { totalCount: Number(body.totalCount) || 0, items: items.map(projectItem) };
          }
          lastErr = { kind: 'resultCode', resultCode: rc, resultMsg: rm };
        }
      }
    } catch (e) {
      lastErr = { kind: 'network', message: String(e?.message || e) };
    }
    if (attempt < maxRetry) await new Promise((r) => setTimeout(r, 400 * attempt));
  }

  errors.push({ when: new Date().toISOString(), bjdongCd, pageNo, ...lastErr });
  throw new Error(
    `표제부 조회 실패 (법정동 ${bjdongCd}, 페이지 ${pageNo}): `
    + `${lastErr?.kind} ${lastErr?.resultCode ?? lastErr?.httpStatus ?? lastErr?.message ?? ''}`,
  );
}

/**
 * 한 법정동의 표제부 전체를 페이지네이션으로 수신 (순수 네트워크, 캐시 없음).
 * @returns {{items, totalCount, received, ok, pages}}
 *          ok = (received === totalCount). 페이지 요청 실패 시 throw.
 *
 * 주의: getBrTitleInfo 는 numOfRows 를 100 으로 제한한다(1000 요청해도 100건 반환).
 *       numOfRows 기본값을 100 으로 두고, 안전 한도는 numOfRows 와 무관하게
 *       totalCount 기반으로 잡는다(페이지 수는 결코 레코드 수를 넘지 못함).
 */
export async function fetchDongTitles({
  endpoint = ENDPOINT_DEFAULT, serviceKey, sigunguCd, bjdongCd,
  errors = [], numOfRows = 100, delayMs = 100, maxRetry = 3,
}) {
  const items = [];
  let totalCount = null;
  let pageNo = 1;

  while (true) {
    const page = await fetchTitlePage({
      endpoint, serviceKey, sigunguCd, bjdongCd, pageNo, numOfRows, maxRetry, errors,
    });
    if (totalCount === null) totalCount = page.totalCount;
    items.push(...page.items);

    if (items.length >= totalCount || page.items.length === 0) break;
    pageNo++;
    if (pageNo > totalCount + 5) break;                          // 무한루프 안전 한도
    await new Promise((r) => setTimeout(r, delayMs));
  }

  totalCount = totalCount ?? 0;
  return {
    items, totalCount, received: items.length,
    ok: items.length === totalCount, pages: pageNo,
  };
}
