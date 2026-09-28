#!/usr/bin/env bash
# V1.3.6 一键打包四平台（在 macOS 本地运行）：
#   1. Android APK        → ~/Desktop/DingYue-v{版本}.apk
#   2. iOS                → 构建并启动到模拟器（上架需在 Xcode 操作）
#   3. macOS Apple Silicon → ~/Desktop/DingYue-桌面版/DingYue-{版本}-mac.dmg
#   4. Windows x64        → ~/Desktop/DingYue-桌面版/DingYue-{版本}-setup.exe
# 不再打包 Linux；所有历史版本安装包永久保留、互不覆盖。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "════ 1/4 Android APK ════"
bash scripts/build-apk.sh

echo "════ 2/4 iOS（模拟器构建并启动）════"
bash scripts/build-ios.sh

echo "════ 3/4 + 4/4 桌面（mac arm64 dmg + win x64 exe）════"
bash scripts/build-desktop.sh

echo ""
echo "✅ 四平台打包全部完成"
echo "   Android / macOS / Windows 安装包已就位，旧版本均已保留。"
