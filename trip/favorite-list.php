<?php
/*
 * GET /trip/favorite-list.php  (로그인 필요)
 * 로그인한 사용자가 즐겨찾기한 리조트 ID, 최신순. ID만 보내는 이유:
 * 프론트엔드가 resorts-list.php로 모든 리조트 정보를 이미 갖고 있음.
 */
require_once __DIR__ . '/database.php';

$user = require_login();
$pdo  = get_db();

// 소유자는 요청이 아니라 항상 세션에서
$stmt = $pdo->prepare(
    'SELECT resort_id, created_at
       FROM favorite
      WHERE email = ?
      ORDER BY created_at DESC, resort_id'
);
$stmt->execute([$user['email']]);
$rows = $stmt->fetchAll();

foreach ($rows as &$row) {
    $row['resort_id'] = (int)$row['resort_id'];   // JavaScript용으로 "3" → 3
}
unset($row);

json_out(['result' => 'ok', 'favorites' => $rows]);
