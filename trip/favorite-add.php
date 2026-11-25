<?php
/*
 * POST /trip/favorite-add.php  (로그인 필요)
 * 본문 (JSON): {"resort_id": 3}
 * 리조트를 즐겨찾기에 추가
 */
require_once __DIR__ . '/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    json_out(['result' => 'no', 'msg' => 'POST 요청만 허용됩니다.']);
}

$user     = require_login();
$resortId = (int)(read_json_body()['resort_id'] ?? 0);

if ($resortId <= 0) {
    json_out(['result' => 'no', 'msg' => '리조트를 선택해 주십시오.']);
}

$pdo = get_db();

// 먼저 확인
$check = $pdo->prepare('SELECT id FROM resort WHERE id = ?');
$check->execute([$resortId]);
if (!$check->fetch()) {
    json_out(['result' => 'no', 'msg' => '존재하지 않는 리조트입니다.']);
}

// INSERT IGNORE: (email, resort_id)가 이미 있으면 PRIMARY KEY가 중복을 막고 건너뜀.
$stmt = $pdo->prepare('INSERT IGNORE INTO favorite (email, resort_id) VALUES (?, ?)');
$stmt->execute([$user['email'], $resortId]);

json_out(['result' => 'ok', 'msg' => '즐겨찾기에 추가되었습니다.']);
