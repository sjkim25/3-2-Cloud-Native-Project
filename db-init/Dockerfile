# ski-db 이미지: MySQL 8.0 + SkiPlan 초기화 스크립트
FROM mysql:8.0

COPY *.sql /docker-entrypoint-initdb.d/

# 문서용일 뿐 포트를 열지 않음. 다른 컨테이너가 ski-net에서 ski-db:3306으로 접근
EXPOSE 3306
