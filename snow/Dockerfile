# ski-snow-api 이미지 — Node.js Express 적설 서비스

# Node 22 LTS slim(Debian): 이미지는 작지만 npm에 필요한 것은 모두 포함
FROM node:22-slim

WORKDIR /app

# 코드보다 package.json을 먼저 복사해 npm install 레이어를 캐시로 유지,
# server.js만 수정하면 마지막 레이어만 다시 빌드
COPY package.json .
RUN npm install --omit=dev

COPY server.js .

# 문서용일 뿐 포트를 열지 않음. 프록시가 ski-net에서 ski-snow-api:80으로 접근
EXPOSE 80

# "npm start" 대신 node를 직접 실행해서 "docker stop"의 종료 신호가
# node에 바로 전달되어 정상 종료되게 함
CMD ["node", "server.js"]
