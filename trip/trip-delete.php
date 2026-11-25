<?php
/*
 * POST /trip/trip-delete.php  (로그인 필요)
 * 본문 (JSON): {"id": 3}
 * 로그인한 사용자의 여행 계획 하나 삭제.
 */
require_once __DIR__ . '/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    json_out(['result' => 'no', 'msg' => 'POST 요청만 허용됩니다.']);
}

$user = require_login();
$id   = (int)(read_json_body()['id'] ?? 0);

$pdo  = get_db();

// "AND email = ?" = 소유자 확인: 다른 사람의 여행 ID는 0행에 일치할 뿐
$stmt = $pdo->prepare('DELETE FROM trip WHERE id = ? AND email = ?');
$stmt->execute([$id, $user['email']]);

if ($stmt->rowCount() === 0) {
    json_out(['result' => 'no', 'msg' => '삭제할 일정이 없습니다.']);
}
json_out(['result' => 'ok', 'msg' => '삭제되었습니다.']);
