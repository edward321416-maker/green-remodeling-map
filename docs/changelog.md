# 변경 이력 (Changelog)

수원시 팔달구 그린리모델링 데이터 파이프라인의 변경 이력. 최신 항목이 위.
기준 문서: [data_engineering_plan.md](./data_engineering_plan.md) · [schema_v1.md](./schema_v1.md)

---

## Phase 1 — 2026-05-22 · 첫 빌드 완료

Bronze·Silver·Gold 메달리온 데이터 파이프라인(Phase 1+2)을 구축하고
**2026_05 첫 스냅샷**을 생성했다. 향후 월별 갱신의 시계열 기준점.

### 빌드 결과 (2026_05 · 수원시 팔달구 전체)
- 건물 25,302동 · 건축물대장 표제부 15,564건 · 법정동 22/22 수신 성공
- 도로명 매칭 76.3% (19,301동)
- **최종 그린리모델링 대상(준공 15년 경과 + 연면적 500㎡ 이상): 4,309동**
- 빌드 소요 37초 · 피크 메모리 380 MB

### 추가된 것
- 모듈형 파이프라인 `scripts/build/` — identity_resolver, fetchers/buildingHub,
  transforms/{reproject, match_engine, attribute_join}, quality/{validators,
  report_generator}, emit/{geojson, summary_stats}, pipeline.mjs
- Bronze/Silver/Gold 디렉토리 구조 (`build/bronze`·`silver`·`gold`)
- 임계값 단일 출처 `config/target_criteria.json`
- 도로명 기반 매칭 엔진 (RDNM+BONU+BUNU ⋈ 표제부 naRoadCd+naMainBun+naSubBun)
- 건축물대장 표제부 법정동 단위 일괄 다운로드 + 페이지네이션 검증 + 법정동별 캐시
- Tukey IQR 이상치 검증 (`area_mismatch`) — 스냅샷 메타에 펜스 저장
- 품질 리포트 자동 생성 (`silver/quality_reports/<월>.md`)
- 부분 실패 정책 — 한 법정동 실패 시 스킵·계속, 실패율 50% 임계
- 산출물: `silver/snapshots/2026_05.json`, `gold/geojson/paldal_2026_05.geojson`,
  `paldal_current.geojson`, 코드 마스터 `bronze/master/codes_2026_05.json`

### 메모
- `build/build_targets.mjs`(v1)는 롤백·비교용으로 보존.
- 주요 설계 결정은 data_engineering_plan.md §9 (D1~D10) 참조.
- 미해결: 페이지 연결(index.html → gold GeoJSON)은 별도 단계에서 검토.
