-- 03-favorite-and-trip-period.sql
--   1) favorite 테이블: 즐겨찾기한 스키장. 내 여행 페이지에 표시
--   2) trip.end_date: 여행을 기간으로 저장
--
-- 새 설치 시엔 빈 볼륨에서 01, 02 다음 자동 실행, 기존 DB에는 직접 한 번 적용

SET NAMES utf8mb4;
USE skiplan;

CREATE TABLE IF NOT EXISTS favorite (
    email      VARCHAR(200) NOT NULL,              -- 소유자 = 공유 세션의 이메일
    resort_id  INT          NOT NULL,
    created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
    -- (사용자, 스키장) 쌍을 키로 설정. 스키장 당 한 번만 즐겨찾기 가능
    PRIMARY KEY (email, resort_id),
    FOREIGN KEY (resort_id) REFERENCES resort(id) ON DELETE CASCADE
);

-- trip.end_date: 여행 마지막 날. 날짜를 고르지 않으면 NULL
SET @has_end_date := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = 'skiplan' AND TABLE_NAME = 'trip' AND COLUMN_NAME = 'end_date'
);
SET @sql := IF(@has_end_date = 0,
    'ALTER TABLE trip ADD COLUMN end_date DATE NULL AFTER visit_date',
    'SELECT ''trip.end_date already exists'' AS info');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
