#!/bin/sh
# 업데이트할 때마다 실행: 휴대폰이 옛날 파일을 쓰지 않도록 버전 번호를 바꿉니다.
V=$(date +%y%m%d%H%M)
sed -i "s|src=\"app.js[^\"]*\"|src=\"app.js?v=$V\"|" index.html
sed -i "s|from './config.js[^']*';|from './config.js?v=$V';|" app.js
echo "version $V"
