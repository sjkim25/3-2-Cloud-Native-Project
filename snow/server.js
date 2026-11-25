/**
 * ski-snow-api — SkiPlan 적설 서비스 Node.js / Express
 *
 * 엔드포인트 (프록시 뒤에서는 skiplan.com/snow/..., NPM이 "/snow"를 뗌):
 *   GET /session-check               이 서버가 보는 로그인 사용자
 *   GET /region?lat=&lon=            한 지점이 속한 행정구역 (시/군/구, 市町村)
 *   GET /forecast?lat=&lon=&elev=    한 지점의 예보 (리조트 모드)
 *   GET /forecast?region=<id>        표본 지점 최대 6개의 평균 예보 (지역 모드)
 *   GET /history?lat=&lon=&elev=     지난 10번의 겨울 + 현재 시즌 적설량
 *   GET /history?region=<id>         같은 내용, 지역에서 가장 중심에 있는 표본 지점 기준
 *   기록의 시즌마다 11월~4월 월별 합계도 포함.
 *
 * 외부 서비스:
 *   Open-Meteo (날씨)         https://open-meteo.com
 *   Nominatim  (행정구역 조회) https://nominatim.openstreetmap.org
 *     이용 정책: https://operations.osmfoundation.org/policies/nominatim/
 *     준수 사항: 초당 최대 1회 요청(아래 대기열), 앱을 식별하는 User-Agent,
 *     사용자가 클릭할 때만 호출, 모든 결과를 Redis에 30일간 캐시.
 *
 * 저장소: Redis = 공유 로그인 세션(ski-auth-api가 기록), 행정구역 경계,
 * 단기 날씨 캐시. MySQL snow_history = 끝난 시즌, 영구 보관.
 */

const express = require('express');
const { createClient } = require('redis');
const mysql = require('mysql2/promise');

// ---------------------------------------------------------------------------
// 설정 (docker run -e), 기본값은 ski-net의 컨테이너 이름
// ---------------------------------------------------------------------------
const REDIS_HOST = process.env.REDIS_HOST || 'ski-redis';
// Nominatim은 앱을 식별하는 User-Agent를 요구함 (위의 이용 정책)
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'SkiPlan/1.0 (Cloud Native class project)';

const PORT = 80;
const SERVER_NAME = 'ski-snow-api';
const SESSION_COOKIE = 'SKISESSID';

const FORECAST_TTL = 1800;        // 30분: 예보는 하루에 몇 번만 갱신
const HISTORY_TTL = 6 * 3600;     // 6시간: 끝난 시즌은 MySQL에 존재하기 때문에 갱신할 때는 현재 시즌만 다시 받음
const REGION_TTL = 30 * 86400;    // 30일: 행정구역 경계는 거의 바뀌지 않음

const HISTORY_YEARS = 10;         // 분석할 지난 겨울 수
const FORECAST_POINTS = 6;        // 예보에 쓰는 지역당 표본 지점 수
const HISTORY_POINTS = 1;         // 기록은 1개 지점만: 긴 기간일수록 Open-Meteo 사용량을 더 차감
const SEASON_MONTHS = [11, 12, 1, 2, 3, 4];   // 시즌 월 순서 (11월 → 4월)

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

const NOT_LOGGED_IN = { result: 'no', msg: '로그인을 해주십시오.' };

const app = express();
const redis = createClient({ url: `redis://${REDIS_HOST}:6379` });
redis.on('error', (err) => console.error('[redis]', err.message));
// snow_history용 MySQL 풀: 요청마다 새로 연결하지 않고 연결 몇 개를 열어 둔 채 재사용
// ski-auth-api, ski-trip-api와 같은 환경 변수 사용
const db = mysql.createPool({
  host: process.env.DB_HOST || 'ski-db',
  user: process.env.DB_USER || 'skiplan',
  password: process.env.DB_PASS || 'skiplan123',
  database: process.env.DB_NAME || 'skiplan',
  charset: 'utf8mb4',
  connectionLimit: 5,
  dateStrings: true,   // DATE 컬럼을 JS Date 객체가 아닌 "2021-01-07" 문자열로 받음
});

// ---------------------------------------------------------------------------
// 공통 함수
// ---------------------------------------------------------------------------
function sendJson(res, data, status = 200) {
  res.status(status).json({ ...data, server: SERVER_NAME });
}

const round1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

/** 여러 Open-Meteo 결과에서 i번째 값의 평균 (값이 없는 것은 제외) */
function meanAt(results, getArray, i) {
  let sum = 0;
  let n = 0;
  for (const r of results) {
    const v = getArray(r)[i];
    if (v !== null && v !== undefined) { sum += v; n++; }
  }
  return n ? sum / n : null;
}

/** 배열에서 고르게 퍼진 항목을 최대 `max`개 고름 */
function pickSpread(arr, max) {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  return Array.from({ length: max }, (_, k) => arr[Math.floor(k * step)]);
}

/** 전체 지점의 중심에 가장 가까운 `max`개 지점 (지역의 대표 위치) */
function mostCentral(points, max) {
  const cLat = mean(points.map((p) => p.lat));
  const cLon = mean(points.map((p) => p.lon));
  const dist = (p) => (p.lat - cLat) ** 2 + (p.lon - cLon) ** 2;
  return [...points].sort((a, b) => dist(a) - dist(b)).slice(0, max);
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}

/** PHP 세션 문자열(ski-auth-api가 기록) - 객체 */
function phpUnserialize(raw) {
  const data = {};
  for (const m of raw.matchAll(/(\w+)\|s:\d+:"(.*?)";/g)) data[m[1]] = m[2];
  return data;
}

/** ?lat=&lon=&elev= 검사 (elev는 선택). 잘못되면 null */
function parseLatLon(q) {
  if (!q.lat || !q.lon) return null;
  const lat = Number(q.lat);
  const lon = Number(q.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  let elev = null;
  if (q.elev !== undefined && q.elev !== '') {
    elev = Number(q.elev);
    if (!Number.isFinite(elev) || elev < 0 || elev > 9000) return null;
    elev = Math.round(elev);
  }
  return { lat, lon, elev };
}

/** URL을 GET 해서 JSON으로 파싱, 15초 타임아웃 */
async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${new URL(url).host}: ${await res.text()}`);
    err.status = res.status;   // ex) 429 = 요청 한도 초과
    throw err;
  }
  return res.json();
}

function weatherErrorMsg(err, fallback) {
  return err.status === 429
    ? '날씨 API 요청 한도를 잠시 초과했습니다. 1분 정도 후 다시 시도해 주세요.'
    : fallback;
}

/** cache-aside: Redis를 먼저 보고, 없으면 loader()를 실행해 결과를 TTL과 함께 저장 */
async function getCached(key, ttl, loader) {
  const hit = await redis.get(key);
  if (hit) return { data: JSON.parse(hit), cached: true };
  const data = await loader();
  await redis.set(key, JSON.stringify(data), { EX: ttl });
  return { data, cached: false };
}

// ---------------------------------------------------------------------------
// 로그인 확인 미들웨어: ski-auth-api가 Redis에 저장한 세션을 읽음
// ---------------------------------------------------------------------------
async function requireLogin(req, res, next) {
  try {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!sid) return sendJson(res, NOT_LOGGED_IN);
    const raw = await redis.get(`session:${sid}`);
    const data = raw ? phpUnserialize(raw) : {};
    if (!data.useremail) return sendJson(res, NOT_LOGGED_IN);
    req.user = { email: data.useremail, name: data.username || '' };
    next();
  } catch (err) {
    console.error('[session]', err.message);
    sendJson(res, { result: 'no', msg: 'Redis 연결 실패' }, 500);
  }
}

// ---------------------------------------------------------------------------
// Open-Meteo: 한 요청에 여러 위치를 담을 수 있음
// (latitude=37.1,37.2&longitude=128.1,128.2). 이때 응답은 위치마다 결과가 하나씩인 배열이고, 위치가 하나면 일반 객체.
// ---------------------------------------------------------------------------
async function fetchOpenMeteo(baseUrl, params, points) {
  const qs = new URLSearchParams({
    ...params,
    latitude: points.map((p) => p.lat).join(','),
    longitude: points.map((p) => p.lon).join(','),
  });
  // 모든 지점에 고도가 있을 때만 고도 지정, 지역은 모델의 지형 고도 사용
  if (points.every((p) => p.elev !== null && p.elev !== undefined)) {
    qs.set('elevation', points.map((p) => p.elev).join(','));
  }
  const data = await fetchJson(`${baseUrl}?${qs}`);
  return Array.isArray(data) ? data : [data];
}

/** 예보: 지난 7일 + 앞으로 16일, 모든 지점의 평균 */
async function loadForecast(points) {
  const list = await fetchOpenMeteo(FORECAST_URL, {
    daily: 'snowfall_sum,temperature_2m_max,temperature_2m_min',
    hourly: 'snow_depth',
    past_days: 7,
    forecast_days: 16,
    timezone: 'auto',
  }, points);
  const first = list[0]; // 모든 위치의 날짜·시간이 같음

  // open-Meteo의 현지 시각과 맞추기
  const nowLocal = new Date(Date.now() + first.utc_offset_seconds * 1000).toISOString();
  const today = nowLocal.slice(0, 10);
  const thisHour = nowLocal.slice(0, 13) + ':00';

  // 시간별 적설 깊이(m): 지점 평균을 내고 날마다 최댓값만 보관
  const depthByDay = {};
  let currentDepth = null;
  first.hourly.time.forEach((t, i) => {
    const v = meanAt(list, (r) => r.hourly.snow_depth, i);
    if (t === thisHour) currentDepth = v;
    if (v === null) return;
    const d = t.slice(0, 10);
    depthByDay[d] = Math.max(depthByDay[d] ?? 0, v);
  });

  const days = first.daily.time.map((date, i) => ({
    date,
    snowfall_cm: round1(meanAt(list, (r) => r.daily.snowfall_sum, i)),
    tmax: round1(meanAt(list, (r) => r.daily.temperature_2m_max, i)),
    tmin: round1(meanAt(list, (r) => r.daily.temperature_2m_min, i)),
    snow_depth_cm: depthByDay[date] !== undefined ? round1(depthByDay[date] * 100) : null,
  }));

  const recent = days.filter((d) => d.date < today);
  const forecast = days.filter((d) => d.date >= today);
  const total = (arr) => round1(arr.reduce((s, d) => s + (d.snowfall_cm || 0), 0));

  return {
    location: {
      points: list.length,
      elevation: Math.round(mean(list.map((r) => r.elevation))),
      timezone: first.timezone,
    },
    current: { time: thisHour, snow_depth_cm: currentDepth === null ? null : round1(currentDepth * 100) },
    recent: { days: recent, total_cm: total(recent) },
    forecast: { days: forecast, total_cm: total(forecast) },
  };
}

/**
 * 분석할 날짜 구간, 시즌마다 하나 (11월 1일 – 4월 30일):
 * 끝난 시즌 HISTORY_YEARS개 + 현재 시즌(partial: true)
 */
function seasonWindows() {
  const now = new Date();
  // 7월부터는 올해 11월에 시작하는 시즌이 현재(다가오는) 시즌
  const seasonStartYear = now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  // archive API는 실제 시간보다 며칠 늦음
  const endDate = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const seasonLabel = (y) => `${y}-${String(y + 1).slice(2)}`; // 2025 → "2025-26"

  const windows = [];
  for (let y = seasonStartYear - HISTORY_YEARS; y <= seasonStartYear; y++) {
    const start = `${y}-11-01`;
    if (start > endDate) continue; // 아직 시작 안 한 시즌
    const seasonEnd = `${y + 1}-04-30`;
    windows.push({
      season: seasonLabel(y),
      start,
      end: seasonEnd < endDate ? seasonEnd : endDate,
      partial: y === seasonStartYear,
    });
  }
  return { windows, endDate };
}

/**
 * 시즌 구간 하나의 총 적설량, 하루 최대 적설, 월별 합계.
 * 월별 합계는 같은 일별 값으로 계산하므로 API를 추가로 호출하지 않음.
 */
function summarizeWindow(w, list) {
  let total = 0;
  let rec = null;
  const months = SEASON_MONTHS.map((month) => ({ month, sum: 0, days: 0 }));

  list[0].daily.time.forEach((date, i) => {
    const v = meanAt(list, (r) => r.daily.snowfall_sum, i);
    if (v === null) return;
    total += v;
    if (!rec || v > rec.cm) rec = { date, cm: v };
    const m = months[SEASON_MONTHS.indexOf(Number(date.slice(5, 7)))];   // "2021-01-07" → 1 → 1월 칸
    m.sum += v;
    m.days += 1;
  });

  return {
    season: w.season,
    partial: w.partial,
    total_cm: round1(total),
    record_date: rec ? rec.date : null,
    record_cm: rec ? round1(rec.cm) : null,
    // days = 0 → 아직 오지 않은 달(현재 시즌) → total_cm null
    months: months.map((m) => ({ month: m.month, total_cm: m.days ? round1(m.sum) : null, days: m.days })),
  };
}

/**
 * 영구 저장을 쓰는 적설 기록:
 *   1) 이 장소의 끝난 시즌을 MySQL에서 읽음
 *   2) Open-Meteo에서는 빠진 시즌 + 현재 시즌만 받음
 *   3) 새로 받은 끝난 시즌을 MySQL에 저장 (이후 모든 사용자가 공유)
 *   4) 합쳐서 요약
 * MySQL에 연결할 수 없으면 모두 API에서 받음
 */
async function loadHistory(points, key) {
  const { windows, endDate } = seasonWindows();

  const stored = new Map();
  let dbOk = true;
  try {
    const [rows] = await db.query(
      'SELECT season, total_cm, record_date, record_cm, months FROM snow_history WHERE cache_key = ?',
      [key],
    );
    rows.forEach((r) => {
      // months 컬럼이 생기기 전에 저장된 행은 months = NULL
      // 건너뛰면 아래에서 다시 받아 months와 함께 갱신
      if (r.months === null) return;
      stored.set(r.season, {
        season: r.season,
        partial: false,
        total_cm: Number(r.total_cm),
        record_date: r.record_date,
        record_cm: r.record_cm === null ? null : Number(r.record_cm),
        // 문자열로 오면 여기서 파싱
        months: typeof r.months === 'string' ? JSON.parse(r.months) : r.months,
      });
    });
  } catch (err) {
    dbOk = false;
    console.error('[history-db] read failed, using API only:', err.message);
  }

  const toFetch = windows.filter((w) => w.partial || !stored.has(w.season));
  const results = await Promise.all(toFetch.map((w) => fetchOpenMeteo(ARCHIVE_URL, {
    start_date: w.start,
    end_date: w.end,
    daily: 'snowfall_sum',
    timezone: 'auto',
  }, points)));
  const fetched = toFetch.map((w, k) => summarizeWindow(w, results[k]));

  // upsert: 새 시즌은 INSERT, 이미 있는 행은 기본 키 중복으로 실패하는 대신 UPDATE됨
  const newRows = fetched.filter((s) => !s.partial);
  if (dbOk && newRows.length) {
    try {
      await db.query(
        `INSERT INTO snow_history (cache_key, season, total_cm, record_date, record_cm, months)
         VALUES ? AS new
         ON DUPLICATE KEY UPDATE total_cm = new.total_cm, record_date = new.record_date,
                                 record_cm = new.record_cm, months = new.months,
                                 fetched_at = CURRENT_TIMESTAMP`,
        [newRows.map((s) => [key, s.season, s.total_cm, s.record_date, s.record_cm, JSON.stringify(s.months)])],
      );
    } catch (err) {
      console.error('[history-db] save failed:', err.message);
    }
  }

  const all = windows.map((w) => stored.get(w.season) || fetched.find((s) => s.season === w.season));

  let record = null;
  all.forEach((s) => {
    if (s.record_cm !== null && (!record || s.record_cm > record.snowfall_cm)) {
      record = { date: s.record_date, snowfall_cm: s.record_cm };
    }
  });

  const seasons = all.map((s) => ({ season: s.season, total_cm: s.total_cm, partial: s.partial, months: s.months }));
  const complete = seasons.filter((s) => !s.partial);
  const snowiest = complete.reduce((best, s) => (!best || s.total_cm > best.total_cm ? s : best), null);
  const average = complete.length ? round1(mean(complete.map((s) => s.total_cm))) : null;

  return {
    location: { points: points.length },
    period: { start: windows.length ? windows[0].start : null, end: endDate },
    source: { db: stored.size, api: fetched.length },
    record_day: record,
    snowiest_season: snowiest,
    average_season_cm: average,
    seasons,
  };
}

// ---------------------------------------------------------------------------
// Nominatim: 한 지점이 속한 행정구역(시/군/구, 市町村) 찾기
// ---------------------------------------------------------------------------

// 요청 제한: promise 체인으로 호출이 차례를 기다리게 해서 최소 1.1초 간격 유지.
// 대기열은 이 컨테이너 안에만 있으므로, 복제본이 여러 개라면 제한을 지키기 위해 Redis로 옮겨야 함.
let nominatimChain = Promise.resolve();
let nominatimLast = 0;

function nominatimFetch(url) {
  const task = async () => {
    const wait = nominatimLast + 1100 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    nominatimLast = Date.now();
    return fetchJson(url, { 'User-Agent': NOMINATIM_USER_AGENT });
  };
  const result = nominatimChain.then(task, task);
  nominatimChain = result.catch(() => {});
  return result;
}

/**
 * zoom 설정
 *   8  ≈ 군 단위 → 한국 시/군/구
 *   10 ≈ 시 단위 → 일본 市町村
 */
function nominatimReverse(lat, lon, zoom) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat,
    lon,
    zoom,
    polygon_geojson: 1,
    polygon_threshold: 0.003,
    namedetails: 1,
    addressdetails: 1,
  });
  return nominatimFetch(`${NOMINATIM_URL}?${params}`);
}

const isArea = (g) => g && (g.type === 'Polygon' || g.type === 'MultiPolygon');

/** 레이 캐스팅 방식의 점-다각형 포함 검사 (x = 경도, y = 위도) */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolygon(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(x, y, hole));
}
function pointInGeometry(x, y, g) {
  if (g.type === 'Polygon') return pointInPolygon(x, y, g.coordinates);
  return g.coordinates.some((poly) => pointInPolygon(x, y, poly));
}


// 평균용 표본 지점: 지역의 경계 상자 위에 6×6 격자를 놓고 경계 안의 점만 남긴 뒤 고르게 퍼지게 최대 FORECAST_POINTS개 선택
function samplePoints(geometry, [west, south, east, north], click) {
  const N = 6;
  const inside = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const lon = west + ((east - west) * (i + 0.5)) / N;
      const lat = south + ((north - south) * (j + 0.5)) / N;
      if (pointInGeometry(lon, lat, geometry)) inside.push({ lat: round3(lat), lon: round3(lon), elev: null });
    }
  }
  if (!inside.length) return [{ lat: round3(click.lat), lon: round3(click.lon), elev: null }];
  return pickSpread(inside, FORECAST_POINTS);
}

// 클릭 위치의 행정구역 조회. region 객체 또는 null 반환 
async function findRegion(lat, lon) {
  let r = await nominatimReverse(lat, lon, 10);
  if (r.error) return null;

  const country = (r.address?.country_code || '').toLowerCase();
  // 한국은 zoom 10이면 읍/면/동이라 너무 작음 - 시/군/구 수준으로 다시 조회
  // zoom 10에서 지역 경계가 오지 않았을 때도 다시 조회
  if (country === 'kr' || !isArea(r.geojson)) {
    const r8 = await nominatimReverse(lat, lon, 8);
    if (!r8.error && isArea(r8.geojson)) r = r8;
  }
  if (!isArea(r.geojson)) return null;

  // 바다를 클릭하면 가장 가까운 해안 지역이 올 수 있기 때문에 경계 밖의 점은 거부
  if (!pointInGeometry(lon, lat, r.geojson)) return null;

  const nd = r.namedetails || {};
  const [south, north, west, east] = r.boundingbox.map(Number);
  const bbox = [west, south, east, north];

  return {
    id: `${r.osm_type[0].toUpperCase()}${r.osm_id}`,
    country: country.toUpperCase(),
    name: nd.name || r.name,
    // 한국어 이름. 한국어 이름이 없는 일본 지역은 일본어보다 영어 우선
    name_ko: nd['name:ko'] || (country === 'kr' ? nd.name : nd['name:en'] || nd.name) || r.name,
    name_en: nd['name:en'] || nd.int_name || r.name,
    bbox,
    geometry: r.geojson,
    points: samplePoints(r.geojson, bbox, { lat, lon }),
  };
}

/** ?region=<id> 또는 ?lat=&lon=&elev= → 캐시 키 + 지점 목록 */
async function resolvePoints(q) {
  if (q.region !== undefined) {
    if (!/^[NWR]\d+$/.test(q.region)) return { error: '지역 ID가 올바르지 않습니다.' };
    const raw = await redis.get(`snow:region:${q.region}`);
    if (!raw) return { error: '지역 정보가 만료되었습니다. 지도를 다시 클릭해 주세요.' };
    return { key: `region:${q.region}`, points: JSON.parse(raw).points };
  }
  const p = parseLatLon(q);
  if (!p) return { error: '위치(lat, lon) 값이 올바르지 않습니다.' };
  // 0.01°(약 1 km)로 반올림해서 가까운 클릭끼리 캐시 항목 하나를 공유
  const pt = { lat: round2(p.lat), lon: round2(p.lon), elev: p.elev };
  return { key: `pt:${pt.lat}:${pt.lon}:${pt.elev ?? 'auto'}`, points: [pt] };
}

// ---------------------------------------------------------------------------
// 라우트
// ---------------------------------------------------------------------------
app.get('/', (req, res) => sendJson(res, { result: 'ok' }));

app.get('/session-check', requireLogin, (req, res) => {
  sendJson(res, { result: 'ok', username: req.user.name, useremail: req.user.email });
});

app.get('/region', requireLogin, async (req, res) => {
  const p = parseLatLon(req.query);
  if (!p) return sendJson(res, { result: 'no', msg: '위치(lat, lon) 값이 올바르지 않습니다.' }, 400);

  try {
    // 캐시 항목 두 개: 클릭 위치(약 100 m로 반올림) - 지역 ID, 지역 ID - 지역
    const atKey = `snow:regionAt:${round3(p.lat)}:${round3(p.lon)}`;
    const cachedId = await redis.get(atKey);
    const cachedRegion = cachedId ? await redis.get(`snow:region:${cachedId}`) : null;
    if (cachedRegion) return sendJson(res, { result: 'ok', cached: true, region: JSON.parse(cachedRegion) });

    const region = await findRegion(p.lat, p.lon);
    if (!region) {
      return sendJson(res, { result: 'no', msg: '이 위치의 행정구역을 찾지 못했습니다. (바다·경계 근처라면 조금 안쪽을 클릭해 주세요)' });
    }
    await redis.set(`snow:region:${region.id}`, JSON.stringify(region), { EX: REGION_TTL });
    await redis.set(atKey, region.id, { EX: REGION_TTL });
    sendJson(res, { result: 'ok', cached: false, region });
  } catch (err) {
    console.error('[region]', err.message);
    sendJson(res, { result: 'no', msg: '행정구역 정보를 가져오지 못했습니다.' }, 502);
  }
});

app.get('/forecast', requireLogin, async (req, res) => {
  try {
    const target = await resolvePoints(req.query);
    if (target.error) return sendJson(res, { result: 'no', msg: target.error }, 400);
    const { data, cached } = await getCached(`snow:forecast:${target.key}`, FORECAST_TTL,
      () => loadForecast(target.points));
    sendJson(res, { result: 'ok', cached, ...data });
  } catch (err) {
    console.error('[forecast]', err.message);
    sendJson(res, { result: 'no', msg: '예보 정보를 가져오지 못했습니다.' }, 502);
  }
});

app.get('/history', requireLogin, async (req, res) => {
  try {
    const target = await resolvePoints(req.query);
    if (target.error) return sendJson(res, { result: 'no', msg: target.error }, 400);
    const points = mostCentral(target.points, HISTORY_POINTS);
    const { data, cached } = await getCached(`snow:history:${target.key}`, HISTORY_TTL,
      () => loadHistory(points, target.key));
    sendJson(res, { result: 'ok', cached, ...data });
  } catch (err) {
    console.error('[history]', err.message);
    sendJson(res, { result: 'no', msg: weatherErrorMsg(err, '과거 적설 정보를 가져오지 못했습니다.') }, 502);
  }
});

// ---------------------------------------------------------------------------
// 시작: 먼저 Redis에 연결, 실패하면 종료해서 --restart unless-stopped가 다시 시작하게 함
// ---------------------------------------------------------------------------
async function start() {
  await redis.connect();
  app.listen(PORT, '0.0.0.0', () => console.log(`${SERVER_NAME} listening on :${PORT}`));
}

start().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
