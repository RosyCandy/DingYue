#!/usr/bin/env bash
# 构建并运行 iOS 模拟器版：bash scripts/build-ios.sh
# 依赖：Xcode + 至少一台已启动的 iPhone 模拟器
set -euo pipefail
cd "$(dirname "$0")/.."

API_URL="${VITE_API_BASE_URL:-https://ngaasiu.studio/api}"
BUNDLE_ID="com.duoduo.app"
SCHEME="App"
PROJECT="ios/App/App.xcodeproj"
DERIVED="/tmp/ios-build"
UDID="${SIM_UDID:-$(xcrun simctl list devices booted | grep -o '[0-9A-F-]\{36\}' | head -1 || true)}"

if [ -z "$UDID" ]; then
  echo "没有已启动的模拟器，启动第一台 iPhone..."
  UDID=$(xcrun simctl list devices available | grep iPhone | grep -o '[0-9A-F-]\{36\}' | head -1)
  xcrun simctl boot "$UDID"
  sleep 8
fi

echo "==> 1/4 构建 Web 资源 (API: ${API_URL})"
VITE_API_BASE_URL="$API_URL" npm run build

echo "==> 2/4 同步到 iOS 工程"
npx cap sync ios

echo "==> 3/4 Xcode 构建 (模拟器 ${UDID})"
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug \
  -destination "platform=iOS Simulator,id=${UDID}" \
  -derivedDataPath "$DERIVED" build | tail -1

echo "==> 4/4 安装并启动"
APP=$(find "$DERIVED/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name "*.app" | head -1)
xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" "$BUNDLE_ID"
echo "✅ 已在模拟器 ${UDID} 启动 ${BUNDLE_ID}"
