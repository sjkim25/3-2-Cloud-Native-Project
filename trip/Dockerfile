# ski-trip-api 이미지: PHP 8.1 + Apache (리조트, 즐겨찾기, 여행 계획)
FROM php:8.1-apache-bookworm

# pdo_mysql: MySQL용 PDO 드라이버 (prepared statement → SQL 인젝션 방지)
RUN docker-php-ext-install pdo_mysql

# phpredis: ski-redis의 공유 로그인 세션을 PHP에서 읽기 위해 설치
RUN pecl install redis && docker-php-ext-enable redis

# Apache 웹 루트로 복사. *.php만 복사해서 Dockerfile 자체는 노출되지 않음
COPY *.php /var/www/html/

# 문서용일 뿐 포트를 열지 않음. 프록시가 ski-net에서 ski-trip-api:80으로 접근
EXPOSE 80
