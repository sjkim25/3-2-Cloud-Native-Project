<?php
/*
 * POST /trip/favorite-delete.php  (로그인 필요)
 * 본문 (JSON): {"resort_id": 3}
 * 즐겨찾기 해제
 */
require_once __DIR__ . '/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    json_out(['result' => 'no', 'msg' => 'POST 요청만 허용됩니다.']);
}

$user     = require_login();
$resortId = (int)(read_json_body()['resort_id'] ?? 0);

$pdo = get_db();

// "AND email = ?" = 소유자 확인. 본인의 즐겨찾기만 해제 가능
$stmt = $pdo->prepare('DELETE FROM favorite WHERE email = ? AND resort_id = ?');
$stmt->execute([$user['email'], $resortId]);

json_out(['result' => 'ok', 'msg' => '즐겨찾기에서 삭제되었습니다.']);
