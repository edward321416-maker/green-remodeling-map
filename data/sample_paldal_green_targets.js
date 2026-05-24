/**
 * 샘플 데이터 — 페이지 개발/데모용 (수원시 팔달구 화성행궁 일대 가상의 6개 건물).
 * 실제 데이터는 `npm run build` 후 생성되는 paldal_green_targets.js 가 대체합니다.
 */
window.GREEN_TARGETS_SAMPLE = {
  "type": "FeatureCollection",
  "meta": {
    "generated": "2026-05-22T00:00:00.000Z",
    "area": "수원시 팔달구 (샘플)",
    "sigunguCd": "41115",
    "criteria": { "minAgeYears": 15, "minGrossFloorArea": 500, "baseYear": 2026 },
    "crs": "EPSG:4326",
    "count": 6,
    "sample": true
  },
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[
        [127.012274, 37.281665], [127.012726, 37.281665],
        [127.012726, 37.281935], [127.012274, 37.281935], [127.012274, 37.281665]
      ]]},
      "properties": {
        "pnu": "4111510300100010000", "bldgName": "행궁로 빌딩",
        "address": "경기도 수원시 팔달구 행궁로 12", "approvalYear": 1986,
        "buildingAge": 40, "grossFloorArea": 1850, "mainUse": "업무시설",
        "structure": "철근콘크리트구조", "floorsAbove": 7, "floorsBelow": 1,
        "height": 24.5, "households": 0
      }
    },
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[
        [127.013974, 37.282165], [127.014426, 37.282165],
        [127.014426, 37.282435], [127.013974, 37.282435], [127.013974, 37.282165]
      ]]},
      "properties": {
        "pnu": "4111510300100150000", "bldgName": "팔달제일상가",
        "address": "경기도 수원시 팔달구 정조로 88", "approvalYear": 1994,
        "buildingAge": 32, "grossFloorArea": 920, "mainUse": "제2종근린생활시설",
        "structure": "철근콘크리트구조", "floorsAbove": 5, "floorsBelow": 1,
        "height": 17, "households": 0
      }
    },
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[
        [127.01536, 37.28062], [127.01604, 37.28062],
        [127.01604, 37.28098], [127.01536, 37.28098], [127.01536, 37.28062]
      ]]},
      "properties": {
        "pnu": "4111510300100320000", "bldgName": "수원중앙아파트",
        "address": "경기도 수원시 팔달구 매산로 45", "approvalYear": 2004,
        "buildingAge": 22, "grossFloorArea": 6400, "mainUse": "공동주택",
        "structure": "철근콘크리트구조", "floorsAbove": 15, "floorsBelow": 2,
        "height": 44, "households": 84
      }
    },
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[
        [127.012874, 37.279665], [127.013326, 37.279665],
        [127.013326, 37.279935], [127.012874, 37.279935], [127.012874, 37.279665]
      ]]},
      "properties": {
        "pnu": "4111510300100470000", "bldgName": "팔달행복학원",
        "address": "경기도 수원시 팔달구 인계로 30", "approvalYear": 2009,
        "buildingAge": 17, "grossFloorArea": 680, "mainUse": "교육연구시설",
        "structure": "철골철근콘크리트구조", "floorsAbove": 6, "floorsBelow": 1,
        "height": 21, "households": 0
      }
    },
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[
        [127.01163, 37.282987], [127.01197, 37.282987],
        [127.01197, 37.283213], [127.01163, 37.283213], [127.01163, 37.282987]
      ]]},
      "properties": {
        "pnu": "4111510300100610000", "bldgName": "화성한옥주택",
        "address": "경기도 수원시 팔달구 화서문로 8", "approvalYear": 1978,
        "buildingAge": 48, "grossFloorArea": 540, "mainUse": "단독주택",
        "structure": "조적조", "floorsAbove": 2, "floorsBelow": 0,
        "height": 7.2, "households": 1
      }
    },
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[
        [127.014674, 37.279065], [127.015126, 37.279065],
        [127.015126, 37.279335], [127.014674, 37.279335], [127.014674, 37.279065]
      ]]},
      "properties": {
        "pnu": "4111510300100880000", "bldgName": "매산로 오피스",
        "address": "경기도 수원시 팔달구 매산로 120", "approvalYear": null,
        "buildingAge": null, "grossFloorArea": 1100, "mainUse": "업무시설",
        "structure": "철근콘크리트구조", "floorsAbove": 8, "floorsBelow": 2,
        "height": 27, "households": 0
      }
    }
  ]
};
