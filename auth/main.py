"""
ski-auth-api — SkiPlan 로그인 서비스 (Python / FastAPI)

  POST /register : 회원가입, MySQL에 bcrypt 해시로 저장
  POST /login    : Redis에 세션 생성 후 SKISESSID 쿠키 발급
  GET  /check    : 로그인 여부 확인
  POST /logout   : Redis에서 세션 삭제

프록시(NPM)가 "/auth" 접두사를 떼고 전달하므로 skiplan.com/auth/login → /login 으로 들어온다.

세션은 Redis "session:<id>" 키에 PHP 세션 직렬화 형식으로 저장한다.
그래서 ski-trip-api(PHP)는 기본 세션 핸들러로, ski-snow-api(Node)는 같은 문자열을
파싱해서 읽을 수 있고, 세 서버 모두 상태를 갖지 않는다.
"""

import os
import re
import secrets

import bcrypt
import pymysql
import redis
from fastapi import FastAPI, Request, Response
from pydantic import BaseModel

# 설정은 docker run -e 로 주입한다. 기본값이 컨테이너 이름이라
# ski-net 안에서는 IP 없이 이름만으로 접속된다.
DB_HOST = os.getenv("DB_HOST", "ski-db")
DB_USER = os.getenv("DB_USER", "skiplan")
DB_PASS = os.getenv("DB_PASS", "skiplan123")
DB_NAME = os.getenv("DB_NAME", "skiplan")
REDIS_HOST = os.getenv("REDIS_HOST", "ski-redis")

SESSION_COOKIE = "SKISESSID"   # 세 서비스가 공유하는 쿠키 이름
SESSION_TTL = 3600             # Redis 세션 유지 시간(초)
SERVER_NAME = "ski-auth-api"   # 어느 서버가 응답했는지 확인용

app = FastAPI(title="ski-auth-api")

# decode_responses=True: bytes 대신 str로 받아 php_unserialize에 바로 넘긴다.
r = redis.Redis(host=REDIS_HOST, port=6379, decode_responses=True)


def get_db():
    """요청마다 새 연결을 열고 닫아서 컨테이너가 연결 상태를 들고 있지 않게 한다."""
    return pymysql.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor  # row["email"] 처럼 dict로 받음
    )


# PHP 세션 형식: useremail|s:16:"test@skiplan.com";username|s:9:"김스키";
# s:<n>의 n은 글자 수가 아니라 UTF-8 바이트 수다. 한글은 한 글자에 3바이트라
# "김스키"는 9가 되어야 하고, 글자 수(3)로 쓰면 PHP가 세션을 못 읽어 로그아웃으로 처리한다.
def php_serialize(data: dict) -> str:
    parts = []
    for key, value in data.items():
        byte_len = len(value.encode("utf-8"))
        parts.append(f'{key}|s:{byte_len}:"{value}";')
    return "".join(parts)


SESSION_PATTERN = re.compile(r'(\w+)\|s:\d+:"(.*?)";')


def php_unserialize(raw: str) -> dict:
    return dict(SESSION_PATTERN.findall(raw))


class RegisterIn(BaseModel):
    name: str
    email: str
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


@app.get("/")
def health():
    return {"result": "ok", "server": SERVER_NAME}


@app.post("/register")
def register(body: RegisterIn):
    if not body.name or not body.email or not body.password:
        return {"result": "no", "msg": "모든 항목을 입력해 주십시오."}

    # 랜덤 salt가 포함된 bcrypt 해시만 저장하고, 평문 비밀번호는 저장하지 않는다.
    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()

    conn = get_db()
    try:
        with conn.cursor() as cur:
            # %s 파라미터 바인딩으로 SQL 인젝션을 막는다.
            cur.execute(
                "INSERT INTO user (name, email, pass) VALUES (%s, %s, %s)",
                (body.name, body.email, hashed),
            )
        conn.commit()
    except pymysql.err.IntegrityError:
        # email 컬럼이 UNIQUE라 중복 가입 시 이 예외가 난다.
        return {"result": "no", "msg": "이미 가입된 이메일입니다."}
    finally:
        conn.close()

    return {"result": "ok", "msg": "회원가입이 완료되었습니다."}


@app.post("/login")
def login(body: LoginIn, response: Response):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT name, email, pass FROM user WHERE email = %s", (body.email,))
            user = cur.fetchone()
    finally:
        conn.close()

    # 없는 이메일과 틀린 비밀번호에 같은 메시지를 줘서 가입된 이메일을 알아낼 수 없게 한다.
    if user is None or not bcrypt.checkpw(body.password.encode(), user["pass"].encode()):
        return {"result": "no", "msg": "이메일 또는 비밀번호가 올바르지 않습니다."}

    # 추측할 수 없는 32자리 16진수 세션 ID
    sid = secrets.token_hex(16)

    # SETEX로 저장과 만료 시간 설정을 한 번에 한다.
    session_data = php_serialize({"useremail": user["email"], "username": user["name"]})
    r.setex(f"session:{sid}", SESSION_TTL, session_data)

    # path="/"   : /auth/, /trip/, /snow/ 모두에 쿠키가 전송되어 세션을 공유한다.
    # httponly   : JavaScript에서 읽을 수 없어 XSS로 탈취되지 않는다.
    # samesite   : 다른 사이트에서 보낸 요청에는 붙지 않아 기본적인 CSRF 방어가 된다.
    # max_age 없음: 실제 만료는 Redis TTL이 결정한다.
    response.set_cookie(SESSION_COOKIE, sid, path="/", httponly=True, samesite="lax")

    return {"result": "ok", "username": user["name"], "server": SERVER_NAME}


@app.get("/check")
def check(request: Request):
    not_logged_in = {"result": "no", "msg": "로그인을 해주십시오.", "server": SERVER_NAME}

    sid = request.cookies.get(SESSION_COOKIE)
    if not sid:
        return not_logged_in

    # TTL이 지나 Redis에서 사라졌을 수 있다.
    key = f"session:{sid}"
    raw = r.get(key)
    if not raw:
        return not_logged_in

    data = php_unserialize(raw)
    if "useremail" not in data:
        return not_logged_in

    # 슬라이딩 만료: 확인할 때마다 TTL을 다시 1시간으로 늘려 사용 중에 로그아웃되지 않게 한다.
    r.expire(key, SESSION_TTL)

    return {
        "result": "ok",
        "username": data.get("username"),
        "useremail": data["useremail"],
        "server": SERVER_NAME,
    }


@app.post("/logout")
def logout(request: Request, response: Response):
    sid = request.cookies.get(SESSION_COOKIE)
    if sid:
        r.delete(f"session:{sid}")   # 서버 쪽 세션을 지우면 모든 서비스에서 동시에 무효가 된다.
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"result": "ok", "msg": "로그아웃 되었습니다."}
