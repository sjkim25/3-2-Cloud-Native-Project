/**
 * SkiPlan 메인 페이지
 *
 * 1) GET /auth/check → 로그인 안 됨 → login.html
 * 2) OpenFreeMap 벡터 타일 위에 자체 스타일로 지도를 그림
 * 3) 리조트 목록, 즐겨찾기, 여행 계획을 ski-trip-api에서 불러옴
 * 4) 리조트 모드: 리조트 클릭 → /snow/forecast + /snow/history 
 *    지역 모드  : 아무 곳이나 클릭 → /snow/region 으로 시·군 경계 서칭 후 지역 전체 평균 예보, 기록을 보여줌
 * 5) 직접 만든 달력으로 날짜 범위를 골라 여행 계획에 추가 → /trip/trip-add.php
 *
 * 모든 요청은 skiplan.com 기준 상대 경로이고, Nginx Proxy Manager가 /auth/, /trip/, /snow/ 를 각 컨테이너로 나눠 보냄
 */

const API = {
  check:      '/auth/check',               // ski-auth-api
  logout:     '/auth/logout',
  resorts:    '/trip/resorts-list.php',    // ski-trip-api
  trips:      '/trip/trip-list.php',
  tripAdd:    '/trip/trip-add.php',
  tripDelete: '/trip/trip-delete.php',
  favorites:  '/trip/favorite-list.php',
  favAdd:     '/trip/favorite-add.php',
  favDelete:  '/trip/favorite-delete.php',
  region:     '/snow/region',              // ski-snow-api
  forecast:   '/snow/forecast',
  history:    '/snow/history',
};

const LOGIN_REQUIRED_MSG = '로그인을 해주십시오.';
const EMPTY = { type: 'FeatureCollection', features: [] };

// 언어 변경 시 글자를 다시 지정하는 지도 라벨 레이어
const LABEL_LAYERS = ['place-country', 'place-city', 'place-town', 'place-village', 'road-label'];

const VIEWS = { map: '지도', trips: '내 여행' };

const LANGS = { ko: '한국어', en: 'English' };

// 북마크 아이콘
const BOOKMARK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.2-6.5 4.2v-16a1 1 0 0 1 1-1z"/></svg>';

let map;
let resorts = [];
const resortById = new Map();
let currentSelection = null;   // 정보 패널에 표시 중인 리조트/지역
let mode = 'resort';           // 'resort' | 'region'
let lang = 'ko';               // 'ko' | 'en'
let lastTrips = [];            // 언어를 바꾼 뒤 목록을 다시 그리려고 보관
let favoriteOrder = [];        // 즐겨찾기 리조트 ID, 최신순
const favoriteIds = new Set(); // 같은 ID, 즐겨찾기 여부를 빠르게 확인


// 공통 함수
// 모든 API 호출이 거침. 로그인이 필요하다는 응답이면 login.html로 보내고 예외를 던져 호출한 쪽의 처리를 멈춤
async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (data.result === 'no' && data.msg === LOGIN_REQUIRED_MSG) {
    location.href = 'login.html';
    throw new Error('not logged in');
  }
  return data;
}

function postJson(url, body) {
  return api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 적설량은 항상 소수점 한 자리: 18 → "18.0", 575.7 → "575.7"
const fmt1 = (v) => Number(v).toFixed(1);
const fmtCm = (v) => (v === null || v === undefined ? '-' : `${fmt1(v)} cm`);
const flag = (country) => (country === 'KR' ? '🇰🇷' : '🇯🇵');

// 두 좌표 사이의 거리(km)
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestResort(lat, lon) {
  let best = null;
  resorts.forEach((r) => {
    const km = distanceKm(lat, lon, r.lat, r.lon);
    if (!best || km < best.km) best = { resort: r, km };
  });
  return best;
}


// 날짜 함수
// "YYYY-MM-DD" 문자열로 다룸
// 일수 계산은 Date.UTC로 서머타임 보정
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad2 = (n) => String(n).padStart(2, '0');

/** Date(로컬 시간) → "YYYY-MM-DD" */
function toYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
const todayYmd = () => toYmd(new Date());

/** "YYYY-MM-DD" → [연, 월 인덱스 0–11, 일] */
function splitYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return [y, m - 1, d];
}

/** a부터 b까지 일수 ("2027-01-15", "2027-01-18" → 3) */
function daysBetween(a, b) {
  return Math.round((Date.UTC(...splitYmd(b)) - Date.UTC(...splitYmd(a))) / 86400000);
}

/** "2027-01-15" → "2027.01.15 (금)", withYear=false → "01.15 (금)" */
function fmtDay(s, withYear = true) {
  const [y, m, d] = splitYmd(s);
  const w = WEEKDAYS[new Date(y, m, d).getDay()];
  return `${withYear ? y + '.' : ''}${pad2(m + 1)}.${pad2(d)} (${w})`;
}

/** 3박 → "3박 4일", 같은 날 → "당일" */
function nightsText(start, end) {
  const n = daysBetween(start, end);
  return n === 0 ? '당일' : `${n}박 ${n + 1}일`;
}

/** 목록용 여행 기간: "2027.01.15 (금) ~ 01.18 (월) · 3박 4일" */
function periodText(t) {
  if (!t.start_date) return '날짜 미정';
  const end = t.end_date || t.start_date;
  if (end === t.start_date) return `${fmtDay(t.start_date)} · 당일`;
  const sameYear = end.slice(0, 4) === t.start_date.slice(0, 4);
  return `${fmtDay(t.start_date)} ~ ${fmtDay(end, !sameYear)} · ${nightsText(t.start_date, end)}`;
}


// 지도 스타일

/**
 *   한국어: name:ko → 영어 → 현지 이름
 *   영어  : name:en → 예전 필드 name_en → 라틴 문자 표기 → 현지 이름
 */
function nameExpr(l) {
  return l === 'ko'
    ? ['coalesce', ['get', 'name:ko'], ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']]
    : ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
}

const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const HALO = { 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 };

function buildStyle() {
  return {
    version: 8,
    // 라틴 글꼴만 OpenFreeMap에서 받고, 한글·가나·한자는 시스템 글꼴로 그림
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }, // OpenMapTiles 스키마
      // 고도 이미지: 픽셀의 R·G·B 값에 높이가 담겨 있음
      // 키 없이 쓰는 공개 데이터 AWS Terrain Tiles
      dem: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
        attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> (Mapzen, SRTM, GMTED, ETOPO1)',
      },
      // 홋카이도 14개 진흥국(振興局) 경계, ski-front가 제공하는 파일.
      // 홋카이도는 하나의 현이기 때문에 OpenStreetMap(Nominatim)에서 한 번 받아 약 200 m로 단순화
      hokkaido: { type: 'geojson', data: new URL('hokkaido-subpref.json', location.href).href },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f5f4f0' } },

      { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover',
        filter: ['match', ['get', 'class'], ['wood', 'forest'], true, false],
        paint: { 'fill-color': '#dfe8d5', 'fill-opacity': 0.6 } },

      // 음영 기복
      { id: 'hillshade', type: 'hillshade', source: 'dem', minzoom: 10,
        paint: {
          // 줌 10→11에서 서서히 나타나고, 더 가까이서는 도로가 잘 보이도록 약해짐
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 0.45, 13, 0.3],
          'hillshade-illumination-direction': 315,
          'hillshade-shadow-color': '#3b4a5e',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#55657a',
        } },

      // 홋카이도 진흥국 경계 (현 경계와 동일)
      // 줌 9부터는 타일 자체의 admin_level 5 경계가 대신함
      { id: 'boundary-hokkaido', type: 'line', source: 'hokkaido', minzoom: 5, maxzoom: 9,
        paint: { 'line-color': '#a8a29e', 'line-width': 0.8, 'line-dasharray': [3, 2] } },

      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
        paint: { 'fill-color': '#c4dcec' } },

      // 경계선: 육지 경계만 (바다 위 경계 maritime = 1은 제외)
      { id: 'boundary-province', type: 'line', source: 'omt', 'source-layer': 'boundary', minzoom: 5,
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': '#a8a29e', 'line-width': 0.8, 'line-dasharray': [3, 2] } },
      // 시/군/구·市町村 경계(+ 홋카이도 진흥국, level 5): 타일에 줌 9부터만 들어 있어서 두 모드 모두 줌 9부터 그림
      { id: 'boundary-municipal', type: 'line', source: 'omt', 'source-layer': 'boundary', minzoom: 9,
        filter: ['all', ['match', ['get', 'admin_level'], [5, 6, 7], true, false], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': '#94a3b8', 'line-width': 0.7 } },
      { id: 'boundary-country', type: 'line', source: 'omt', 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': '#78716c', 'line-width': 1.2 } },

      // 도로는 확대할수록 단계적으로 나타내고, 페리, 철도, 산책로는 그리지 않음
      { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 7,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk'], true, false],
        paint: { 'line-color': '#e3b97f', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 12, 2.5, 16, 7] } },
      { id: 'road-primary', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10,
        filter: ['match', ['get', 'class'], ['primary', 'secondary'], true, false],
        paint: { 'line-color': '#d4ccbd', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 5] } },
      { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13,
        filter: ['match', ['get', 'class'], ['tertiary', 'minor', 'service'], true, false],
        paint: { 'line-color': '#e0dbd1', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 4] } },

      { id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13,
        layout: { 'symbol-placement': 'line', 'text-field': nameExpr(lang), 'text-font': FONT, 'text-size': 11 },
        paint: { 'text-color': '#57534e', ...HALO } },

      // 지명: 축소하면 국가·도시, 확대하면 읍·마을.
      // 바다 이름, 산 정상, POI는 제외
      { id: 'place-village', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 11,
        filter: ['match', ['get', 'class'], ['village', 'suburb', 'neighbourhood'], true, false],
        layout: { 'text-field': nameExpr(lang), 'text-font': FONT, 'text-size': 11 },
        paint: { 'text-color': '#78716c', ...HALO } },
      { id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 8,
        filter: ['==', ['get', 'class'], 'town'],
        layout: { 'text-field': nameExpr(lang), 'text-font': FONT, 'text-size': 12 },
        paint: { 'text-color': '#44403c', ...HALO } },
      { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 3,
        filter: ['==', ['get', 'class'], 'city'],
        layout: {
          'text-field': nameExpr(lang), 'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 15],
        },
        paint: { 'text-color': '#1c1917', ...HALO } },
      { id: 'place-country', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 5,
        filter: ['==', ['get', 'class'], 'country'],
        layout: { 'text-field': nameExpr(lang), 'text-font': FONT_BOLD, 'text-size': 13 },
        paint: { 'text-color': '#57534e', ...HALO } },
    ],
  };
}

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => console.error(err));
});

async function init() {
  const me = await api(API.check);   // 로그인 안 되어 있으면 login.html로 이동
  document.getElementById('username').textContent = me.username;

  await initMap();                   // 지도 스타일 로드가 끝날 때까지 기다림
  await loadResorts();               // 목록을 그리기 전에 resortById가 있어야 함
  await Promise.all([loadFavorites(), loadTrips()]);
  renderFavSidebar();

  document.getElementById('logout-btn').addEventListener('click', logout);
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('[data-region]').forEach((b) => b.addEventListener('click', () => fitCountry(b.dataset.region)));

  ['fav-list', 'trip-list', 'info-panel', 'view-trips'].forEach((id) => {
    document.getElementById(id).addEventListener('click', onListClick);
  });

  initNavTabs();
  initLangMenu();
  initResortSearch();
  setMode('resort');
  showView(viewFromHash());
}

function initMap() {
  return new Promise((resolve) => {
    map = new maplibregl.Map({
      container: 'map',
      style: buildStyle(),
      center: [134, 39.5],
      zoom: 4.2,
      // 타일 서버 글꼴은 라틴 문자만 있어서 한글·일본어는 로컬 글꼴로 그린다그림
      localIdeographFontFamily: "'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
    });
    // 줌 버튼 재위치
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    map.on('load', () => {
      // 지역 모드의 강조 영역
      map.addSource('region', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'region-fill', type: 'fill', source: 'region',
        paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.18 } });
      map.addLayer({ id: 'region-line', type: 'line', source: 'region',
        paint: { 'line-color': '#1d4ed8', 'line-width': 2 } });

      map.on('click', onMapClick);
      map.on('mousemove', (e) => {
        const overResort = map.queryRenderedFeatures(e.point, { layers: ['resort-dots', 'resort-labels'] }).length > 0;
        map.getCanvas().style.cursor = overResort || mode === 'region' ? 'pointer' : '';
      });
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// 화면 탭 + 언어 메뉴
// ---------------------------------------------------------------------------
function viewFromHash() {
  const v = location.hash.replace('#/', '');
  return VIEWS[v] ? v : 'map';
}

function showView(v) {
  document.getElementById('view-map').classList.toggle('hidden', v !== 'map');
  document.getElementById('view-trips').classList.toggle('hidden', v !== 'trips');
  setActive('#nav-tabs', 'view', v);

  history.replaceState(null, '', `#/${v}`);

  if (v === 'map') map.resize();   // 숨겨져 있던 지도는 크기를 못 재므로 다시 계산
  else renderTripsPage();
}

function initNavTabs() {
  document.querySelectorAll('#nav-tabs [data-view]').forEach((b) => {
    b.addEventListener('click', () => {
      showView(b.dataset.view);
      window.scrollTo(0, 0);
    });
  });
}

function toggleLangMenu(open) {
  document.getElementById('lang-dropdown').classList.toggle('hidden', !open);
  document.getElementById('lang-toggle').setAttribute('aria-expanded', String(open));
}

function initLangMenu() {
  const menu = document.getElementById('lang-menu');
  const dropdown = document.getElementById('lang-dropdown');

  document.getElementById('lang-toggle').addEventListener('click', () => {
    toggleLangMenu(dropdown.classList.contains('hidden'));
  });
  dropdown.querySelectorAll('[data-lang]').forEach((b) => {
    b.addEventListener('click', () => setLang(b.dataset.lang));
  });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) toggleLangMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleLangMenu(false); });
}

// ---------------------------------------------------------------------------
// 리조트: GeoJSON 소스 + 원 레이어 + 라벨 레이어
// ---------------------------------------------------------------------------
async function loadResorts() {
  const data = await api(API.resorts);
  resorts = data.resorts;
  resorts.forEach((r) => resortById.set(r.id, r));

  map.addSource('resorts', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: resorts.map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: { id: r.id, name_ko: r.name_ko, name_en: r.name_en, country: r.country },
      })),
    },
  });

  // 점 아래 흐릿한 그림자
  map.addLayer({ id: 'resort-shadow', type: 'circle', source: 'resorts',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 9, 10, 14],
      'circle-color': '#0f172a',
      'circle-opacity': 0.28,
      'circle-blur': 0.8,
      'circle-translate': [0, 1.5],
    } });

  // 정보 패널에 표시 중인 리조트의 주황색 고리.
  map.addLayer({ id: 'resort-selected', type: 'circle', source: 'resorts',
    filter: ['==', ['get', 'id'], -1],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 16],
      'circle-color': 'rgba(242, 165, 65, 0.25)',
      'circle-stroke-color': '#f2a541',
      'circle-stroke-width': 3,
    } });

  map.addLayer({ id: 'resort-dots', type: 'circle', source: 'resorts',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6.5, 10, 10],
      'circle-color': ['match', ['get', 'country'], 'KR', '#2563eb', '#dc2626'], // 한국 파랑, 일본 빨강
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2.5,
    } });

  // 리조트 이름 뒤의 남색 태그
  map.addImage('label-tag', makeLabelTag(), {
    pixelRatio: 2,
    stretchX: [[10, 14]],
    stretchY: [[10, 14]],
    content: [6, 6, 18, 18],
  });
  map.addLayer({ id: 'resort-labels', type: 'symbol', source: 'resorts',
    layout: {
      'text-field': ['get', lang === 'ko' ? 'name_ko' : 'name_en'],
      'text-font': FONT_BOLD,
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 1.1],
      'text-optional': true,
      'icon-image': 'label-tag',
      'icon-text-fit': 'both',
      'icon-text-fit-padding': [2, 6, 2, 6],
    },
    paint: { 'text-color': '#ffffff' } });
}


// 남색 라벨 태그. 캔버스에 그린 24×24 둥근 사각형의 픽셀 데이터.
function makeLabelTag() {
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(19, 35, 58, 0.92)';
  ctx.beginPath();
  ctx.roundRect(0, 0, 24, 24, 8);
  ctx.fill();
  return ctx.getImageData(0, 0, 24, 24);
}

// 리조트 하나에 주황색 고리를 표시 (id -1 = 표시 안 함)
function markSelected(id) {
  map.setFilter('resort-selected', ['==', ['get', 'id'], id]);
}

function fitCountry(code) {
  const list = code === 'all' ? resorts : resorts.filter((r) => r.country === code);
  if (!list.length) return;
  const lons = list.map((r) => r.lon);
  const lats = list.map((r) => r.lat);
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    { padding: 60, maxZoom: 9 });
}

// ---------------------------------------------------------------------------
// 모드·언어 전환
// ---------------------------------------------------------------------------
function setActive(groupSelector, attr, value) {
  document.querySelectorAll(`${groupSelector} button`).forEach((b) => {
    b.classList.toggle('active', b.dataset[attr] === value);
  });
}

function setMode(m) {
  mode = m;
  setActive('#mode-toggle', 'mode', m);
  document.getElementById('mode-hint').textContent = m === 'resort'
    ? '리조트: 지도 위 리조트(●)를 클릭하세요.'
    : '지역: 지도 아무 곳을 클릭하면 해당 시·군(市町村) 전체의 평균 적설 정보를 보여줍니다.';

  if (m === 'resort') map.getSource('region').setData(EMPTY);
}

function setLang(l) {
  lang = l;
  setActive('#lang-dropdown', 'lang', l);
  document.getElementById('lang-current').textContent = LANGS[l];
  toggleLangMenu(false);

  LABEL_LAYERS.forEach((id) => map.setLayoutProperty(id, 'text-field', nameExpr(l)));
  map.setLayoutProperty('resort-labels', 'text-field', ['get', l === 'ko' ? 'name_ko' : 'name_en']);

  if (currentSelection && currentSelection.fc) renderPanel(currentSelection);
  renderTrips();
}

// ---------------------------------------------------------------------------
// 클릭 처리
// ---------------------------------------------------------------------------
function onMapClick(e) {
  // 지역 모드: 리조트 점·이름 위를 클릭해도 그 아래 지역을 선택
  if (mode === 'region') {
    selectRegion(e.lngLat.lat, e.lngLat.lng);
    return;
  }

  // 리조트 모드: 클릭 위치 주변 12 px 상자 안에 리조트 점·라벨이 있는지 확인
  const pad = 12;
  const box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
  const hit = map.queryRenderedFeatures(box, { layers: ['resort-dots', 'resort-labels'] });
  if (hit.length) {
    selectResort(resortById.get(hit[0].properties.id));
    return;
  }

  // 리조트 모드에서 빈 곳을 클릭하면 안내 문구 강조
  const hint = document.getElementById('mode-hint');
  hint.classList.add('flash');
  setTimeout(() => hint.classList.remove('flash'), 1200);
}

function selectResort(r) {
  const elev = Math.round((r.base_elev + r.top_elev) / 2); // 베이스와 정상의 중간 고도로 날씨 조회
  map.getSource('region').setData(EMPTY);
  markSelected(r.id);
  map.flyTo({ center: [r.lon, r.lat], zoom: 13 });

  currentSelection = { type: 'resort', resort: r, elev, query: { lat: r.lat, lon: r.lon, elev } };
  loadSnow(currentSelection);
}

async function selectRegion(lat, lon) {
  const sel = { type: 'region', lat, lon, region: null, query: null, nearest: nearestResort(lat, lon) };
  currentSelection = sel;
  markSelected(-1);
  showPanelMessage('지역', '행정구역을 찾는 중...');

  try {
    const data = await api(`${API.region}?lat=${lat}&lon=${lon}`);
    if (sel !== currentSelection) return;
    if (data.result !== 'ok') {
      showPanelMessage('지역', data.msg);
      return;
    }

    sel.region = data.region;
    sel.query = { region: data.region.id };

    map.getSource('region').setData({ type: 'Feature', geometry: data.region.geometry, properties: {} });
    const [w, s, e, n] = data.region.bbox;
    map.fitBounds([[w, s], [e, n]], { padding: 50, maxZoom: 11 });

    loadSnow(sel);
  } catch (err) {
    if (sel === currentSelection) showPanelMessage('지역', `불러오기 실패: ${err.message}`);
  }
}

// 목록(사이드바, 내 여행)에서 리조트 클릭 시 지도 화면으로 바꾸고 선택
// ---------------------------------------------------------------------------
// 리조트 검색
// ---------------------------------------------------------------------------
const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
// 한글이 없는 검색어 → 영어 이름으로 표시 정렬
const isEnglishQuery = (q) => !/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(q);
const searchName = (r, english) => (english ? r.name_en : r.name_ko);

function searchResorts(query) {
  const q = norm(query);
  if (!q) return [];
  return resorts
    .map((r) => {
      const ko = norm(r.name_ko);
      const en = norm(r.name_en);
      let rank = -1;
      if (ko.startsWith(q) || en.startsWith(q)) rank = 0;
      else if (ko.includes(q) || en.includes(q)) rank = 1;
      else if (norm(r.region).includes(q)) rank = 2;
      return { r, rank };
    })
    .filter((x) => x.rank >= 0)
    .sort((a, b) => {
      const english = isEnglishQuery(query);
      return a.rank - b.rank
        || searchName(a.r, english).localeCompare(searchName(b.r, english), english ? 'en' : 'ko');
    })
    .slice(0, 8)
    .map((x) => x.r);
}

// 처음 일치하는 부분을 <mark>로 감쌈
function highlight(text, query) {
  const letters = [...query.replace(/\s+/g, '')].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!letters.length) return escapeHtml(text);
  const m = text.match(new RegExp(letters.join('\\s*'), 'i'));
  if (!m) return escapeHtml(text);
  return escapeHtml(text.slice(0, m.index)) + `<mark>${escapeHtml(m[0])}</mark>`
    + escapeHtml(text.slice(m.index + m[0].length));
}

function initResortSearch() {
  const input = document.getElementById('resort-search');
  const list = document.getElementById('search-results');
  let matches = [];
  let active = -1;
  let english = false;

  const close = () => {
    list.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };

  const render = () => {
    const q = input.value.trim();
    if (!q) return close();
    matches = searchResorts(q);
    english = isEnglishQuery(q);
    list.innerHTML = matches.length
      ? matches.map((r, i) => `<li role="option" data-i="${i}" class="${i === active ? 'active' : ''}">
          <span>${flag(r.country)}</span>
          <span class="sr-name">${highlight(searchName(r, english), q)}</span>
          <span class="sr-sub">${english ? (r.country === 'KR' ? 'Korea' : 'Japan') : escapeHtml(r.region)}</span></li>`).join('')
      : `<li class="empty">${english ? 'No results.' : '검색 결과가 없습니다.'}</li>`;
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  };

  // 확정: 페이지 스크롤 없이 지도에서 리조트 선택
  const choose = (r) => {
    input.value = searchName(r, english);
    close();
    input.blur();
    setMode('resort');
    selectResort(r);
  };

  input.addEventListener('input', () => { active = -1; render(); });
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!matches.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + matches.length) % matches.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = matches[active >= 0 ? active : 0];
      if (r && input.value.trim()) choose(r);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  // click 대신 mousedown: 입력창 포커스가 빠지기 전에 실행
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    choose(matches[Number(li.dataset.i)]);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) close();
  });
}

// 목록(사이드바, 내 여행)에서 리조트 클릭 시 지도 화면으로 바꾸고 선택
function viewResortOnMap(r) {
  showView('map');
  setMode('resort');
  selectResort(r);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * 사이드바, 정보 패널, 내 여행 화면이 함께 쓰는 클릭 핸들러
 *   [data-season]        - 시즌 차트에서 그 시즌의 월별 막대 열기/닫기
 *   .bookmark            - 즐겨찾기 켜기/끄기
 *   data-action="view"   - 지도에서 리조트 보기
 *   data-action="delete" - 여행 계획 삭제
 */
async function onListClick(e) {
  const season = e.target.closest('[data-season]');
  if (season) {
    toggleSeason(season.dataset.season);
    return;
  }

  const bookmark = e.target.closest('.bookmark');
  if (bookmark) {
    toggleFavorite(Number(bookmark.dataset.resort));
    return;
  }

  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  if (btn.dataset.action === 'view') {
    const r = resortById.get(Number(btn.dataset.resort));
    if (r) viewResortOnMap(r);
  }
  if (btn.dataset.action === 'delete') {
    const data = await postJson(API.tripDelete, { id: Number(btn.dataset.id) });
    if (data.result !== 'ok') alert(data.msg);
    loadTrips();
  }
}

// ---------------------------------------------------------------------------
// 적설 데이터 + 정보 패널
// ---------------------------------------------------------------------------
function titleOf(sel) {
  if (sel.type === 'resort') {
    return lang === 'ko' ? `${sel.resort.name_ko} (${sel.resort.name_en})` : sel.resort.name_en;
  }
  return lang === 'ko' ? sel.region.name_ko : sel.region.name_en;
}

function chipsOf(sel) {
  if (sel.type === 'resort') {
    const r = sel.resort;
    return [r.region, `베이스 ${r.base_elev}m`, `정상 ${r.top_elev}m`, `기준 고도 ${sel.elev}m`];
  }
  const country = { KR: '대한민국', JP: '일본' }[sel.region.country] || sel.region.country;
  return [country, '행정구역 전체 평균', '지형 고도 기준'];
}

// 1,000 m 이상은 "4.9km", 미만은 "900m", 모르면 null
function fmtLength(m) {
  if (m === null || m === undefined) return null;
  return m >= 1000 ? `<b>${fmt1(m / 1000)}</b>km` : `<b>${m}</b>m`;
}


///칩 아래 한 줄짜리 리조트 정보 (리조트 모드만): 슬로프, 리프트,  최장,  표고차. 공개되지 않은(NULL) 값은 빼고 표시
function resortFactsHtml(r) {
  const facts = [];
  if (r.slopes !== null) facts.push(`슬로프 <b>${r.slopes}</b>`);
  if (r.lifts !== null) facts.push(`리프트 <b>${r.lifts}</b>`);
  const longest = fmtLength(r.longest_m);
  if (longest) facts.push(`최장 ${longest}`);
  facts.push(`표고차 <b>${r.top_elev - r.base_elev}</b>m`);
  return `<div class="hero-facts">${facts.map((f) => `<span>${f}</span>`).join('')}</div>`;
}

/**
 * 난이도 막대: 초급/중급/상급을 슬로프 수에 비례한 너비로 한 막대에 나눠 그림
 * 난이도별 수가 공개되지 않았으면(NULL) 막대 제외
 */
function difficultyHtml(r) {
  if (r.slopes_beg === null) return '';
  const total = r.slopes_beg + r.slopes_int + r.slopes_adv;
  const levels = [['b', '초급', r.slopes_beg], ['i', '중급', r.slopes_int], ['a', '상급', r.slopes_adv]];
  const bar = levels.filter(([, , n]) => n > 0)
    .map(([cls, , n]) => `<i class="${cls}" style="width:${(n / total) * 100}%"></i>`).join('');
  const legend = levels
    .map(([cls, label, n]) => `<span><em class="${cls}"></em>${label} <b>${n}</b></span>`).join('');
  return `<div class="diff"><div class="diff-bar">${bar}</div><div class="diff-legend">${legend}</div></div>`;
}

/**
 * 패널 위쪽 헤더 띠: 이름(+ 리조트면 북마크), 정보 칩, 오른쪽에 현재 적설
 * 로딩 중에는 예보가 없으므로 숫자 자리에 "–" 표시
 */
function panelHeadHtml(sel, fc) {
  let now = '<div class="v">–</div>';
  if (fc) {
    const [date, time] = fc.current.time.split('T');
    const depth = fc.current.snow_depth_cm;
    now = `<div class="v">${depth === null ? '–' : fmt1(depth)}<small>cm</small></div>
           <div class="s">${fmtDay(date)} ${time}</div>`;
  }
  return `
    <div class="hero">
      <div class="hero-main">
        <div class="panel-head">
          <h2>${escapeHtml(titleOf(sel))}</h2>
          ${sel.type === 'resort' ? bookmarkHtml(sel.resort.id) : ''}
        </div>
        <div class="hero-chips">${chipsOf(sel).map((c) => `<span>${escapeHtml(c)}</span>`).join('')}</div>
        ${sel.type === 'resort' ? resortFactsHtml(sel.resort) : ''}
      </div>
      <div class="hero-now"><div class="k">현재 적설</div>${now}</div>
    </div>
    ${sel.type === 'resort' ? difficultyHtml(sel.resort) : ''}`;
}

function showPanelMessage(title, message) {
  document.getElementById('sys-badges').innerHTML = '';
  document.getElementById('info-panel').innerHTML =
    `<h2>${escapeHtml(title)}</h2><p class="loading">${escapeHtml(message)}</p>`;
}

async function loadSnow(sel) {
  const panel = document.getElementById('info-panel');
  // 제목은 바로 표시, 수는 데이터 전달 시 채움
  panel.innerHTML = `${panelHeadHtml(sel)}<p class="loading">적설 정보를 불러오는 중...</p>`;
  document.getElementById('sys-badges').innerHTML = '';

  const q = new URLSearchParams(sel.query);
  try {
    const [fc, hist] = await Promise.all([
      api(`${API.forecast}?${q}`),
      api(`${API.history}?${q}`),
    ]);
    if (sel !== currentSelection) return;
    if (fc.result !== 'ok') throw new Error(fc.msg);
    if (hist.result !== 'ok') throw new Error(hist.msg);

    sel.fc = fc;
    sel.hist = hist;
    renderPanel(sel);
  } catch (err) {
    if (sel !== currentSelection) return;
    const loading = panel.querySelector('.loading');
    if (loading) loading.textContent = `불러오기 실패: ${err.message}`;
  }
}

// 통계 카드 하나. key = true면 어두운 배경으로 강조
function stat(label, value, sub, key = false) {
  return `<div class="stat${key ? ' key' : ''}">
            <div class="k">${escapeHtml(label)}</div>
            <div class="v">${escapeHtml(value)}</div>
            <div class="s">${escapeHtml(sub)}</div>
          </div>`;
}

/**
 * 막대 하나: 위에 값, 색 채움, 아래에 라벨
 * valText   = 막대 위 숫자 ('' = 표시 안 함)
 * height    = 차트 높이 대비 %
 * fillStyle = 고정 높이 대신 쓸 인라인 스타일
 * tag       = 라벨 아래 작은 표시, 예: { text: '최다 시즌', cls: 'best' }
 */
function barHtml({ valText, height, label, tip, cls = '', fillStyle, tag }) {
  return `<div class="bar ${cls}" title="${escapeHtml(tip)}">
            <span class="val">${escapeHtml(valText)}</span>
            <div class="fill" style="${fillStyle || `height:${Math.round(height)}%`}"></div>
            <span class="lbl">${escapeHtml(label)}</span>
            ${tag ? `<span class="tag ${tag.cls}">${escapeHtml(tag.text)}</span>` : ''}
          </div>`;
}

// <div>로 만든 막대 차트. 막대 높이 = 값 / 최댓값
function barChart(items, opts) {
  const max = Math.max(1, ...items.map((it) => opts.value(it) || 0));
  const bars = items.map((it) => {
    const raw = opts.value(it);                       // null/undefined = 데이터 없음
    const v = raw || 0;
    const noData = raw === null || raw === undefined;
    return barHtml({
      valText: noData ? '' : fmt1(v),
      height: (v / max) * 100,
      label: opts.label(it),
      tip: `${opts.label(it)}: ${noData ? '데이터 없음' : `${fmt1(v)} cm`}${opts.tip ? ' · ' + opts.tip(it) : ''}`,
      cls: v === 0 ? 'zero' : '',
    });
  }).join('');
  return `<div class="bars">${bars}</div>`;
}

// ---------------------------------------------------------------------------
// 시즌 차트: 시즌마다 슬롯 하나에 시즌 막대와 해당 시즌 월별 막대 6개(11월→4월)를 넣어둠
// 열린 시즌은 sel.openSeason에 저장해 언어 변경시에도 열린 상태 유지
// ---------------------------------------------------------------------------
function seasonChartHtml(sel) {
  const { seasons, snowiest_season: best } = sel.hist;
  const max = Math.max(1, ...seasons.map((s) => s.total_cm || 0));
  const openOk = seasons.some((s) => s.months && s.season === sel.openSeason);

  const slots = seasons.map((s) => {
    const v = s.total_cm || 0;
    const isOpen = openOk && s.season === sel.openSeason;
    const isBest = best && s.season === best.season;
    const bar = barHtml({
      valText: fmt1(v),
      label: s.season,
      tip: `${s.season}: ${fmt1(v)} cm${s.months ? ' · 클릭하면 월별 강설량' : ''}`,
      cls: [
        isBest ? 'hl' : '',        // 최다 강설 시즌 진하게
        s.partial ? 'muted' : '',  // 진행 중인 시즌 회색
      ].join(' '),
      fillStyle: `--h:${Math.round((v / max) * 100)}%`,
      tag: isBest ? { text: '최다 시즌', cls: 'best' }
        : s.partial ? { text: '진행 중', cls: 'partial' }
        : null,
    });

    // 월별 데이터가 없는 예전 캐시 - 열 수 없는 일반 막대
    if (!s.months) return `<div class="season-slot">${bar}</div>`;

    return `
      <div class="season-slot${isOpen ? ' open' : ''}" data-season="${escapeHtml(s.season)}">
        ${bar}
        ${monthGroupHtml(s)}
      </div>`;
  });
  return `<div class="bars${openOk ? ' has-open' : ''}">${slots.join('')}</div>`;
}

/**
 * 한 시즌의 월별 막대: 위에 시즌 합계가 있는 틀 안에 월마다 막대 하나.
 * 월별 막대는 자체 기준(가장 많은 달 = 최대 높이) 사용
 */
function monthGroupHtml(s) {
  const max = Math.max(1, ...s.months.map((m) => m.total_cm || 0));
  const bars = s.months.map((m, i) => {
    const v = m.total_cm || 0;
    return barHtml({
      valText: m.days ? fmt1(v) : '',
      label: `${m.month}월`,
      tip: m.days
        ? `${m.month}월: ${fmt1(v)} cm · 일평균 ${fmt1(v / m.days)} cm`
        : `${m.month}월: 아직 데이터 없음`,
      cls: m.days ? 'month' : 'month muted',
      fillStyle: `--h:${Math.round((v / max) * 100)}%;--i:${i}`,
    });
  }).join('');

  return `
    <div class="bar-group" title="${escapeHtml(s.season)} 시즌 · 클릭하면 닫기">
      <div class="group-head">${escapeHtml(s.season)} · ${fmt1(s.total_cm)} cm ✕</div>
      <div class="group-bars">${bars}</div>
    </div>`;
}

/**
 * 시즌 열기/닫기
 * 한 시즌이 열린 상태에서 다른 시즌을 누르면 한 번에 그 시즌으로 변경
 */
function toggleSeason(season) {
  const sel = currentSelection;
  if (!sel || !sel.hist) return;
  sel.openSeason = sel.openSeason === season ? null : season;

  const chart = document.getElementById('season-chart');
  chart.querySelector('.bars').classList.toggle('has-open', sel.openSeason !== null);
  chart.querySelectorAll('.season-slot').forEach((slot) => {
    slot.classList.toggle('open', slot.dataset.season === sel.openSeason);
  });
}

function renderPanel(sel) {
  const { fc, hist } = sel;
  const rec = hist.record_day;
  const best = hist.snowiest_season;
  const completeSeasons = hist.seasons.filter((s) => !s.partial).length;
  const isRegion = sel.type === 'region';

  // 시스템 배지(응답 서버, 캐시 여부)는 패널이 아니라 페이지 아래쪽 #sys-badges에 표시
  document.getElementById('sys-badges').innerHTML = `
      <span class="badge">응답 서버: ${escapeHtml(fc.server)}</span>
      <span class="badge">예보: ${fc.cached ? 'Redis 캐시' : '새로 조회'}</span>
      <span class="badge">기록: ${hist.cached ? 'Redis 캐시' : `DB ${hist.source.db}시즌 + API ${hist.source.api}시즌`}</span>
      ${isRegion ? `<span class="badge">예보 ${fc.location.points}개 · 기록 ${hist.location.points}개 지점 평균</span>` : ''}
      <span class="badge">${isRegion ? '평균 지형 고도' : '모델 고도'} ${fc.location.elevation}m</span>`;

  const [nowDate, nowTime] = fc.current.time.split('T');

  document.getElementById('info-panel').innerHTML = `
    ${panelHeadHtml(sel, fc)}

    <div class="stats">
      ${stat('16일 예보 강설', fmtCm(fc.forecast.total_cm), '오늘부터 16일 합계', true)}
      ${stat('최근 7일 강설', fmtCm(fc.recent.total_cm), '지난 7일 합계')}
      ${stat('최대 일 강설 기록', rec ? fmtCm(rec.snowfall_cm) : '-', rec ? fmtDay(rec.date) : '')}
      ${stat('최다 강설 시즌', best ? fmtCm(best.total_cm) : '-', best ? `${best.season} 시즌` : '')}
      ${stat('시즌 평균 강설', fmtCm(hist.average_season_cm), `최근 ${completeSeasons}시즌 평균`)}
    </div>

    <h3 class="chart-title">16일 강설 예보 (cm)</h3>
    <div class="chart-wrap">
      ${barChart(fc.forecast.days, {
        label: (d) => d.date.slice(5).replace('-', '/'),
        value: (d) => d.snowfall_cm,
        tip: (d) => `최고 ${d.tmax}°C / 최저 ${d.tmin}°C`,
      })}
    </div>

    <h3 class="chart-title">시즌별 누적 강설 (11월~4월, cm)</h3>
    <div class="chart-wrap" id="season-chart">${seasonChartHtml(sel)}</div>

    ${isRegion ? nearestHtml(sel.nearest) : tripFormHtml(sel.resort)}
  `;

  if (isRegion) {
    const btn = document.getElementById('goto-nearest');
    if (btn) btn.addEventListener('click', () => { setMode('resort'); selectResort(sel.nearest.resort); });
  } else {
    bindTripForm(sel.resort);
  }
}

function resortName(r) {
  return lang === 'ko' ? r.name_ko : r.name_en;
}

function nearestHtml(nearest) {
  if (!nearest) return '';
  return `
    <div class="nearest">
      가장 가까운 리조트: <strong>${escapeHtml(resortName(nearest.resort))}</strong>
      (약 ${Math.round(nearest.km)} km)
      <button id="goto-nearest">이 리조트 보기</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// 즐겨찾기 (ski-trip-api가 MySQL에 저장)
// ---------------------------------------------------------------------------

// 북마크 버튼: 빈 외곽선 = 저장 안 됨, 회색 채움 = 저장됨
function bookmarkHtml(resortId) {
  const on = favoriteIds.has(resortId);
  return `<button type="button" class="bookmark${on ? ' on' : ''}" data-resort="${resortId}"
            aria-pressed="${on}" title="${on ? '즐겨찾기 해제' : '즐겨찾기에 추가'}">${BOOKMARK_SVG}</button>`;
}

async function loadFavorites() {
  const data = await api(API.favorites);
  favoriteOrder = data.favorites.map((f) => f.resort_id);
  favoriteIds.clear();
  favoriteOrder.forEach((id) => favoriteIds.add(id));
}

// 로컬 상태와 페이지에 있는 이 리조트의 모든 북마크 버튼을 함께 변경
function setFavorite(id, on) {
  favoriteOrder = favoriteOrder.filter((x) => x !== id);
  if (on) {
    favoriteOrder.unshift(id);   // 최신순
    favoriteIds.add(id);
  } else {
    favoriteIds.delete(id);
  }
  document.querySelectorAll(`.bookmark[data-resort="${id}"]`).forEach((b) => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? '즐겨찾기 해제' : '즐겨찾기에 추가';
  });
  renderFavSidebar();
  renderTripsPage();
}

// 아이콘을 먼저 바꾸고 서버에 요청한 뒤 실패하면 원래대로 되돌림
async function toggleFavorite(id) {
  const wasOn = favoriteIds.has(id);
  setFavorite(id, !wasOn);
  try {
    const data = await postJson(wasOn ? API.favDelete : API.favAdd, { resort_id: id });
    if (data.result !== 'ok') throw new Error(data.msg);
  } catch (err) {
    setFavorite(id, wasOn);
    if (err.message !== 'not logged in') alert(`즐겨찾기 변경 실패: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// "여행 계획에 추가" (날짜 범위 선택)
// ---------------------------------------------------------------------------
function tripFormHtml(r) {
  return `
    <form id="trip-form" class="trip-form">
      <strong>여행 계획에 추가: ${escapeHtml(resortName(r))}</strong>
      <div class="trip-form-row">
        ${rangePickerHtml()}
        <input type="text" name="memo" maxlength="200" placeholder="메모 (선택)">
        <button type="submit">추가</button>
      </div>
      <span id="trip-form-msg" class="form-msg"></span>
    </form>`;
}

function bindTripForm(r) {
  const form = document.getElementById('trip-form');
  const picker = createRangePicker(form.querySelector('.range-picker'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('trip-form-msg');
    const { start, end } = picker.getRange();
    const data = await postJson(API.tripAdd, {
      resort_id: r.id,
      start_date: start || '',   // 빈 값 = 날짜 미정
      end_date: end || '',
      memo: form.memo.value,
    });
    msg.textContent = data.msg;
    msg.style.color = data.result === 'ok' ? '#16a34a' : '#dc2626';
    if (data.result === 'ok') {
      form.reset();
      picker.reset();
      loadTrips();
    }
  });
}

// 날짜 범위 선택
function rangePickerHtml() {
  return `
    <div class="range-picker">
      <button type="button" class="rp-box" data-field="start">
        <span class="rp-label">가는 날</span><span class="rp-value">날짜 선택</span>
      </button>
      <span class="rp-arrow">→</span>
      <button type="button" class="rp-box" data-field="end">
        <span class="rp-label">오는 날</span><span class="rp-value">날짜 선택</span>
      </button>
      <div class="rp-popup hidden"></div>
    </div>`;
}

function createRangePicker(root) {
  const popup = root.querySelector('.rp-popup');
  const boxes = {
    start: root.querySelector('[data-field="start"]'),
    end: root.querySelector('[data-field="end"]'),
  };
  const today = todayYmd();
  const st = {
    start: null,       // "YYYY-MM-DD" 또는 null
    end: null,
    hover: null,
    active: 'start',
    open: false,
    year: 0,
    month: 0,
  };

  // 열기 닫기
  const onDocDown = (e) => { if (!root.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  function open(field) {
    st.active = field === 'end' && st.start ? 'end' : 'start';
    if (!st.open) {
      const [y, m] = splitYmd(st[st.active] || st.start || today);
      st.year = y;
      st.month = m;
      st.open = true;
      popup.classList.remove('hidden');
      root.classList.add('open');
      document.addEventListener('mousedown', onDocDown);
      document.addEventListener('keydown', onKey);
      render();
      // 달력이 보일 만큼 스크롤
      // "nearest" = 이미 보이면 움직이지 않음
      popup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    render();
  }

  function close() {
    if (!st.open) return;
    st.open = false;
    st.hover = null;
    popup.classList.add('hidden');
    root.classList.remove('open');
    document.removeEventListener('mousedown', onDocDown);
    document.removeEventListener('keydown', onKey);
    renderBoxes();
  }

  // 날짜 선택
  function pick(day) {
    if (st.active === 'start') {
      st.start = day;
      if (st.end && st.end < day) st.end = null;   // 기존 오는 날이 새 가는 날보다 앞이면 지움
      st.active = 'end';
      render();
    } else if (day < st.start) {
      st.start = day;
      st.end = null;
      render();
    } else {
      st.end = day;
      close();
    }
  }

  // 그리기
  function renderBoxes() {
    ['start', 'end'].forEach((f) => {
      boxes[f].querySelector('.rp-value').textContent = st[f] ? fmtDay(st[f]) : '날짜 선택';
      boxes[f].classList.toggle('filled', !!st[f]);
      boxes[f].classList.toggle('active', st.open && st.active === f);
    });
  }

// 한 달을 7열 날짜 버튼 격자로 설정
  function monthHtml(y, m, side) {
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    let cells = '<span></span>'.repeat(first);
    for (let d = 1; d <= days; d++) {
      const ymd = `${y}-${pad2(m + 1)}-${pad2(d)}`;
      const wd = (first + d - 1) % 7;
      cells += `<button type="button" class="rp-day${wd === 0 ? ' sun' : ''}${wd === 6 ? ' sat' : ''}${ymd === today ? ' today' : ''}"
                  data-date="${ymd}">${d}</button>`;
    }
    const nav = side === 'left'
      ? '<button type="button" class="rp-nav" data-nav="-1" title="이전 달">‹</button>'
      : '<button type="button" class="rp-nav" data-nav="1" title="다음 달">›</button>';
    return `
      <div class="rp-month">
        <div class="rp-title ${side}">${nav}<span>${y}년 ${m + 1}월</span></div>
        <div class="rp-grid">
          ${WEEKDAYS.map((w, i) => `<span class="rp-wd${i === 0 ? ' sun' : ''}${i === 6 ? ' sat' : ''}">${w}</span>`).join('')}
          ${cells}
        </div>
      </div>`;
  }

  function statusText() {
    if (st.active === 'start') return '가는 날을 선택하세요';
    if (!st.end) return '오는 날을 선택하세요';
    return nightsText(st.start, st.end);
  }

  function render() {
    renderBoxes();
    if (!st.open) return;
    const next = new Date(st.year, st.month + 1, 1);
    popup.innerHTML = `
      <div class="rp-months">
        ${monthHtml(st.year, st.month, 'left')}
        ${monthHtml(next.getFullYear(), next.getMonth(), 'right')}
      </div>
      <div class="rp-foot">
        <span class="rp-status">${statusText()}</span>
        <button type="button" class="rp-clear" data-act="clear">초기화</button>
        <button type="button" data-act="done">완료</button>
      </div>`;
    paintDays();
  }

// 시작, 끝, 범위 안 날짜 표시
  function paintDays() {
    // 오는 선택 중에는 가는 날 이후의 마우스 위치까지 범위를 미리 보여준다
    const previewing = st.active === 'end' && st.start && st.hover && st.hover >= st.start;
    const rangeEnd = previewing ? st.hover : st.end;
    popup.querySelectorAll('.rp-day').forEach((b) => {
      const d = b.dataset.date;
      b.classList.toggle('start', d === st.start);
      b.classList.toggle('end', !!rangeEnd && d === rangeEnd);
      b.classList.toggle('in-range', !!st.start && !!rangeEnd && d > st.start && d < rangeEnd);
    });
  }

  // 이벤트
  boxes.start.addEventListener('click', () => open('start'));
  boxes.end.addEventListener('click', () => open('end'));

  popup.addEventListener('click', (e) => {
    const day = e.target.closest('.rp-day');
    const nav = e.target.closest('.rp-nav');
    const act = e.target.closest('[data-act]');
    if (day) pick(day.dataset.date);
    if (nav) {
      const d = new Date(st.year, st.month + Number(nav.dataset.nav), 1);
      st.year = d.getFullYear();
      st.month = d.getMonth();
      render();
    }
    if (act && act.dataset.act === 'clear') {
      st.start = null;
      st.end = null;
      st.active = 'start';
      render();
    }
    if (act && act.dataset.act === 'done') close();
  });

  popup.addEventListener('mouseover', (e) => {
    const day = e.target.closest('.rp-day');
    const d = day ? day.dataset.date : null;
    if (d !== st.hover) {
      st.hover = d;
      paintDays();
    }
  });
  popup.addEventListener('mouseleave', () => { st.hover = null; paintDays(); });

  renderBoxes();

  return {
    // 가는 날만 골랐으면 당일 여행
    getRange: () => ({ start: st.start, end: st.end || st.start }),
    reset() {
      st.start = null;
      st.end = null;
      st.active = 'start';
      close();
      renderBoxes();
    },
  };
}

// ---------------------------------------------------------------------------
// 여행 계획 (ski-trip-api): 지도 화면 사이드바 + 내 여행 화면
// ---------------------------------------------------------------------------
async function loadTrips() {
  const data = await api(API.trips);
  lastTrips = data.trips;
  renderTrips();
}

function renderTrips() {
  renderFavSidebar();
  renderTripSidebar();
  renderTripsPage();
}

/**
 * 사이드바 즐겨찾기 목록: "🇰🇷 용평" + 북마크-
 *   이름   - 리조트로 이동
 *   북마크 - 확인 없이 바로 해제
 */
function renderFavSidebar() {
  const list = document.getElementById('fav-list');
  const favs = favoriteOrder.map((id) => resortById.get(id)).filter(Boolean);
  if (!favs.length) {
    list.innerHTML = '<li class="empty">즐겨찾기한 리조트가 없습니다.</li>';
    return;
  }
  list.innerHTML = favs.map((r) => `
    <li class="fav-item">
      <button type="button" class="link-btn" data-action="view" data-resort="${r.id}">
        ${flag(r.country)} ${escapeHtml(resortName(r))}
      </button>
      ${bookmarkHtml(r.id)}
    </li>`).join('');
}

function renderTripSidebar() {
  const list = document.getElementById('trip-list');
  if (!lastTrips.length) {
    list.innerHTML = '<li class="empty">아직 저장한 여행이 없습니다.<br>리조트를 클릭해 추가해 보세요.</li>';
    return;
  }
  // 이름 - 리조트로 이동, ✕ - 삭제
  list.innerHTML = lastTrips.map((t) => `
    <li class="trip-item">
      <div class="trip-info">
        <button type="button" class="link-btn trip-name" data-action="view" data-resort="${t.resort_id}">
          ${flag(t.country)} ${escapeHtml(lang === 'ko' ? t.name_ko : t.name_en)}
        </button>
        <div class="trip-meta">
          ${escapeHtml(periodText(t))}
          ${t.memo ? '<br>' + escapeHtml(t.memo) : ''}
        </div>
      </div>
      <button type="button" class="del-btn" data-action="delete" data-id="${t.id}"
              title="삭제" aria-label="삭제">✕</button>
    </li>`).join('');
}

// 오늘 기준 여행 상태 배지: D-day, 여행 중, 지난 여행, 미정
function tripStatus(t, today) {
  if (!t.start_date) return { cls: 'undated', text: '미정', past: false };
  const end = t.end_date || t.start_date;
  if (end < today) return { cls: 'past', text: '지난 여행', past: true };
  if (t.start_date <= today) return { cls: 'now', text: '여행 중', past: false };
  return { cls: 'soon', text: `D-${daysBetween(today, t.start_date)}`, past: false };
}

function favCardHtml(r) {
  const planned = lastTrips.filter((t) => t.resort_id === r.id).length;
  return `
    <div class="fav-card">
      <div class="fav-top">
        <div>
          <div class="fav-name">${flag(r.country)} ${escapeHtml(resortName(r))}</div>
          <div class="fav-sub">${escapeHtml(r.region)} · ${r.base_elev}–${r.top_elev}m</div>
        </div>
        ${bookmarkHtml(r.id)}
      </div>
      <div class="fav-meta">${planned ? `여행 계획 ${planned}건` : '여행 계획 없음'}</div>
      <button data-action="view" data-resort="${r.id}">지도에서 보기</button>
    </div>`;
}

function planRowHtml(t, status) {
  return `
    <div class="plan-row ${status.cls}">
      <span class="plan-badge">${escapeHtml(status.text)}</span>
      <div class="plan-main">
        <div class="plan-name">${flag(t.country)} ${escapeHtml(lang === 'ko' ? t.name_ko : t.name_en)}</div>
        <div class="plan-period">${escapeHtml(periodText(t))}</div>
        ${t.memo ? `<div class="plan-memo">${escapeHtml(t.memo)}</div>` : ''}
      </div>
      <div class="plan-actions">
        <button data-action="view" data-resort="${t.resort_id}">지도에서 보기</button>
        <button data-action="delete" data-id="${t.id}" class="danger">삭제</button>
      </div>
    </div>`;
}

function renderTripsPage() {
  // 즐겨찾기한 리조트
  const favs = favoriteOrder.map((id) => resortById.get(id)).filter(Boolean);
  document.getElementById('fav-count').textContent = favs.length ? `${favs.length}곳` : '';
  document.getElementById('fav-grid').innerHTML = favs.length
    ? favs.map(favCardHtml).join('')
    : `<p class="empty">즐겨찾기한 리조트가 없습니다.
         지도에서 리조트를 클릭한 뒤 북마크 아이콘을 눌러 보세요.</p>`;

  // 여행 계획: trip-list.php가 시작일순(미정은 마지막)으로 보내므로, 지난 여행만 뒤집어 최근 것부터
  const today = todayYmd();
  const upcoming = [];
  const past = [];
  lastTrips.forEach((t) => {
    const s = tripStatus(t, today);
    (s.past ? past : upcoming).push(planRowHtml(t, s));
  });
  past.reverse();

  document.getElementById('plan-count').textContent = lastTrips.length ? `${lastTrips.length}건` : '';
  document.getElementById('plan-list').innerHTML = lastTrips.length
    ? `<h3 class="plan-group">다가오는 여행</h3>
       ${upcoming.join('') || '<p class="empty">예정된 여행이 없습니다.</p>'}
       ${past.length ? `<h3 class="plan-group">지난 여행</h3>${past.join('')}` : ''}`
    : '<p class="empty">아직 저장한 여행이 없습니다. 지도에서 리조트를 클릭해 추가해 보세요.</p>';
}

// ---------------------------------------------------------------------------
// 로그아웃: ski-auth-api가 Redis 세션을 지우므로 모든 서비스에서 동시에 로그아웃
// ---------------------------------------------------------------------------
async function logout() {
  await postJson(API.logout, {});
  location.href = 'login.html';
}
