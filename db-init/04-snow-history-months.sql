-- 04-snow-history-months.sql — 저장된 시즌별 월간 적설량
-- snow_history.months에 11월~4월 6개월 합계를 JSON으로 저장
-- 이 컬럼 생성 전 저장된 행은 months = NULL, ski-snow-api가 그 시즌만 한 번 더 받아와 채움

SET NAMES utf8mb4;
USE skiplan;

SET @has_months := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = 'skiplan' AND TABLE_NAME = 'snow_history' AND COLUMN_NAME = 'months'
);
SET @sql := IF(@has_months = 0,
    'ALTER TABLE snow_history ADD COLUMN months JSON NULL AFTER record_cm',
    'SELECT ''snow_history.months already exists'' AS info');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
