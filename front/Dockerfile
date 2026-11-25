# ski-front 이미지: 정적 프론트엔드(HTML/CSS/JS)를 Nginx로 제공
FROM nginx:alpine

# Nginx 기본 웹 루트. "/" 요청에는 index.html이 나감
COPY index.html login.html app.js login.js style.css topo.svg hokkaido-subpref.json /usr/share/nginx/html/

# 문서용
EXPOSE 80
