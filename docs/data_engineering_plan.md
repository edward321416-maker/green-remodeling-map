# 수원시 팔달구 그린리모델링 — 데이터 가공 기획서

> **이 문서는 향후 모든 데이터 작업의 기준 문서입니다.**
> 작성일 2026-05-22 · 버전 v1 · 대상 지역 수원시 팔달구(41115)

---

## 0. 배경과 목적

수원시 팔달구의 **그린리모델링 후보 건축물**(준공 15년 경과 AND 연면적 500㎡ 이상)을
지도화하고, 나아가 우선순위 점수·변경 이력·API 서비스까지 제공하는 **PropTech 데이터
파이프라인**을 구축한다.

2026-05-22 실데이터 점검에서 확인된 사실이 이 기획의 출발점이다.

- 입력 공간데이터는 GIS건물통합정보가 아니라 **NGII 연속수치지도** 건물 레이어다.
  → 지번(PNU)·사용승인일·연면적이 SHP에 없다.
- 연속수치지도 건물의 `BONU/BUNU`는 지번이 아니라 **도로명주소 건물번호**다.
  → 지번 조인은 11%, **도로명 조인은 94%** 매칭된다.
- 건축물대장 표제부(`getBrTitleInfo`)는 **법정동 단위 일괄 조회**가 가능하다.
  → 팔달구 전체 ≈ 168회 호출.

따라서 본 시스템은 **공간데이터(연속수치지도) + 속성데이터(건축물대장)** 를
**도로명주소 키**로 결합하는 것을 핵심 연산으로 한다.

---

## 1. 데이터 5계층 (data taxonomy)

| # | 계층 | 대표 데이터 | 출처 | 본 시스템에서의 역할 |
|---|------|------------|------|----------------------|
| L1 | **공간 데이터** | 연속수치지도 건물 폴리곤(N3A_B0010000) | NGII 국토정보플랫폼 | 건물 형상(geometry) |
| L2 | **대장 데이터** | 건축물대장 표제부 | 건축HUB OpenAPI(data.go.kr) | 사용승인일·연면적·용도·구조 |
| L3 | **참조 코드** | 법정동·도로명·용도·구조 코드 마스터 | API 부수 산출 / 표준 코드 | 코드→명칭 해석, 조인 보조 |
| L4 | **보강 데이터** *(Phase 4)* | 에너지효율등급·용도지역·공시지가 등 | 건축HUB·VWorld 등 | 점수 산정 입력 |
| L5 | **파생 데이터** | 통합 스냅샷·점수·변경이력·API 산출물 | 본 파이프라인 생성 | 최종 제공물 |

L1·L2·L3가 현재(Phase 1~2) 처리 대상이며, L4는 Phase 4, L5는 단계적으로 확장된다.

---

## 2. 아키텍처 — Bronze · Silver · Gold

원천의 불변 보존(Bronze) → 정제·통합(Silver) → 용도별 산출(Gold)의 3단 메달리온 구조.

### Bronze — 원천 보존 계층
- 원천 데이터를 **가공 없이** 월별로 보존한다. 재현성과 감사(audit)의 기준.
- `raw/shp/<월>/` 연속수치지도 SHP 원본
- `api_cache/<월>.json` 건축물대장 API 정상 응답 캐시 (페이지 단위)
- `api_errors/<월>/` API 오류 격리 (정상 캐시와 분리 — 안전장치 D)
- `master/` 코드 마스터 (법정동·도로명·용도·구조)

### Silver — 정제·통합 계층
- Bronze를 정제·검증·결합한 **건물 단위 정규 레코드**. 모든 건물 1행씩(미매칭 포함).
- `snapshots/<월>.json` 월별 통합 스냅샷 *(Phase 2: JSON → Phase 3: Parquet 전환)*
- `changes/` 월간 변경분 (신축·멸실·속성변경) *(Phase 3)*
- `quality_reports/<월>.md` 빌드 시 자동 생성되는 품질 리포트

### Gold — 제공 계층
- 용도별 최종 산출물. 소비자(지도·점수·API)별로 가공한 뷰.
- `geojson/paldal_<월>.geojson` 월별 GeoJSON, `paldal_current.geojson` 최신 포인터
- `scores/` 그린리모델링 우선순위 점수 *(Phase 4)*
- `api/` 정적 API 산출물 *(Phase 5)*

**원칙**: Silver는 *완전*(전체 건물), Gold는 *목적별 부분뷰*. Gold는 항상 Silver에서 파생.

---

## 3. 디렉토리 구조

```
green-remodeling-map/
├── build/
│   ├── bronze/
│   │   ├── raw/shp/<월>/        연속수치지도 SHP 원본 (월별, 빌드 시 생성)
│   │   ├── api_cache/<월>.json  건축물대장 정상 응답 캐시
│   │   ├── api_errors/<월>/     API 오류 격리
│   │   └── master/             코드 마스터
│   ├── silver/
│   │   ├── snapshots/<월>.json  통합 스냅샷
│   │   ├── changes/<월>.json    월간 변경분 (Phase 3)
│   │   └── quality_reports/<월>.md
│   └── gold/
│       ├── geojson/            paldal_<월>.geojson · paldal_current.geojson
│       ├── scores/             우선순위 점수 (Phase 4)
│       └── api/                정적 API (Phase 5)
├── docs/
│   ├── data_engineering_plan.md   (본 문서)
│   └── schema_v1.md               Silver 스키마 정의
└── scripts/build/
    ├── identity_resolver.mjs      도로명키 생성, BJCD 처리
    ├── fetchers/buildingHub.mjs   법정동 일괄 다운로드·페이지네이션·캐시
    ├── transforms/
    │   ├── reproject.mjs          EPSG:5179→WGS84, 폴리곤 면적 (v1 검증 코드)
    │   ├── match_engine.mjs       도로명 매칭·카디널리티
    │   └── attribute_join.mjs     Silver 레코드 빌드
    ├── quality/
    │   ├── validators.mjs         필드 유효성 검증
    │   └── report_generator.mjs   quality_report 자동 생성
    ├── emit/
    │   ├── geojson.mjs            Gold GeoJSON
    │   └── summary_stats.mjs      요약 통계
    └── pipeline.mjs               전체 흐름 오케스트레이션 (실행 진입점)
```

`build/build_targets.mjs`(v1)는 **롤백·비교용으로 보존**한다. 신규 시스템의 진입점은
`scripts/build/pipeline.mjs`다.

---

## 4. Phase 1~5 로드맵

| Phase | 명칭 | 범위 | 상태 |
|-------|------|------|------|
| **1** | Foundation | Bronze/Silver/Gold 스캐폴딩, 도로명 매칭 엔진, 단일 스냅샷 GeoJSON. **우만동 시범 빌드로 검증.** | 본 작업에서 구축 |
| **2** | Operational pipeline | 팔달구 22개 동 전체, 월별 스냅샷, 품질 리포트 자동화, 매칭 신뢰도 필드, `paldal_current` 포인터, 코드 마스터 산출. | **즉시 적용** — 본 작업에서 구축 |
| **3** | Change detection & history | 월별 스냅샷 diff(`silver/changes/`) — 신축·멸실·속성변경 추적, 시계열, **스냅샷 Parquet 전환**. | 예정 |
| **4** | Scoring & enrichment | 그린리모델링 우선순위 점수(`gold/scores/`), L4 보강데이터(에너지효율·용도지역·공시지가) 결합, 폴리곤 품질 보정. | 예정 |
| **5** | Serving & automation | `gold/api/` 정적 API 산출, 매월 자동 스케줄 갱신, 모니터링·알림, 운영 대시보드. | 예정 |

Phase 1·2는 한 번의 작업으로 함께 구축한다(코드는 처음부터 월별 갱신 가능 구조로 작성).
Phase 3~5는 디렉토리만 미리 만들어 두고 단계적으로 채운다.

### Phase 3 고려사항 (메모)

향후 Phase 3 진입 시 검토할 사항을 누적 기록한다.

- **N:1·N:M 카디널리티 dedupe 정책 검토 필요** — 매칭 건물의 약 38%(N:1 22% + N:M
  16%, 우만동 시범 기준)가 한 표제부에 여러 폴리곤이 붙는 구조다. ROI·점수 산정 시
  동일 건물의 중복 집계를 막을 dedupe(대표 폴리곤 선정 등) 정책이 필요하다. v1 에서는
  처리하지 않는다.

---

## 5. 갱신 주기 매트릭스

| 데이터 | 계층 | 갱신 주기 | 갱신 방식 | 트리거 |
|--------|------|-----------|-----------|--------|
| 연속수치지도 건물(L1) | Bronze | 분기~반기 | 수동 다운로드 후 `raw/shp/<월>/` 배치 | NGII 갱신 시 |
| 건축물대장 표제부(L2) | Bronze | **매월** | API 일괄 다운로드 (자동) | 매월 스케줄 |
| 코드 마스터(L3) | Bronze | 매월 | 빌드 부수 산출 (자동) | 빌드 시 |
| 통합 스냅샷(L5) | Silver | **매월** | `pipeline.mjs` 실행 (자동) | 매월 스케줄 |
| 품질 리포트 | Silver | 매월 | 빌드 부수 산출 (자동) | 빌드 시 |
| 변경분(L5) | Silver | 매월 | 전월 스냅샷과 diff (자동, Phase 3) | 빌드 시 |
| Gold GeoJSON/점수/API | Gold | **매월** | Silver에서 파생 (자동) | 빌드 시 |
| 보강데이터(L4) | Bronze | 분기 | 수동/반자동 (Phase 4) | 출처 갱신 시 |

핵심: **L1(공간)은 느리게(분기), L2(대장)는 매월** 갱신된다. 매월 빌드는 최신 L2와
기존 L1을 결합해 새 스냅샷을 만든다.

---

## 6. 자동화 인프라 설계

```
[매월 1일 스케줄러]
   │  (cron / GitHub Actions / Claude Code /schedule)
   ▼
[pipeline.mjs --month=YYYY_MM]
   ├─ Bronze : SHP 로드 + 건축물대장 API 일괄 다운로드(캐시·오류격리)
   ├─ Silver : 도로명 매칭 → 통합 스냅샷 → 품질 검증 → quality_report
   │           └─ (Phase 3) 전월 스냅샷과 diff → changes/
   └─ Gold   : GeoJSON → (Phase 4) scores → (Phase 5) api
   ▼
[검증 게이트] quality_report 의 매칭률·결측률이 임계 이하면 알림·중단
   ▼
[배포] paldal_current.geojson 갱신 → 페이지 반영
```

- **스케줄러**: 1차로 GitHub Actions의 `schedule` 또는 Claude Code `/schedule` 루틴.
- **멱등성**: 같은 `--month`으로 재실행해도 캐시 덕분에 동일 결과·저비용.
- **실패 안전**: 페이지네이션 검증 실패·임계 미달 시 빌드 중단, `api_errors/`·리포트로
  원인 추적. 직전 정상 `paldal_current`는 보존.
- **비용**: 월 API 호출 ≈ 168회(팔달구 22개 동). data.go.kr 일 한도(1만) 내 충분.

---

## 7. 핵심 식별·매칭 규칙

### 7.1 도로명 조인키
- **건물(L1)**: `"41115" + RDNM(7자리 도로명코드) + "-" + BONU(건물본번) + "-" + BUNU(건물부번)`
- **표제부(L2)**: `naRoadCd(12자리) + "-" + naMainBun + "-" + naSubBun`
- `"41115" + RDNM` == `naRoadCd` 이면 동일 도로명주소 → 매칭.

### 7.2 매칭 상태 (`match_status`)
| 값 | 의미 |
|----|------|
| `matched` | 도로명키로 표제부 매칭 성공 |
| `no_road_address` | 건물에 RDNM 없음 → 조인 불가 |
| `road_no_match` | 도로명키는 있으나 표제부에 해당 키 없음 |

### 7.3 매칭 카디널리티 (`match_cardinality`)
한 도로명키에 매핑된 **건물 폴리곤 수 P** 와 **표제부 레코드 수 T** 로 분류.
`1:1` / `1:N`(P=1,T>1) / `N:1`(P>1,T=1) / `N:M`(P>1,T>1).
`polygon_arch_ratio` 는 **1:1 일 때만** 산출한다.

### 7.4 대표 표제부 선택
한 도로명키에 표제부가 여럿이면 **주건축물(`mainAtchGbCd='0'`) 우선, 그중 연면적 최대** 1건.

---

## 8. 품질 관리

매 빌드는 `silver/quality_reports/<월>.md` 를 자동 생성한다. 포함 항목:

- 총 건물 수, 매칭 통계(matched/no_road_address/road_no_match)
- 필드별 결측률
- 매칭 신뢰도 분포(카디널리티 1:1 / 1:N / N:1 / N:M)
- 이상치 — **`polygon_arch_ratio` 의 Tukey IQR 펜스 밖** (`area_mismatch`). 펜스 값(Q1·Q3·
  IQR·상하한)을 리포트와 스냅샷 `meta.outlier_fence` 에 기록
- 사용승인일 분포 히스토그램(0-15 / 15-25 / 25-35 / 35년+)
- 페이지네이션 검증 결과 · 법정동 수신 성공/실패

#### 면적 비교의 정확한 정의 (D4)
- **연면적(`totArea` → `gross_floor_area`)** 은 표제부에 정상 존재하며, 그린리모델링
  **대상 선정 기준(500㎡ 이상)에 그대로 사용**된다.
- **D4 이상치 검증에서만** 폴리곤(1층 윤곽)과 차원이 일치하는 **건축면적(`archArea` →
  `arch_area`)** 을 비교 대상으로 쓴다. 연면적은 전 층 합이라 폴리곤과 차원이 다르다.
- 두 값은 동일 표제부 API 응답에서 함께 수신되므로 추가 호출이 없다.
- 자세한 면적 4종 구분은 `docs/schema_v1.md` 「면적 필드」 절 참조.

#### 검증·실패 정책
- **페이지네이션**: 동별 `totalCount` vs 수신 건수 불일치 → 해당 **법정동만 실패 처리**
  (그 동 건물은 `dong_fetch_failed` 표기·매칭 불가), 나머지 동은 진행.
- **부분 실패 허용**: 매월 자동 갱신 안정성을 위해 한 동 실패로 전체를 중단하지 않는다.
  단 법정동 실패율이 임계(50%) 이상이면 시스템적 문제로 보고 **전체 중단**.
- **필드 유효성** 위반은 `quality_flags` 로 레코드에 표기하되 빌드는 진행.
- 모든 임계값은 `config/target_criteria.json` 단일 출처에서 읽는다(코드 하드코딩 금지).

---

## 9. 결정 기록 · 가정

| # | 결정/가정 | 근거 |
|---|-----------|------|
| D1 | 스냅샷은 **JSON으로 시작**, Phase 3에서 Parquet 전환 | 기획서 "JSON으로 시작" 명시, 추가 의존성 회피. `emit`/스냅샷 IO를 모듈화해 전환 비용 최소화 |
| D2 | `paldal_current` 는 **복사(copy)** 로 갱신 | Windows 심볼릭링크는 권한 의존, copy가 안전 |
| D3 | Gold GeoJSON 포함 범위 = **대상 건물 + 미매칭 건물**, 매칭-기준미달은 제외 (`INCLUDE_MATCHED_NON_TARGET=false`) | "대상 지도" 성격 유지 + "매칭 실패 회색 표시" 요구 반영. 토글 1개로 전환 가능 |
| D4 | 이상치 검사 비교 대상 = `arch_area`(건축면적). 비율 필드명 `polygon_arch_ratio` | 폴리곤(1층 윤곽)과 차원이 일치하는 값. 연면적(`gross_floor_area`)은 대상 선정 기준으로 별도 사용 |
| D5 | 이번 스냅샷 월 = `2026_05` | 기획 시점 기준. `--month=YYYY_MM` 로 변경 가능 |
| D6 | 연속수치지도 SHP는 분기성 데이터라 월 디렉토리에 동일 원본을 재사용 가능 | L1 갱신 주기가 L2보다 느림 |
| D7 | 모든 임계값을 `config/target_criteria.json` 단일 출처로 분리 | Phase 3 ROI 기반 대상 개편 시 코드 무수정. 코드 내 하드코딩 금지 |
| D8 | 표제부 캐시는 **법정동 단위 파일**(`api_cache/<월>/<법정동>.json`) | 동 코드는 불변이라 월간 diff·감사에 안정적 (페이지 경계는 매월 이동) |
| D9 | 부분 실패 허용 + 실패율 50% 임계 시 전체 중단 | 매월 자동 갱신이 한 동 실패로 깨지지 않도록 |
| D10 | D4 이상치 판정 = **Tukey IQR 펜스** (고정 5% 폐기) | 폴리곤이 건축면적보다 체계적으로 큼(중앙값 ~1.2). 고정 비율은 90% 오탐. 자기보정 방식이 월별 갱신·시계열에 적합. 펜스 값은 스냅샷 메타에 저장 |

본 문서 변경 시 버전을 올리고 변경 이력을 이 절에 남긴다.
