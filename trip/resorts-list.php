<?php
/*
 * GET /trip/resorts-list.php  (로그인 불필요)
 * 지도 마커와 정보 패널에 쓸 모든 리조트
 */
require_once __DIR__ . '/database.php';

$pdo  = get_db();
$rows = $pdo->query(
    'SELECT id, name_ko, name_en, country, region, lat, lon, base_elev, top_elev,
            slopes, slopes_beg, slopes_int, slopes_adv, lifts, longest_m
       FROM resort
      ORDER BY country DESC, id'
)->fetchAll();

foreach ($rows as &$row) {
    $row['id']        = (int)$row['id'];
    $row['lat']       = (float)$row['lat'];
    $row['lon']       = (float)$row['lon'];
    $row['base_elev'] = (int)$row['base_elev'];
    $row['top_elev']  = (int)$row['top_elev'];
    // null은 그대로, 아니면 숫자로
    foreach (['slopes', 'slopes_beg', 'slopes_int', 'slopes_adv', 'lifts', 'longest_m'] as $k) {
        $row[$k] = $row[$k] === null ? null : (int)$row[$k];
    }
}
unset($row);

json_out(['result' => 'ok', 'count' => count($rows), 'resorts' => $rows]);
