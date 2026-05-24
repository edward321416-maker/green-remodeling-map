# Silver 스키마 정의 — schema_v1

> Silver 통합 스냅샷(`build/silver/snapshots/<월>.json`)의 레코드 스키마.
> 버전 v1 · 2026-05-22 · 기준 문서: [data_engineering_plan.md](./data_engineering_plan.md)

## 개요

- 스냅샷은 `{ meta, records[] }` 구조의 JSON 1개 파일이다. *(Phase 3에서 Parquet 전환)*
- `records[]` 는 **건물 폴리곤 1개당 1행**. 매칭 실패 건물도 모두 포함(완전성).
- Gold 산출물은 모두 이 Silver 레코드에서 파생된다.

## meta 객체

| 필드 | 타입 | 설명 |
|------|------|------|
| `schema` | string | 스키마 버전 (`"v1"`) |
| `snapshot_month` | string | 스냅샷 월 (`"2026_05"`) |
| `generated` | string(ISO) | 생성 시각 |
| `area` | string | 대상 지역명 |
| `sigungu_cd` | string | 시군구코드 (`"41115"`) |
| `criteria` | object | `{ minAgeYears:15, minGrossFloorArea:500, baseYear:2026 }` |
| `source` | object | L1 SHP 파일명, L2 표제부 수신 건수, 수신 실패 법정동 목록 |
| `outlier_fence` | object | D4 Tukey IQR 펜스 — `{ method, multiplier, sampleSize, q1, median, q3, iqr, lower, upper }`. 시계열 비교용 |
| `counts` | object | 매칭/대상 집계 |

## record 객체 (건물 1동)

### 식별자
| 필드 | 타입 | 출처 | Null | 설명 |
|------|------|------|------|------|
| `ufid` | string | L1 `UFID` | N | 연속수치지도 객체 고유번호 |
| `snapshot_month` | string | 빌드 | N | 소속 스냅샷 월 |
| `bjcd` | string | L1 `BJCD` | N | 법정동코드 10자리 |
| `sigungu_cd` | string | 파생 | N | `bjcd[0:5]` |
| `bjdong_cd` | string | 파생 | N | `bjcd[5:10]` |

### 매칭
| 필드 | 타입 | 출처 | Null | 설명 |
|------|------|------|------|------|
| `road_key` | string | 파생 | Y | 건물 도로명 조인키. 도로명 없으면 null |
| `match_status` | string | 파생 | N | `matched` \| `no_road_address` \| `road_no_match` |
| `match_key` | string | 파생 | Y | 매칭 성공 시 사용된 도로명키 (= `road_key`), 아니면 null |
| `match_cardinality` | string | 파생 | Y | `1:1` \| `1:N` \| `N:1` \| `N:M`. 매칭 시만 |
| `data_source` | string | 파생 | N | `shp_only` \| `shp+api` |

### L1 — 연속수치지도 원본 속성
| 필드 | 타입 | 출처 | Null | 설명 |
|------|------|------|------|------|
| `name_shp` | string | L1 `NAME` | Y | SHP 명칭 (대부분 비어 있음) |
| `anno_shp` | string | L1 `ANNO` | Y | SHP 주기 텍스트 |
| `kind_shp` | string | L1 `KIND` | Y | 건물 종류 코드 (BDK0xx) |
| `nmly_shp` | number | L1 `NMLY` | Y | SHP 층수 (참고용, 신뢰도 낮음) |
| `rdnm` | string | L1 `RDNM` | Y | 도로명코드 7자리 |
| `bonu` | number | L1 `BONU` | Y | 건물본번 |
| `bunu` | number | L1 `BUNU` | Y | 건물부번 |

### L2 — 건축물대장 표제부 속성 (매칭 시에만, 미매칭은 전부 null)
| 필드 | 타입 | 출처(API) | Null | 설명 |
|------|------|-----------|------|------|
| `bld_nm` | string | `bldNm` | Y | 건물명 |
| `road_address` | string | `newPlatPlc` | Y | 도로명주소 |
| `jibun_address` | string | `platPlc` | Y | 지번주소 |
| `use_apr_day` | string | `useAprDay` | Y | 사용승인일 원본 (YYYYMMDD) |
| `gross_floor_area` | number | `totArea` | Y | **연면적**(㎡) — 전 층 바닥면적 합. 대상 선정(500㎡) 기준 |
| `arch_area` | number | `archArea` | Y | **건축면적**(㎡) — 1층 외형 면적. 이상치 검증 비교 대상 |
| `plat_area` | number | `platArea` | Y | **대지면적**(㎡) — 필지(땅) 면적 |
| `main_use_cd` | string | `mainPurpsCd` | Y | 주용도 코드 |
| `main_use` | string | `mainPurpsCdNm` | Y | 주용도명 |
| `structure_cd` | string | `strctCd` | Y | 구조 코드 |
| `structure` | string | `strctCdNm` | Y | 구조명 |
| `floors_above` | number | `grndFlrCnt` | Y | 지상 층수 |
| `floors_below` | number | `ugrndFlrCnt` | Y | 지하 층수 |
| `height` | number | `heit` | Y | 높이(m) |
| `households` | number | `hhldCnt` | Y | 세대수 |

### 파생 속성
| 필드 | 타입 | Null | 설명 |
|------|------|------|------|
| `approval_year` | number | Y | `use_apr_day` 에서 추출한 준공연도 |
| `building_age` | number | Y | `baseYear - approval_year` |
| `polygon_area_m2` | number | N | SHP 폴리곤 면적(㎡). 원본 EPSG:5179 평면좌표 신발끈 공식 (계산값) |
| `polygon_arch_ratio` | number | Y | `polygon_area_m2 / arch_area`. **카디널리티 1:1 일 때만**. 1.0 에 가까울수록 정합 |
| `is_target` | boolean | N | `matched && building_age ≥ min_age_years && gross_floor_area ≥ min_gross_floor_area_m2` |
| `quality_flags` | string[] | N | 유효성 검증 위반 코드 배열 (없으면 `[]`) |

### 형상
| 필드 | 타입 | Null | 설명 |
|------|------|------|------|
| `geometry` | object | N | WGS84(EPSG:4326) GeoJSON Polygon/MultiPolygon |

## 면적 필드 — 4종 명확 구분

면적 관련 필드는 **차원(dimension)이 서로 다르므로** 절대 혼용하지 않는다.

| 필드 | 한글 | 정의 | 단위 | 출처 |
|------|------|------|------|------|
| `gross_floor_area` | 연면적 | **모든 층** 바닥면적의 합 (예: 5층 × 200㎡ = 1,000㎡) | ㎡ | 표제부 `totArea` |
| `arch_area` | 건축면적 | **1층 외형**(건물을 위에서 본 윤곽)의 면적 | ㎡ | 표제부 `archArea` |
| `plat_area` | 대지면적 | 건물이 선 **필지(땅)**의 면적 | ㎡ | 표제부 `platArea` |
| `polygon_area_m2` | 폴리곤 면적 | SHP **건물 폴리곤**(1층 윤곽)의 계산 면적 | ㎡ | 계산 (신발끈 공식) |

**핵심 관계와 사용처:**
- `polygon_area_m2` ≈ `arch_area` — 둘 다 "1층 윤곽" 차원이라 **직접 비교 가능**.
  → `polygon_arch_ratio` 와 `area_mismatch`(D4 이상치) 검증에 사용.
- `gross_floor_area` = `arch_area` × (대략 층수) — 다층 건물에서 폴리곤 면적의 N배.
  → 폴리곤과 **직접 비교하면 안 된다**. 대상 선정 기준(500㎡)에만 사용.
- `gross_floor_area`·`arch_area`·`plat_area` 는 모두 동일 표제부 API 응답에서 함께
  수신되므로 추가 호출이 없다.

## quality_flags 코드

| 코드 | 의미 |
|------|------|
| `use_apr_day_missing` | 매칭됐으나 사용승인일 없음 |
| `use_apr_day_invalid` | 사용승인일이 유효 연도 범위(1900~기준연도) 밖 |
| `gfa_missing` | 매칭됐으나 연면적 없음 |
| `gfa_nonpositive` | 연면적 ≤ 0 |
| `polygon_degenerate` | 폴리곤 면적이 임계(`polygon_min_area_m2`) 미만 |
| `area_mismatch` | `polygon_arch_ratio` 가 Tukey IQR 펜스 `[Q1−k·IQR, Q3+k·IQR]` 밖 (1:1 매칭 한정) |
| `dong_fetch_failed` | 소속 법정동의 표제부 API 수신 실패 — 매칭 불가 처리 |

> 이상치(`area_mismatch`) 판정 — **Tukey IQR 펜스**: 1:1 매칭 건물 `polygon_arch_ratio`
> 분포의 사분위(Q1·Q3)로 펜스를 잡아 그 밖을 플래그한다. 고정 비율이 아닌 데이터
> 자기보정 방식 — 폴리곤이 건축면적보다 체계적으로 큰(중앙값 ~1.2) 특성에 견고하다.
> 펜스 값은 스냅샷 `meta.outlier_fence` 와 품질 리포트에 기록된다.
>
> 임계값·방법(`outlier_method`, `outlier_iqr_multiplier`, `polygon_min_area_m2`,
> 대상 선정 기준)은 코드에 하드코딩하지 않고 **`config/target_criteria.json`**
> 단일 출처에서 읽는다.

## Gold GeoJSON 피처 속성 (참고)

Gold `geojson` 은 Silver 레코드 중 **대상 건물 + 미매칭 건물**을 골라 아래 속성으로
재구성한다(`emit/geojson.mjs`). 페이지(`app.js`) 호환을 위해 카멜케이스 별칭을 쓴다.

`ufid · bldgName · match_status · match_key · match_cardinality · data_source ·
snapshot_month · is_target · address · roadAddress · jibunAddress · approvalYear ·
buildingAge · grossFloorArea · mainUse · structure · floorsAbove · floorsBelow ·
height · households · polygon_area_m2 · polygon_arch_ratio · shpFloors`
