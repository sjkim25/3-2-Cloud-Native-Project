<?php
/*
 * GET /trip/trip-list.php  (로그인 필요)
 * 로그인한 사용자의 여행 계획과 리조트 정보. 날짜를 고르지 않았으면(날짜 미정)
 * start_date / end_date 모두 NULL
 */
require_once __DIR__ . '/database.php';

$user = require_login();
$pdo  = get_db();

$stmt = $pdo->prepare(
    'SELECT t.id, t.visit_date AS start_date, t.end_date, t.memo, t.created_at,
            r.id AS resort_id, r.name_ko, r.name_en, r.country, r.lat, r.lon
       FROM trip t
       JOIN resort r ON r.id = t.resort_id
      WHERE t.email = ?
      ORDER BY t.visit_date IS NULL, t.visit_date, t.id'
);
$stmt->execute([$user['email']]);
$trips = $stmt->fetchAll();

foreach ($trips as &$t) {
    $t['id']        = (int)$t['id'];
    $t['resort_id'] = (int)$t['resort_id'];
    $t['lat']       = (float)$t['lat'];
    $t['lon']       = (float)$t['lon'];
    if ($t['start_date'] !== null && $t['end_date'] === null) {
        $t['end_date'] = $t['start_date'];
    }
}
unset($t);

json_out(['result' => 'ok', 'username' => $user['name'], 'trips' => $trips]);
