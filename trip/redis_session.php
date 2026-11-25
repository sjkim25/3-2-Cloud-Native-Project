<?php
/*
 * redis_session.php — Redis에서 공유 로그인 세션 읽기
 *
 * ski-auth-api(Python)가 Redis에 저장하는 세션 형식:
 *     key   = "session:<id>"
 *     value = useremail|s:16:"test@skiplan.com";username|s:9:"김스키";
 */

class RedisSessionHandler implements SessionHandlerInterface
{
    private Redis $redis;
    private string $prefix = 'session:';
    private int $ttl = 3600;

    public function __construct()
    {
        $this->redis = new Redis();
        $this->redis->connect(getenv('REDIS_HOST') ?: 'ski-redis', 6379);
    }

    // 열고 닫을 것 없음. 생성자에서 이미 연결
    public function open(string $path, string $name): bool { return true; }
    public function close(): bool { return true; }

    public function read(string $id): string|false
    {
        $data = $this->redis->get($this->prefix . $id);
        return $data === false ? '' : $data;
    }

    public function write(string $id, string $data): bool
    {
        if ($data === '') {
            return true;
        }
        return $this->redis->setex($this->prefix . $id, $this->ttl, $data);
    }

    public function destroy(string $id): bool
    {
        $this->redis->del($this->prefix . $id);
        return true;
    }
    public function gc(int $max_lifetime): int|false { return 0; }
}


function get_login_user(): ?array
{
    // ski-auth-api가 설정하는 쿠키 이름
    session_name('SKISESSID');

    // 쿠키 없음 - 로그인 안 됨
    if (empty($_COOKIE['SKISESSID'])) {
        return null;
    }

    try {
        session_set_save_handler(new RedisSessionHandler(), true);
    } catch (RedisException $e) {
        http_response_code(500);
        json_out(['result' => 'no', 'msg' => 'Redis 연결 실패']);
    }
    session_start(['read_and_close' => true]);

    if (empty($_SESSION['useremail'])) {
        return null;
    }

    return [
        'email' => $_SESSION['useremail'],
        'name'  => $_SESSION['username'] ?? '',
    ];
}
