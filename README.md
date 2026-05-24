# 수원시 팔달구 그린리모델링 대상 건축물 지도

수원시 팔달구의 **그린리모델링 후보 건축물**(준공 15년 경과 + 연면적 500㎡
이상)을 지도에 표시하는 **단독 웹페이지**입니다. 기존
`algorithmic-ground-explorer` 앱과는 완전히 분리된 별도 산출물입니다.

## 동작 원리

두 부분으로 구성됩니다.

1. **빌드 (`build/build_targets.mjs`)** — Node 스크립트. GIS건물통합정보 SHP와
   건축HUB 건축물대장 API로부터 데이터를 받아 필터·좌표변환·속성보강 후
   정적 파일(`data/paldal_green_targets.geojson` / `.js`)을 생성합니다. 한 번만
   실행하면 됩니다.
2. **페이지 (`index.html` + `app.js` + `styles.css`)** — 순수 정적 웹페이지.
   생성된 데이터를 Leaflet 지도에 폴리곤으로 렌더링합니다. **지도 API 키도,
   백엔드 서버도 필요 없습니다.**

## 빠른 시작 — 샘플 데이터로 바로 보기

실데이터 없이도 페이지 동작을 확인할 수 있습니다. `index.html`을 브라우저로
열면 화성행궁 일대 가상의 6개 건물(샘플)이 표시됩니다.

## 실제 데이터 준비

### 1단계 — GIS건물통합정보 SHP 다운로드

1. [국가공간정보포털](http://www.nsdi.go.kr) 접속 → "GIS건물통합정보" 검색
2. 수원시(또는 경기도) 분의 **SHP** 형식을 다운로드
   - 다운로드 파일에는 `.shp`, `.dbf`, `.prj`, `.shx`(, `.cpg`)가 함께 있어야 합니다.
3. 압축을 풀어 모든 파일을 `build/raw/` 폴더에 넣습니다.
   - 경기도 전체 파일을 받아도 됩니다. 빌드 시 시군구코드 `41115`(팔달구)만
     자동으로 추출합니다.

### 2단계 — 건축HUB 건축물대장 API 키 발급

1. [공공데이터포털 — 건축HUB 건축물대장정보 서비스](https://www.data.go.kr/data/15134735/openapi.do)
   에서 **활용 신청**
2. 승인 후 발급되는 **일반 인증키 (Decoding)** 값을 복사
3. 활용 신청한 서비스 상세 페이지에서 표제부 조회(`getBrTitleInfo`)
   **엔드포인트 주소**도 확인해 둡니다.

### 3단계 — `.env` 작성

`.env.example`을 복사해 `.env`를 만들고 값을 채웁니다.

```
DATA_GO_KR_KEY=발급받은_Decoding_인증키
DATA_GO_KR_ENDPOINT=https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo
```

- `DATA_GO_KR_ENDPOINT`는 기본값이 있으니, 서비스 상세 페이지의 엔드포인트와
  같다면 생략해도 됩니다.

### 4단계 — 의존성 설치 & 빌드

Node.js **20.6 이상**이 필요합니다(`--env-file` 지원).

```
npm install
npm run build
```

빌드 콘솔에 .dbf 필드명, 팔달구 추출 건수, 필터 통과 건수, API 보강 결과,
최종 대상 건수가 출력됩니다. 완료되면 `data/paldal_green_targets.js`가
생성되고, 페이지가 샘플 대신 이 실데이터를 자동으로 사용합니다.

> **필드명 안내** — GIS건물통합정보의 .dbf 필드명은 배포 버전에 따라 다를 수
> 있습니다. 빌드 로그의 `· .dbf 필드:` 줄에 사용승인일/연면적/PNU에 해당하는
> 필드가 보이지 않으면, 그 줄을 알려주시면 `build/build_targets.mjs`의
> `FIELD` 매핑을 맞춰 드립니다.

## 페이지 열기

페이지는 빌드 산출물(`build/gold/geojson/paldal_current.geojson`)을 `fetch` 로
읽으므로 **로컬 정적 서버**가 필요합니다.

- **로컬 검증: `npm run serve`** → `http://127.0.0.1:8848/` 접속
- `file://` 로 직접 열면 실데이터를 못 불러와 샘플 데이터로 표시됩니다.
- 정적 호스팅(GitHub Pages·Vercel·Netlify 등)에 폴더 전체를 배포하면 그대로 동작하며,
  GeoJSON 은 호스팅의 자동 gzip 압축으로 전송됩니다.

## 대상 기준

지도는 **준공 15년 경과 AND 연면적 500㎡ 이상**인 건축물을 대상으로 합니다.

- **준공 15년 경과** — 통상적인 노후 건축물 판정선(2020년 공공 그린리모델링
  사업·제주 민간주택 지원사업 기준과 일치).
- **연면적 500㎡ 이상** — 「건축물의 에너지절약설계기준」 적용 기준점.

페이지의 슬라이더로 경과연수·연면적 기준을 더 좁혀 볼 수 있습니다. 단,
빌드 시점에 이미 15년·500㎡ 미만은 제외되므로 그보다 넓히는 것은 불가합니다.

## 파일 구조

```
green-remodeling-map/
├── build/
│   ├── build_targets.mjs   데이터 파이프라인
│   └── raw/                GIS건물통합정보 SHP 배치 위치
├── data/
│   ├── sample_paldal_green_targets.js   샘플 데이터 (항상 포함)
│   └── paldal_green_targets.{geojson,js}  빌드 산출물
├── index.html
├── app.js
├── styles.css
├── .env.example
├── package.json
└── README.md
```

## 알려진 한계

- 건축물대장 API는 필지(번/지) 단위로 조회됩니다. 한 필지에 여러 동이 있으면
  주건축물 중 연면적이 가장 큰 표제부를 대표로 사용합니다.
- 빌드는 데이터 스냅샷입니다. 원천 데이터가 갱신되면 다시 빌드해야 합니다.
- 좌표계는 `.prj`로 자동 판별하며(보통 EPSG:5174), 실패 시 `.env`의
  `SHP_EPSG`로 강제 지정할 수 있습니다.
