# ski-auth-api 이미지: FastAPI 로그인 서비스 (회원가입 / 로그인 / 확인 / 로그아웃)

FROM python:3.12-slim

WORKDIR /app

# 코드보다 requirements를 먼저 복사해 느린 pip 레이어를 캐시로 유지,
# main.py만 수정하면 마지막 레이어만 다시 빌드
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# 문서용일 뿐 포트를 열지 않음. 프록시가 ski-net에서 ski-auth-api:80으로 접근
EXPOSE 80

# 0.0.0.0: 다른 컨테이너에서 접속 가능. 127.0.0.1이면 컨테이너 내부 접속만 받음
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "80"]
