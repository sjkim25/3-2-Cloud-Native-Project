<?php
/*
 * database.php — 모든 엔드포인트가 include하는 공통 설정:
 * Redis 세션 핸들러, JSON 응답 헤더, json_out(), get_db(),
 * require_login(), read_json_body().
 */

require_once __DIR__ . '/redis_session.php';

header('Content-Type: application/json; charset=utf-8');

const SERVER_NAME = 'ski-trip-api';   // 모든 응답에 추가. 어느 서버가 응답했는지 표시

/*
 * JSON 응답을 출력하고 스크립트 종료
 * JSON_UNESCAPED_UNICODE: 한글 그대로 출력.
 */
function json_out(array $data): never
{
    $data['server'] = SERVER_NAME;
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/*
 * PDO로 MySQL에 연결. 설정은 docker run -e 환경 변수에서 오고 기본값은 ski-net의 컨테이너 이름.
 */
function get_db(): PDO
{
    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=utf8mb4',
        getenv('DB_HOST') ?: 'ski-db',
        getenv('DB_NAME') ?: 'skiplan'
    );
    try {
        return new PDO($dsn, getenv('DB_USER') ?: 'skiplan', getenv('DB_PASS') ?: 'skiplan123', [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,  // SQL 오류 시 예외 발생
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,        // 행을 ['col' => value] 형태로
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        json_out(['result' => 'no', 'msg' => 'DB 연결 실패']);
    }
}

/*
 * 로그인한 사용자를 반환하거나, ski-auth-api와 같은 "로그인 필요" 메시지로 종료
 * 이 메시지 수신 시 login.html로 이동
 */
function require_login(): array
{
    $user = get_login_user();
    if ($user === null) {
        json_out(['result' => 'no', 'msg' => '로그인을 해주십시오.']);
    }
    return $user;
}

function read_json_body(): array
{
    return json_decode(file_get_contents('php://input'), true) ?? [];
}
