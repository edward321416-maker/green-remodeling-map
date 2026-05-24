/**
 * Top 우선순위 순위표 — STEP 4-E-1 (정적 표 + dedup + 정렬 + Top 50/100 토글)
 *
 * 데이터 출처: build/gold/geojson/paldal_current.geojson (4-D 산출물)
 * - is_target=true 4,309 폴리곤 → match_key 기준 dedup (대표 = 폴리곤 면적 최대)
 * - 기본 정렬: priority_score desc, 동점 시 grossFloorArea desc
 * - 칼럼 헤더 클릭으로 재정렬 (aria-sort 동기화)
 * - "Top 100 더보기" 토글로 50↔100 행
 *
 * 별도 fetch — app.js 와 데이터 공유하지 않음 (app.js 건드림 방지).
 * 브라우저 디스크 캐시로 두 번째 fetch 는 즉시 응답.
 *
 * 4-E-2 에서 추가될 것: CSV 다운로드, 행 클릭 → 지도 zoom·highlight, 모바일 카드 변환, ARIA 보강.
 */
(function () {
  'use strict';

  var GEOJSON_URL = 'build/gold/geojson/paldal_current.geojson';

  var state = {
    rows: [],
    sortKey: 'priority_score',
    sortDir: 'desc',
    showCount: 50,
    totalGroups: 0,
    polygonCount: 0,
  };

  fetch(GEOJSON_URL, { cache: 'force-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(init)
    .catch(function (err) {
      console.warn('[ranking] GeoJSON 로드 실패: ' + err.message);
      showError('순위표 데이터를 불러오지 못했습니다 — ' + err.message);
    });

  // ── 초기화 ─────────────────────────────────────────────────
  function init(data) {
    if (!data || !Array.isArray(data.features)) {
      showError('GeoJSON 형식 오류');
      return;
    }
    var targets = data.features.filter(function (f) {
      return f.properties && f.properties.is_target === true;
    });
    state.polygonCount = targets.length;

    var deduped = dedupByMatchKey(targets);
    state.totalGroups = deduped.length;
    state.rows = deduped.map(toRow);

    sortRows();
    render();
    wireControls();

    console.log('[ranking] 폴리곤 ' + state.polygonCount
      + ' → 표제부 그룹 ' + state.totalGroups + ' (dedup match_key 기준)');
  }

  // ── dedup ──────────────────────────────────────────────────
  /** match_key 별로 그룹화. 대표 = polygon_area_m2 가 가장 큰 폴리곤. */
  function dedupByMatchKey(features) {
    var groups = new Map();
    features.forEach(function (f) {
      var key = f.properties.match_key;
      if (!key) return;                      // 안전 — 실데이터엔 null 없음
      var prev = groups.get(key);
      if (!prev) { groups.set(key, f); return; }
      var newArea = f.properties.polygon_area_m2 || 0;
      var prevArea = prev.properties.polygon_area_m2 || 0;
      if (newArea > prevArea) groups.set(key, f);
    });
    return Array.from(groups.values());
  }

  // ── 행 데이터 변환 ─────────────────────────────────────────
  function toRow(f) {
    var p = f.properties;
    var address = p.address || '';
    var dongMatch = address.match(/\(([^)]+)\)/);
    return {
      feature: f,                            // 4-E-2 지도 인터랙션용 보존
      bldgName: pickName(p),
      dong: dongMatch ? dongMatch[1] : '—',
      approvalYear: p.approvalYear || null,
      buildingAge: typeof p.buildingAge === 'number' ? p.buildingAge : null,
      grossFloorArea: typeof p.grossFloorArea === 'number' ? p.grossFloorArea : null,
      mainUse: p.mainUse || '—',
      priority_score: typeof p.priority_score === 'number' ? p.priority_score : null,
      match_key: p.match_key,
    };
  }

  /** 건물명 누락 시 도로명주소 → "(이름없음)" 폴백 */
  function pickName(p) {
    if (p.bldgName) return p.bldgName;
    if (p.roadAddress) return p.roadAddress;
    if (p.address) return p.address;
    return '(이름없음)';
  }

  // ── 정렬 ───────────────────────────────────────────────────
  function sortRows() {
    var key = state.sortKey;
    var dir = state.sortDir === 'desc' ? -1 : 1;
    state.rows.sort(function (a, b) {
      var cmp = compareField(a[key], b[key]) * dir;
      if (cmp !== 0) return cmp;
      // 동점 시 — priority_score 기준 정렬일 때만 gfa desc 로 2차 정렬
      if (key === 'priority_score') {
        return (b.grossFloorArea || 0) - (a.grossFloorArea || 0);
      }
      return 0;
    });
  }

  function compareField(va, vb) {
    if (va == null && vb == null) return 0;
    if (va == null) return 1;                // null 항상 마지막
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return va - vb;
    return String(va).localeCompare(String(vb), 'ko');
  }

  // ── 렌더 ───────────────────────────────────────────────────
  function render() {
    renderContext();
    renderRows();
    renderShowMore();
    updateAriaSort();
  }

  function renderContext() {
    var el = document.getElementById('ranking-context');
    if (!el) return;
    el.textContent = '총 ' + state.totalGroups.toLocaleString() + '개 건물 그룹 ('
      + state.polygonCount.toLocaleString() + ' 폴리곤) — '
      + '한 표제부에 여러 폴리곤이 붙는 대형 단지·복합건물은 그룹으로 통합';
  }

  function renderRows() {
    var tbody = document.getElementById('ranking-tbody');
    if (!tbody) return;
    var slice = state.rows.slice(0, state.showCount);
    if (!slice.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="ranking-loading">표시할 데이터가 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = slice.map(function (r, i) {
      var rank = i + 1;
      var isElite = typeof r.priority_score === 'number' && r.priority_score >= 80;
      var score = typeof r.priority_score === 'number' ? r.priority_score.toFixed(1) : '—';
      var ariaLabel = '순위 ' + rank + ', ' + r.bldgName
        + ', 경과 ' + (r.buildingAge != null ? r.buildingAge + '년' : '미상')
        + ', 연면적 ' + (r.grossFloorArea != null ? Math.round(r.grossFloorArea).toLocaleString() + '제곱미터' : '미상')
        + ', 주용도 ' + r.mainUse + ', 점수 ' + score + ', 지도에서 보기';
      return '<tr' + (isElite ? ' class="is-elite"' : '')
        + ' tabindex="0" role="button"'
        + ' aria-label="' + escapeHtml(ariaLabel) + '"'
        + ' data-match-key="' + escapeHtml(r.match_key || '') + '">'
        + '<td class="col-rank">' + rank + '</td>'
        + '<td class="col-name">' + escapeHtml(r.bldgName) + '</td>'
        + '<td class="col-dong">' + escapeHtml(r.dong) + '</td>'
        + '<td class="col-yr">' + (r.approvalYear || '—') + '</td>'
        + '<td class="col-age">' + (r.buildingAge != null ? r.buildingAge + '년' : '—') + '</td>'
        + '<td class="col-gfa">' + (r.grossFloorArea != null ? Math.round(r.grossFloorArea).toLocaleString() + '㎡' : '—') + '</td>'
        + '<td class="col-use">' + escapeHtml(r.mainUse) + '</td>'
        + '<td class="col-score">' + score + '</td>'
        + '</tr>';
    }).join('');
  }

  function renderShowMore() {
    var btn = document.getElementById('ranking-more');
    if (!btn) return;
    if (state.rows.length <= 50) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.textContent = state.showCount === 50
      ? 'Top 100 더보기 ▼'
      : 'Top 50 만 보기 ▲';
  }

  function updateAriaSort() {
    document.querySelectorAll('#ranking-table thead th[data-sort]').forEach(function (th) {
      var key = th.dataset.sort;
      th.setAttribute('aria-sort',
        key === state.sortKey
          ? (state.sortDir === 'desc' ? 'descending' : 'ascending')
          : 'none');
    });
  }

  // ── 이벤트 바인딩 ──────────────────────────────────────────
  function wireControls() {
    var more = document.getElementById('ranking-more');
    if (more) {
      more.addEventListener('click', function () {
        state.showCount = state.showCount === 50 ? Math.min(100, state.rows.length) : 50;
        more.setAttribute('aria-expanded', state.showCount > 50 ? 'true' : 'false');
        render();
      });
      more.setAttribute('aria-expanded', 'false');
    }

    document.querySelectorAll('#ranking-table thead th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          state.sortKey = key;
          state.sortDir = 'desc';
        }
        sortRows();
        render();
      });
    });

    // 행 클릭·키보드 → 지도 포커스 이벤트 dispatch (event delegation)
    var tbody = document.getElementById('ranking-tbody');
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        var tr = e.target.closest('tr[data-match-key]');
        if (tr) focusBuilding(tr.dataset.matchKey);
      });
      tbody.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var tr = e.target.closest('tr[data-match-key]');
        if (!tr) return;
        e.preventDefault();
        focusBuilding(tr.dataset.matchKey);
      });
    }

    // CSV 다운로드 버튼 활성화 + 동작
    var csvBtn = document.getElementById('ranking-csv');
    if (csvBtn) {
      csvBtn.removeAttribute('disabled');
      csvBtn.setAttribute('aria-label',
        state.totalGroups.toLocaleString() + '개 건물 그룹 CSV 다운로드');
      csvBtn.textContent = 'CSV 전체 다운로드 (' + state.totalGroups.toLocaleString() + '개)';
      csvBtn.addEventListener('click', downloadCsv);
    }
  }

  // ── 행 클릭 → 지도 포커스 ─────────────────────────────────
  function focusBuilding(matchKey) {
    if (!matchKey) return;
    // 지도 섹션으로 부드러운 스크롤
    var mapSection = document.getElementById('map-section');
    if (mapSection) {
      mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // app.js 가 등록한 listener 로 zoom + highlight 처리
    window.dispatchEvent(new CustomEvent('greenmap:focus', {
      detail: { match_key: matchKey },
    }));
  }

  // ── CSV 다운로드 ──────────────────────────────────────────
  /** CSV 는 사용자 정렬 상태와 무관하게 항상 priority desc 로 export */
  function downloadCsv() {
    var sorted = state.rows.slice().sort(function (a, b) {
      var sa = a.priority_score == null ? -Infinity : a.priority_score;
      var sb = b.priority_score == null ? -Infinity : b.priority_score;
      if (sb !== sa) return sb - sa;
      return (b.grossFloorArea || 0) - (a.grossFloorArea || 0);
    });

    var headers = [
      '순위', '건물명', '도로명주소', '사용승인일', '경과연수', '연면적', '주용도', '동', '점수',
      '구조', '지상층수', '지하층수', '세대수', 'match_status', 'match_cardinality',
      'priority_components_age', 'priority_components_area', 'priority_components_use',
    ];
    var lines = [headers.map(csvCell).join(',')];
    sorted.forEach(function (r, i) {
      var p = r.feature.properties;
      var c = p.priority_components || {};
      lines.push([
        i + 1,
        r.bldgName,
        p.roadAddress || '',
        p.approvalYear || '',
        r.buildingAge != null ? r.buildingAge : '',
        r.grossFloorArea != null ? r.grossFloorArea : '',
        r.mainUse,
        r.dong,
        r.priority_score != null ? r.priority_score.toFixed(1) : '',
        p.structure || '',
        p.floorsAbove != null ? p.floorsAbove : '',
        p.floorsBelow != null ? p.floorsBelow : '',
        p.households != null ? p.households : '',
        p.match_status || '',
        p.match_cardinality || '',
        c.age != null ? c.age : '',
        c.area != null ? c.area : '',
        c.use != null ? c.use : '',
      ].map(csvCell).join(','));
    });

    var csv = lines.join('\r\n');
    // UTF-8 BOM (U+FEFF) — Excel 이 한글 CSV 를 정확히 디코딩하도록
    var BOM = String.fromCharCode(0xFEFF);
    var blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'paldal_green_remodeling_targets_2026_05.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

    // 시각 피드백
    var btn = document.getElementById('ranking-csv');
    if (btn) {
      var orig = btn.textContent;
      btn.textContent = '다운로드됨 ✓';
      setTimeout(function () { btn.textContent = orig; }, 2000);
    }
    console.log('[ranking] CSV 다운로드: ' + sorted.length + '행, ' + (blob.size / 1024).toFixed(1) + ' KB');
  }

  function csvCell(v) {
    var s = String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // ── 유틸 ───────────────────────────────────────────────────
  function showError(msg) {
    var tbody = document.getElementById('ranking-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="ranking-loading">' + escapeHtml(msg) + '</td></tr>';
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
})();
