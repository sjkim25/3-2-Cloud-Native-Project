<?php
/*
 * POST /trip/trip-add.php  (로그인 필요)
 * 본문 (JSON): {"resort_id": 1, "start_date": "2027-01-15", "end_date": "2027-01-18", "memo": "..."}
 *
 * 여행은 기간으로 저장. 날짜와 메모는 선택:
 *   - 날짜 없음              - "날짜 미정" (둘 다 NULL)
 *   - start_date만           - 당일 여행 (end = start)
 *   - 종료일이 시작일보다 앞 - 거부
 * start_date는 trip.visit_date(01-schema.sql의 원래 컬럼 이름)에, end_date는 trip.end_date에 저장.
 */
require_once __DIR__ . '/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    json_out(['result' => 'no', 'msg' => 'POST 요청만 허용됩니다.']);
}

$user = require_login();
$body = read_json_body();

$resortId  = (int)($body['resort_id'] ?? 0);
$startDate = trim($body['start_date'] ?? '');
$endDate   = trim($body['end_date'] ?? '');
$memo      = trim($body['memo'] ?? '');

if ($resortId <= 0) {
    json_out(['result' => 'no', 'msg' => '리조트를 선택해 주십시오.']);
}


// 날짜 검사
function is_valid_date(string $s): bool
{
    $d = DateTime::createFromFormat('Y-m-d', $s);
    return $d && $d->format('Y-m-d') === $s;
}

foreach ([$startDate, $endDate] as $s) {
    if ($s !== '' && !is_valid_date($s)) {
        json_out(['result' => 'no', 'msg' => '날짜 형식은 YYYY-MM-DD 입니다.']);
    }
}
if ($startDate === '' && $endDate !== '') {
    json_out(['result' => 'no', 'msg' => '시작일을 먼저 선택해 주십시오.']);
}
if ($startDate !== '' && $endDate === '') {
    $endDate = $startDate;
}
if ($endDate < $startDate) {
    json_out(['result' => 'no', 'msg' => '종료일이 시작일보다 빠릅니다.']);
}

$pdo = get_db();

$check = $pdo->prepare('SELECT id FROM resort WHERE id = ?');
$check->execute([$resortId]);
if (!$check->fetch()) {
    json_out(['result' => 'no', 'msg' => '존재하지 않는 리조트입니다.']);
}

$stmt = $pdo->prepare(
    'INSERT INTO trip (resort_id, visit_date, end_date, memo, email) VALUES (?, ?, ?, ?, ?)'
);
$stmt->execute([
    $resortId,
    $startDate === '' ? null : $startDate,
    $endDate === '' ? null : $endDate,
    $memo === '' ? null : $memo,
    $user['email'],
]);

json_out(['result' => 'ok', 'msg' => '여행 계획에 추가되었습니다.', 'id' => (int)$pdo->lastInsertId()]);
