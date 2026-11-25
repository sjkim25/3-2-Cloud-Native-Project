-- 01-schema.sql — SkiPlan 스키마 + 초기 데이터
-- ski-db-data가 빈 볼륨일 때 ski-db 첫 실행에 한 번만 실행
-- (/docker-entrypoint-initdb.d).

SET NAMES utf8mb4;

-- DB 선택
USE skiplan;

-- user: 로그인 계정 (ski-auth-api)
CREATE TABLE IF NOT EXISTS user (
    idx   INT AUTO_INCREMENT PRIMARY KEY,
    name  VARCHAR(50)  NOT NULL,
    email VARCHAR(200) NOT NULL UNIQUE,     -- 로그인 ID 중복 가입 제한
    pass  VARCHAR(255) NOT NULL             -- bcrypt 해시를 담을 수 있는 길이
);

-- resort: 지도 마커로 표시할 스키장 (ski-trip-api가 조회)
-- 위도, 경도, 고도는 ski-snow-api의 날씨 조회에 그대로 사용
CREATE TABLE IF NOT EXISTS resort (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    name_ko   VARCHAR(100) NOT NULL,
    name_en   VARCHAR(100) NOT NULL,
    country   CHAR(2)      NOT NULL,        -- 'KR' or 'JP'
    region    VARCHAR(50)  NOT NULL,
    lat       DECIMAL(8,5) NOT NULL,
    lon       DECIMAL(8,5) NOT NULL,
    base_elev INT          NOT NULL,  
    top_elev  INT          NOT NULL,
    -- 정보 패널용 시설 정보. NULL = 비공개
    slopes     INT NULL,
    slopes_beg INT NULL,
    slopes_int INT NULL,
    slopes_adv INT NULL,
    lifts      INT NULL,
    longest_m  INT NULL
);

-- trip: 계획에 담은 스키장 (ski-trip-api CRUD)
CREATE TABLE IF NOT EXISTS trip (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    resort_id  INT          NOT NULL,
    visit_date DATE         NULL,
    memo       TEXT         NULL,
    email      VARCHAR(200) NOT NULL,                 -- 소유자 = 공유 세션의 이메일
    created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
    -- 스키장 삭제 시 해당 스키장의 여행 계획도 함께 삭제.
    FOREIGN KEY (resort_id) REFERENCES resort(id) ON DELETE CASCADE
);

-- 한국 10 + 일본 28
-- 좌표와 고도는 반올림한 근사값
-- 베이스, 정상 리프트 고도는 skiresort.info와 각 스키장 공식 사이트 (2026-11 수집).
INSERT INTO resort (name_ko, name_en, country, region, lat, lon, base_elev, top_elev) VALUES
-- 한국
('용평리조트',        'Yongpyong Resort',       'KR', '강원 평창', 37.64500, 128.68100,  750, 1458),
('알펜시아',          'Alpensia',               'KR', '강원 평창', 37.66000, 128.67200,  750,  950),
('휘닉스 평창',       'Phoenix Pyeongchang',    'KR', '강원 평창', 37.58200, 128.32200,  700, 1050),
('하이원리조트',      'High1 Resort',           'KR', '강원 정선', 37.20800, 128.82600,  900, 1340),
('오투리조트',        'O2 Resort',              'KR', '강원 태백', 37.18000, 128.95000, 1100, 1420),
('웰리힐리파크',      'Wellihilli Park',        'KR', '강원 횡성', 37.48700, 128.25000,  450, 1000),
('비발디파크',        'Vivaldi Park',           'KR', '강원 홍천', 37.64500, 127.68400,  250,  550),
('엘리시안 강촌',     'Elysian Gangchon',       'KR', '강원 춘천', 37.81700, 127.58700,  150,  400),
('곤지암리조트',      'Konjiam Resort',         'KR', '경기 광주', 37.33700, 127.29500,  150,  500),
('무주덕유산리조트',  'Muju Deogyusan Resort',  'KR', '전북 무주', 35.89000, 127.73700,  750, 1520),
-- 일본
('니세코 그랑 히라후', 'Niseko Grand Hirafu',   'JP', '홋카이도',  42.86100, 140.70300,  260, 1200),
('루스츠',            'Rusutsu',                'JP', '홋카이도',  42.74600, 140.90000,  400,  994),
('키로로',            'Kiroro',                 'JP', '홋카이도',  43.07600, 140.98500,  570, 1180),
('삿포로 테이네',     'Sapporo Teine',          'JP', '홋카이도',  43.08100, 141.20800,  230, 1023),
('후라노',            'Furano',                 'JP', '홋카이도',  43.32300, 142.35400,  245, 1074),
('하쿠바 핫포네',     'Hakuba Happo-one',       'JP', '나가노',    36.69700, 137.83200,  760, 1831),
('노자와 온천',       'Nozawa Onsen',           'JP', '나가노',    36.92000, 138.63000,  565, 1650),
('시가 고원',         'Shiga Kogen',            'JP', '나가노',    36.70000, 138.50000, 1340, 2307),
('나에바',            'Naeba',                  'JP', '니가타',    36.79000, 138.78000,  900, 1789),
('자오 온천',         'Zao Onsen',              'JP', '야마가타',  38.17000, 140.40000,  780, 1661),
('호시노 리조트 토마무', 'Hoshino Resorts Tomamu', 'JP', '홋카이도',  43.06705, 142.62181,  586, 1171),
('삿포로 국제',       'Sapporo Kokusai',        'JP', '홋카이도',  43.07301, 141.07024,  630, 1100),
('카무이 스키 링크스', 'Kamui Ski Links',        'JP', '홋카이도',  43.70095, 142.19934,  150,  751),
('사호로',            'Sahoro',                 'JP', '홋카이도',  43.16685, 142.81372,  410, 1030),
('하쿠바 고류',        'Hakuba Goryu',           'JP', '나가노',    36.66450, 137.83252,  750, 1676),
('쓰가이케 고원',      'Tsugaike Kogen',         'JP', '나가노',    36.75524, 137.85344,  800, 1704),
('하쿠바 이와타케',    'Hakuba Iwatake',         'JP', '나가노',    36.72439, 137.84158,  750, 1289),
('하쿠바 코르티나',    'Hakuba Cortina',         'JP', '나가노',    36.77877, 137.88249,  872, 1402),
('가루이자와 프린스',  'Karuizawa Prince',       'JP', '나가노',    36.33641, 138.64337,  940, 1155),
('마다라오 고원',      'Madarao Kogen',          'JP', '나가노',    36.84833, 138.27992,  942, 1382),
('갈라 유자와',        'GALA Yuzawa',            'JP', '니가타',    36.95055, 138.79967,  358, 1181),
('가구라',            'Kagura',                 'JP', '니가타',    36.84623, 138.77587,  620, 1845),
('묘코 아카쿠라 온천', 'Myoko Akakura',          'JP', '니가타',    36.89636, 138.16740,  687, 1491),
('롯데 아라이 리조트', 'Lotte Arai',             'JP', '니가타',    36.99087, 138.18160,  329, 1280),
('앗피 고원',          'Appi Kogen',             'JP', '이와테',    39.98724, 140.95827,  500, 1328),
('시즈쿠이시',         'Shizukuishi',            'JP', '이와테',    39.78443, 140.92032,  428, 1145),
('핫코다',            'Hakkoda',                'JP', '아오모리',  40.68153, 140.84645,  670, 1324),
('마루누마 고원',      'Marunuma Kogen',         'JP', '군마',      36.81148, 139.34643, 1388, 2000);

-- 시설 정보: 난이도별 슬로프 수, 리프트 수, 최장 코스
--   슬로프 수는 이름 별 측정. ex) 용평 "Rainbow 1"과 "Rainbow 2"는 2개
--   3단계: 초급 = 초급·초중급 / 중급 = 중급·중상급 / 상급 = 상급·최상급
--   한국: 각 스키장이 공개한 슬로프 목록에서 직접 측정 (NULL값은 표 제외)
--   일본: 코스 수와 초·중·상급 비율은 snowjapan.com
--   2026-11 수집. 다른 초기 데이터와 동일하게 name_en으로 대상을 검색.
UPDATE resort SET slopes = 19, slopes_beg =    4, slopes_int =    5, slopes_adv =   10, lifts = 14, longest_m =  5600 WHERE name_en = 'Yongpyong Resort';
UPDATE resort SET slopes =  6, slopes_beg = NULL, slopes_int = NULL, slopes_adv = NULL, lifts =  3, longest_m =  1351 WHERE name_en = 'Alpensia';
UPDATE resort SET slopes = 17, slopes_beg = NULL, slopes_int = NULL, slopes_adv = NULL, lifts =  9, longest_m =  2400 WHERE name_en = 'Phoenix Pyeongchang';
UPDATE resort SET slopes = 21, slopes_beg =    7, slopes_int =    3, slopes_adv =   11, lifts = 10, longest_m =  2328 WHERE name_en = 'High1 Resort';
UPDATE resort SET slopes = 12, slopes_beg = NULL, slopes_int = NULL, slopes_adv = NULL, lifts =  6, longest_m =  3200 WHERE name_en = 'O2 Resort';
UPDATE resort SET slopes = 20, slopes_beg =    7, slopes_int =    3, slopes_adv =   10, lifts =  8, longest_m =  2600 WHERE name_en = 'Wellihilli Park';
UPDATE resort SET slopes = 10, slopes_beg =    2, slopes_int =    7, slopes_adv =    1, lifts =  7, longest_m =   900 WHERE name_en = 'Vivaldi Park';
UPDATE resort SET slopes = 10, slopes_beg =    3, slopes_int =    5, slopes_adv =    2, lifts =  6, longest_m =  NULL WHERE name_en = 'Elysian Gangchon';
UPDATE resort SET slopes =  9, slopes_beg = NULL, slopes_int = NULL, slopes_adv = NULL, lifts =  5, longest_m =  1800 WHERE name_en = 'Konjiam Resort';
UPDATE resort SET slopes = 34, slopes_beg = NULL, slopes_int = NULL, slopes_adv = NULL, lifts = 13, longest_m =  6100 WHERE name_en = 'Muju Deogyusan Resort';
UPDATE resort SET slopes = 30, slopes_beg =    9, slopes_int =   11, slopes_adv =   10, lifts = 11, longest_m =  5600 WHERE name_en = 'Niseko Grand Hirafu';
UPDATE resort SET slopes = 37, slopes_beg =   11, slopes_int =   15, slopes_adv =   11, lifts = 22, longest_m =  3500 WHERE name_en = 'Rusutsu';
UPDATE resort SET slopes = 23, slopes_beg =    9, slopes_int =    7, slopes_adv =    7, lifts = 11, longest_m =  4050 WHERE name_en = 'Kiroro';
UPDATE resort SET slopes = 15, slopes_beg =    5, slopes_int =    6, slopes_adv =    4, lifts = 11, longest_m =  6000 WHERE name_en = 'Sapporo Teine';
UPDATE resort SET slopes = 28, slopes_beg =   11, slopes_int =   11, slopes_adv =    6, lifts = 11, longest_m =  4000 WHERE name_en = 'Furano';
UPDATE resort SET slopes = 16, slopes_beg =    5, slopes_int =    8, slopes_adv =    3, lifts = 22, longest_m =  8000 WHERE name_en = 'Hakuba Happo-one';
UPDATE resort SET slopes = 36, slopes_beg =   14, slopes_int =   11, slopes_adv =   11, lifts = 19, longest_m = 10000 WHERE name_en = 'Nozawa Onsen';
UPDATE resort SET slopes = 80, slopes_beg =   24, slopes_int =   32, slopes_adv =   24, lifts = 48, longest_m =  6000 WHERE name_en = 'Shiga Kogen';
UPDATE resort SET slopes = 24, slopes_beg =    7, slopes_int =   10, slopes_adv =    7, lifts = 15, longest_m =  4000 WHERE name_en = 'Naeba';
UPDATE resort SET slopes = 25, slopes_beg =   10, slopes_int =   10, slopes_adv =    5, lifts = 36, longest_m = 10000 WHERE name_en = 'Zao Onsen';
UPDATE resort SET slopes = 29, slopes_beg =    9, slopes_int =   11, slopes_adv =    9, lifts =  7, longest_m =  4200 WHERE name_en = 'Hoshino Resorts Tomamu';
UPDATE resort SET slopes =  7, slopes_beg =    2, slopes_int =    4, slopes_adv =    1, lifts =  5, longest_m =  3600 WHERE name_en = 'Sapporo Kokusai';
UPDATE resort SET slopes = 25, slopes_beg =    8, slopes_int =    9, slopes_adv =    8, lifts =  7, longest_m =  3500 WHERE name_en = 'Kamui Ski Links';
UPDATE resort SET slopes = 21, slopes_beg =    5, slopes_int =    9, slopes_adv =    7, lifts =  9, longest_m =  3000 WHERE name_en = 'Sahoro';
UPDATE resort SET slopes = 16, slopes_beg =    6, slopes_int =    6, slopes_adv =    4, lifts = 13, longest_m =  5000 WHERE name_en = 'Hakuba Goryu';
UPDATE resort SET slopes = 10, slopes_beg =    5, slopes_int =    3, slopes_adv =    2, lifts = 18, longest_m =  5000 WHERE name_en = 'Tsugaike Kogen';
UPDATE resort SET slopes = 26, slopes_beg =    8, slopes_int =   13, slopes_adv =    5, lifts = 10, longest_m =  3800 WHERE name_en = 'Hakuba Iwatake';
UPDATE resort SET slopes = 16, slopes_beg =    6, slopes_int =    5, slopes_adv =    5, lifts =  6, longest_m =  3500 WHERE name_en = 'Hakuba Cortina';
UPDATE resort SET slopes = 14, slopes_beg =    8, slopes_int =    3, slopes_adv =    3, lifts =  8, longest_m =  1200 WHERE name_en = 'Karuizawa Prince';
UPDATE resort SET slopes = 30, slopes_beg =    9, slopes_int =   11, slopes_adv =   10, lifts =  9, longest_m =  2500 WHERE name_en = 'Madarao Kogen';
UPDATE resort SET slopes = 16, slopes_beg =    6, slopes_int =    7, slopes_adv =    3, lifts = 13, longest_m =  4120 WHERE name_en = 'GALA Yuzawa';
UPDATE resort SET slopes = 30, slopes_beg =   11, slopes_int =   13, slopes_adv =    6, lifts = 20, longest_m =  6000 WHERE name_en = 'Kagura';
UPDATE resort SET slopes = 27, slopes_beg =   13, slopes_int =    8, slopes_adv =    6, lifts = 21, longest_m =  4500 WHERE name_en = 'Myoko Akakura';
UPDATE resort SET slopes = 14, slopes_beg =    5, slopes_int =    5, slopes_adv =    4, lifts =  6, longest_m =  7000 WHERE name_en = 'Lotte Arai';
UPDATE resort SET slopes = 21, slopes_beg =    6, slopes_int =    9, slopes_adv =    6, lifts =  8, longest_m =  5500 WHERE name_en = 'Appi Kogen';
UPDATE resort SET slopes = 20, slopes_beg =    8, slopes_int =    8, slopes_adv =    4, lifts =  7, longest_m =  2648 WHERE name_en = 'Shizukuishi';
UPDATE resort SET slopes =  5, slopes_beg =    1, slopes_int =    3, slopes_adv =    1, lifts =  2, longest_m =  5000 WHERE name_en = 'Hakkoda';
UPDATE resort SET slopes = 11, slopes_beg =    2, slopes_int =    6, slopes_adv =    3, lifts =  9, longest_m =  4000 WHERE name_en = 'Marunuma Kogen';