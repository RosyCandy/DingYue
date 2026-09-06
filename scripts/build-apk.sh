#!/usr/bin/env bash
# 构建安卓 APK 并复制到桌面：bash scripts/build-apk.sh
set -euo pipefail
cd "$(dirname "$0")/.."

API_URL="${VITE_API_BASE_URL:-https://ngaasiu.studio/api}"
VERSION=$(node -p "require('./package.json').version")
# Gradle 8.14 需要 JDK ≤ 24，默认用系统里的 Temurin 21
export JAVA_HOME="${JAVA_HOME:-/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home}"

echo "==> 1/4 构建 Web 资源 (API: ${API_URL})"
VITE_API_BASE_URL="$API_URL" npm run build

echo "==> 2/4 同步到安卓工程"
npx cap sync android

echo "==> 3/4 Gradle 打包 APK"
cd android
./gradlew assembleDebug

echo "==> 4/4 复制到桌面"
OUT="$HOME/Desktop/DingYue-v${VERSION}.apk"
cp app/build/outputs/apk/debug/app-debug.apk "$OUT"
echo "✅ APK 已生成: $OUT"
