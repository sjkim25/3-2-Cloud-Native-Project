-- 02-snow-history.sql — 끝난 스키 시즌의 적설 기록 영구 저장 (ski-snow-api가 기록)
-- 과거 시즌(11월~4월)값은 동일하므로 장소마다 Open-Meteo에서 한 번만 받아 저장, 이후에는 모든 사용자가 이 값을 읽음
-- 진행 중인 시즌은 매일 바뀌므로 저장하지 않음
SET NAMES utf8mb4;
USE skiplan;

CREATE TABLE IF NOT EXISTS snow_history (
    cache_key   VARCHAR(100) NOT NULL,  -- 장소 키: "pt:37.65:128.68:1104"(스키장) 또는 "region:R2297418"(지역)
    season      VARCHAR(7)   NOT NULL,  -- "2016-17" 형식
    total_cm    DECIMAL(7,1) NOT NULL,  -- 11월 1일 ~ 4월 30일 누적 적설량
    record_date DATE         NULL,      -- 해당 시즌 하루 적설량이 가장 많았던 날
    record_cm   DECIMAL(6,1) NULL,
    fetched_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    -- 장소, 시즌당 한 행만 허용, 같은 시즌을 다시 저장하면 upsert로 덮어씀
    PRIMARY KEY (cache_key, season)
);
