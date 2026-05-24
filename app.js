/* 수원시 팔달구 그린리모델링 대상 건축물 지도 — 페이지 로직 (classic script) */
(function () {
  'use strict';

  // 빌드 산출물(Gold GeoJSON). index.html 위치 기준 상대경로.
  var GEOJSON_URL = 'build/gold/geojson/paldal_current.geojson';

  // ── 데이터 로드: 실데이터(fetch) → 실패 시 샘플 데이터로 폴백 ──────────
  var t0 = (window.performance || Date).now();
  fetch(GEOJSON_URL, { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var len = res.headers.get('content-length');
      window.__geojsonBytes = len ? parseInt(len, 10) : null;
      return res.json();
    })
    .then(function (data) {
      if (!data || !Array.isArray(data.features)) throw new Error('GeoJSON 형식 오류');
      var ms = ((window.performance || Date).now() - t0).toFixed(0);
      console.log('[green-map] 실데이터 로드 성공 · ' + GEOJSON_URL
        + ' · ' + data.features.length.toLocaleString() + ' 피처'
        + (window.__geojsonBytes ? ' · ' + (window.__geojsonBytes / 1048576).toFixed(2) + ' MB' : '')
        + ' · fetch ' + ms + 'ms');
      init(data, false);
    })
    .catch(function (err) {
      console.warn('[green-map] 실데이터 로드 실패: ' + err.message + ' → 샘플 데이터로 대체');
      var sample = window.GREEN_TARGETS_SAMPLE;
      if (sample && Array.isArray(sample.features)) {
        init(sample, true);
      } else {
        showFatal('데이터를 불러오지 못했습니다',
          GEOJSON_URL + ' 로드에 실패했고 샘플 데이터도 없습니다. '
          + '로컬 또는 호스팅 서버로 페이지를 열었는지 확인하세요 (file:// 에서는 fetch 가 막힙니다).');
      }
    });

  // ── 초기화 ───────────────────────────────────────────────────────────
  function init(data, usingSample) {
    if (usingSample) {
      showBanner('⚠ 실데이터를 불러오지 못해 샘플 데이터를 표시 중입니다. '
        + 'build/gold/geojson/paldal_current.geojson 을 로컬/호스팅 서버로 열어주세요.');
    }

    // ── 피처 정규화 ──
    var features = data.features.map(function (f, i) {
      var p = f.properties || {};
      return {
        id: i,
        feature: { type: 'Feature', geometry: f.geometry, properties: p },
        props: p,
        age: typeof p.buildingAge === 'number' ? p.buildingAge : null,
        gfa: typeof p.grossFloorArea === 'number' ? p.grossFloorArea : null,
        use: p.mainUse || '용도 미상',
      };
    });

    // ── 지도 초기화 ──
    var map = L.map('map', { preferCanvas: true, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    var geoLayer = L.geoJSON(null, {
      style: featureStyle,
      onEachFeature: bindFeature,
    }).addTo(map);

    // 초기 뷰: 전체 데이터 범위
    var b = dataBounds(features);
    if (b) map.fitBounds(b, { padding: [40, 40] });
    else map.setView([37.2814, 127.0135], 15);

    addLegend();
    // STEP 5-B: 데이터셋 패널 제거됨 (분석 섹션이 흡수). fillDatasetPanel 호출 삭제.

    // ── 필터 상태 ──
    var filterState = { ageMin: 15, gfaMin: 500, uses: {}, includeUnknown: false };
    var useNames = uniqueSorted(features.map(function (f) { return f.use; }));
    useNames.forEach(function (u) { filterState.uses[u] = true; });

    buildUseChecks(useNames);
    wireControls();

    console.time('[green-map] 초기 렌더');
    render();
    console.timeEnd('[green-map] 초기 렌더');

    // STEP 6-B: 로딩 스켈레톤 제거 (페이드 후 display:none)
    var section = document.getElementById('map-section');
    if (section) section.classList.remove('is-loading');

    // 외부 포커스 요청 — STEP 4-E-2 순위표 행 클릭 등
    // 같은 match_key 의 모든 폴리곤을 묶어 fitBounds + 1.5초 highlight.
    var focusTimer = null;
    var highlightedLayers = [];
    window.addEventListener('greenmap:focus', function (e) {
      var d = e.detail || {};
      if (!d.match_key) return;
      var layers = [];
      geoLayer.eachLayer(function (lyr) {
        if (lyr.feature && lyr.feature.properties.match_key === d.match_key) {
          layers.push(lyr);
        }
      });
      if (!layers.length) {
        console.warn('[green-map] focus: match_key 미발견', d.match_key);
        return;
      }
      // 이전 하이라이트 정리
      if (focusTimer) clearTimeout(focusTimer);
      highlightedLayers.forEach(function (lyr) {
        try { geoLayer.resetStyle(lyr); } catch (_) {}
      });
      // 묶음 bounds 로 zoom
      var grp = L.featureGroup(layers);
      map.flyToBounds(grp.getBounds(), { padding: [60, 60], maxZoom: 18, duration: 0.8 });
      // highlight
      layers.forEach(function (lyr) {
        lyr.setStyle({ weight: 5, color: '#047857', fillOpacity: 0.9 });
      });
      highlightedLayers = layers;
      focusTimer = setTimeout(function () {
        layers.forEach(function (lyr) {
          try { geoLayer.resetStyle(lyr); } catch (_) {}
        });
        highlightedLayers = [];
        focusTimer = null;
      }, 1500);
      // STEP 5-C·5-D: 상세 시트/슬라이드 함께 등장. 선택 상태 갱신.
      if (selectedLayer) geoLayer.resetStyle(selectedLayer);
      selectedLayer = layers[0];
      openDetail(layers[0].feature.properties);
    });

    // ── 렌더링 ──────────────────────────────────────────────────────────
    function passes(f) {
      if (f.age == null) {
        if (!filterState.includeUnknown) return false;   // 미확보(준공일 없음)
      } else if (f.age < filterState.ageMin) {
        return false;
      }
      if (f.gfa != null && f.gfa < filterState.gfaMin) return false;
      if (!filterState.uses[f.use]) return false;
      return true;
    }

    function render() {
      geoLayer.clearLayers();
      selectedLayer = null;
      var shown = features.filter(passes);
      if (shown.length) {
        geoLayer.addData({
          type: 'FeatureCollection',
          features: shown.map(function (f) { return f.feature; }),
        });
      }
      updateSummary(shown);
      if (shown.length === 0) showMapMsg('현재 필터 조건에 맞는 건물이 없습니다.');
      else hideMapMsg();
    }

    // ── 피처 상호작용 ──
    var selectedLayer = null;
    function bindFeature(feature, lyr) {
      lyr.on({
        click: function (e) {
          L.DomEvent.stopPropagation(e);                              // map click 까지 전파되어 자동 닫힘 방지
          selectLayer(lyr, feature.properties);
        },
        mouseover: function () {
          if (lyr !== selectedLayer) lyr.setStyle({ weight: 2.5, color: '#111827' });
        },
        mouseout: function () {
          if (lyr !== selectedLayer) geoLayer.resetStyle(lyr);
        },
      });
    }
    function selectLayer(lyr, props) {
      if (selectedLayer) geoLayer.resetStyle(selectedLayer);
      selectedLayer = lyr;
      lyr.setStyle({ weight: 3, color: '#047857' });
      openDetail(props);                                              // STEP 5-D: .is-open 패턴
    }

    function openDetail(p) {
      showDetail(p);                                                  // 내용 채움
      var card = document.getElementById('detail-card');
      card.classList.add('is-open');
      // 모바일: 필터 시트가 열려있으면 자동 닫기
      var fo = document.getElementById('filter-overlay');
      if (fo) fo.classList.remove('is-open');
    }

    function closeDetail() {
      var card = document.getElementById('detail-card');
      if (card) card.classList.remove('is-open');
      if (selectedLayer) { geoLayer.resetStyle(selectedLayer); selectedLayer = null; }
    }

    function toggleFilterSheet() {
      var fo = document.getElementById('filter-overlay');
      if (!fo) return;
      var willOpen = !fo.classList.contains('is-open');
      fo.classList.toggle('is-open', willOpen);
      if (willOpen) {                                                 // 모바일: 상세 시트 자동 닫기
        var card = document.getElementById('detail-card');
        if (card) card.classList.remove('is-open');
      }
    }

    // ── 요약 (현재 필터 기준) — STEP 5-B: 사이드바 → 통계 칩 ──
    function updateSummary(shown) {
      var withAge = shown.filter(function (f) { return f.age != null; });
      var avgAge = withAge.length
        ? Math.round(withAge.reduce(function (s, f) { return s + f.age; }, 0) / withAge.length)
        : null;
      var withGfa = shown.filter(function (f) { return f.gfa != null; });
      var avgGfa = withGfa.length
        ? Math.round(withGfa.reduce(function (s, f) { return s + f.gfa; }, 0) / withGfa.length)
        : null;

      var elCount = document.getElementById('stat-count');
      var elAge   = document.getElementById('stat-avg-age');
      var elGfa   = document.getElementById('stat-avg-gfa');
      if (elCount) elCount.textContent = shown.length.toLocaleString();
      if (elAge)   elAge.textContent   = avgAge != null ? avgAge : '—';
      if (elGfa)   elGfa.textContent   = avgGfa != null ? avgGfa.toLocaleString() : '—';
    }

    // ── 상세 패널 ──
    function showDetail(p) {
      var card = document.getElementById('detail-card');
      var matched = (p.match_status === 'matched' || p.match_status == null);
      document.getElementById('detail-name').textContent = p.bldgName || '(이름 없음)';

      var rows;
      if (!matched) {
        var reason = p.match_status === 'no_road_address'
          ? '도로명주소 없음 — 건축물대장 조회 불가'
          : '도로명주소는 있으나 건축물대장 미발견';
        rows = [
          ['상태', '<span class="badge badge-unverified">정보 미확보</span>'],
          ['사유', reason],
          ['상태코드', p.match_status || '—'],
          ['데이터', p.data_source || 'shp_only'],
          ['폴리곤 면적', p.polygon_area_m2 != null ? num(p.polygon_area_m2) + ' ㎡' : '—'],
          ['SHP 층수', dash(p.shpFloors)],
        ];
      } else {
        var approval = p.approvalYear != null
          ? p.approvalYear + '년' +
            (typeof p.buildingAge === 'number' ? ' (경과 ' + p.buildingAge + '년)' : '')
          : '미상';
        rows = [
          ['주소', p.address || '—'],
          ['사용승인', approval],
          ['연면적', p.grossFloorArea != null ? num(p.grossFloorArea) + ' ㎡' : '—'],
          ['주용도', p.mainUse || '—'],
          ['구조', p.structure || '—'],
          ['층수', '지상 ' + dash(p.floorsAbove) + ' / 지하 ' + dash(p.floorsBelow)],
          ['높이', p.height ? p.height + ' m' : '—'],
          ['세대수', p.households != null ? num(p.households) + ' 세대' : '—'],
          ['매칭', p.match_cardinality ? p.match_cardinality + ' (도로명 매칭)' : '도로명 매칭'],
        ];
      }
      document.getElementById('detail').innerHTML = rows
        .map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; })
        .join('');
      card.hidden = false;
    }
    // 닫기 트리거 3종 (STEP 5-C)
    document.getElementById('detail-close').addEventListener('click', closeDetail);
    map.on('click', closeDetail);                                     // 지도 빈 영역 클릭
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeDetail();
        var fo = document.getElementById('filter-overlay');
        if (fo) fo.classList.remove('is-open');                       // 필터 시트도 ESC 로 닫기
      }
    });

    // STEP 5-D: 필터 트리거 (모바일) + 시트 드래그
    var filterTrigger = document.getElementById('filter-trigger');
    if (filterTrigger) filterTrigger.addEventListener('click', toggleFilterSheet);

    // 시트 핸들 — 클릭(닫기) + 드래그(아래로 끌어 닫기)
    var sheets = [
      { el: document.getElementById('filter-overlay'), close: function () {
          this.el && this.el.classList.remove('is-open');
        } },
      { el: document.getElementById('detail-card'), close: closeDetail },
    ];
    sheets.forEach(function (s) {
      if (!s.el) return;
      var handle = s.el.querySelector('.sheet-handle');
      if (!handle) return;
      // 클릭으로 닫기
      handle.addEventListener('click', function (e) {
        e.preventDefault();
        s.close.call(s);
      });
      // 터치 드래그 — 아래로 30%+ 끌면 닫기
      var startY = 0, dragging = false, height = 0;
      handle.addEventListener('touchstart', function (e) {
        if (!s.el.classList.contains('is-open')) return;
        startY = e.touches[0].clientY;
        height = s.el.offsetHeight;
        dragging = true;
        s.el.style.transition = 'none';
      }, { passive: true });
      handle.addEventListener('touchmove', function (e) {
        if (!dragging) return;
        var delta = e.touches[0].clientY - startY;
        if (delta > 0) s.el.style.transform = 'translateY(' + delta + 'px)';
      }, { passive: true });
      handle.addEventListener('touchend', function (e) {
        if (!dragging) return;
        dragging = false;
        var delta = e.changedTouches[0].clientY - startY;
        s.el.style.transition = '';
        s.el.style.transform = '';
        if (delta > height * 0.3) s.close.call(s);
      });
    });

    // ── 필터 UI ──
    function buildUseChecks(names) {
      var box = document.getElementById('use-list');
      box.innerHTML = '';
      names.forEach(function (name) {
        var id = 'use-' + cssSafe(name);
        var label = document.createElement('label');
        label.innerHTML =
          '<input type="checkbox" id="' + id + '" checked /> ' + escapeHtml(name);
        label.querySelector('input').addEventListener('change', function (e) {
          filterState.uses[name] = e.target.checked;
          render();
        });
        box.appendChild(label);
      });
    }

    function wireControls() {
      var ageSlider = document.getElementById('age-slider');
      var gfaSlider = document.getElementById('gfa-slider');
      var unknown = document.getElementById('unknown-toggle');

      ageSlider.addEventListener('input', function () {
        filterState.ageMin = +ageSlider.value;
        document.getElementById('age-val').textContent = ageSlider.value;
        render();
      });
      gfaSlider.addEventListener('input', function () {
        filterState.gfaMin = +gfaSlider.value;
        document.getElementById('gfa-val').textContent = (+gfaSlider.value).toLocaleString();
        render();
      });
      unknown.addEventListener('change', function () {
        filterState.includeUnknown = unknown.checked;
        render();
      });
      document.getElementById('reset-btn').addEventListener('click', function () {
        filterState.ageMin = 15;
        filterState.gfaMin = 500;
        filterState.includeUnknown = false;
        useNames.forEach(function (u) { filterState.uses[u] = true; });
        ageSlider.value = 15; document.getElementById('age-val').textContent = '15';
        gfaSlider.value = 500; document.getElementById('gfa-val').textContent = '500';
        unknown.checked = false;
        document.querySelectorAll('#use-list input').forEach(function (c) { c.checked = true; });
        render();
      });
    }

    // ── 범례 ──
    function addLegend() {
      var legend = L.control({ position: 'bottomright' });
      legend.onAdd = function () {
        var div = L.DomUtil.create('div', 'legend');
        div.innerHTML =
          '<div class="legend-title">범례</div>' +
          legendRow('#fed976', '준공 15–25년', false) +
          legendRow('#fd8d3c', '준공 25–35년', false) +
          legendRow('#bd0026', '준공 35년 이상', false) +
          legendRow('#cccccc', '도로명 없음 (미확보)', true) +
          legendRow('#aaaaaa', '도로명 매칭실패 (미확보)', true);
        return div;
      };
      legend.addTo(map);
    }
  }

  // STEP 5-B (2026-05-24): 데이터셋 패널 제거 — 분석 섹션이 흡수.
  //   제거 함수: fillDatasetPanel · renderDatasetFull · renderDatasetLegacy
  //              · datasetRowHtml · setDatasetTitle (총 ~85줄, dead code 정리)

  // ── 스타일 ──────────────────────────────────────────────────────────
  function ageColor(age) {
    if (age == null) return '#9ca3af';
    if (age >= 35) return '#bd0026';
    if (age >= 25) return '#fd8d3c';
    return '#fed976';
  }
  /** match_status 별 폴리곤 스타일 */
  function featureStyle(feature) {
    var p = feature.properties || {};
    if (p.match_status === 'no_road_address') {
      return { fillColor: '#cccccc', color: '#9aa0a6', weight: 1, dashArray: '3 3', fillOpacity: 0.5 };
    }
    if (p.match_status === 'road_no_match') {
      return { fillColor: '#aaaaaa', color: '#80868b', weight: 1, dashArray: '3 3', fillOpacity: 0.55 };
    }
    return { fillColor: ageColor(p.buildingAge), color: '#374151', weight: 1, fillOpacity: 0.72 };
  }

  // ── 유틸 ────────────────────────────────────────────────────────────
  /** geometry 의 모든 좌표를 순회 (lng,lat) */
  function eachCoord(geom, cb) {
    if (!geom || !geom.coordinates) return;
    (function walk(a) {
      if (typeof a[0] === 'number') { cb(a[0], a[1]); return; }
      for (var i = 0; i < a.length; i++) walk(a[i]);
    })(geom.coordinates);
  }
  /** 피처 배열의 [[minLat,minLng],[maxLat,maxLng]] */
  function dataBounds(features) {
    var minLat = 90, minLng = 180, maxLat = -90, maxLng = -180, any = false;
    features.forEach(function (f) {
      eachCoord(f.feature.geometry, function (lng, lat) {
        any = true;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      });
    });
    return any ? [[minLat, minLng], [maxLat, maxLng]] : null;
  }
  function legendRow(color, text, dashed) {
    return (
      '<div class="row"><span class="swatch" style="background:' + color +
      (dashed ? ';border-style:dashed' : '') + '"></span>' + text + '</div>'
    );
  }
  function showBanner(msg) {
    var b = document.getElementById('banner');
    b.textContent = msg;
    b.hidden = false;
  }
  function showMapMsg(msg) {
    var m = document.getElementById('map-msg');
    m.textContent = msg;
    m.hidden = false;
  }
  function hideMapMsg() { document.getElementById('map-msg').hidden = true; }
  function showFatal(title, body) {
    var d = document.createElement('div');
    d.className = 'fatal';
    d.innerHTML = '<div><h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(body) + '</p></div>';
    document.body.appendChild(d);
  }
  function uniqueSorted(arr) {
    var seen = {};
    arr.forEach(function (v) { seen[v] = true; });
    return Object.keys(seen).sort();
  }
  function num(n) { return Number(n).toLocaleString(); }
  function dash(v) { return v == null ? '—' : v; }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function cssSafe(s) { return s.replace(/[^a-zA-Z0-9가-힣]/g, '_'); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
})();
