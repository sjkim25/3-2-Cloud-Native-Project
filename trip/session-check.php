<?php
/*
 * GET /trip/session-check.php  (로그인 필요)
 * ski-trip-api(PHP)가 보는 로그인 사용자 반환. 데모에서 ski-auth-api(Python)가
 * 만든 세션이 여기서도 유효함을 보여 주는 용도.
 */
require_once __DIR__ . '/database.php';

$user = require_login();

json_out([
    'result'    => 'ok',
    'username'  => $user['name'],
    'useremail' => $user['email'],
]);
