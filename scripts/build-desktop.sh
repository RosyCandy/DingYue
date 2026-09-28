#!/usr/bin/env bash
# 构建桌面安装包（dmg/exe/deb/rpm/AppImage）并复制到 ~/Desktop/DingYue-桌面版/
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

echo "==> 1/3 构建 Web（公网 API）"
VITE_API_BASE_URL="https://ngaasiu.studio/api" npm run build

echo "==> 1.5/3 复制界面资源到打包目录（dist 是 electron-builder 保留目录名，需换名打包）"
rm -rf desktop-files && mkdir -p desktop-files && cp -a dist desktop-files/dist

echo "==> 2/3 electron-builder (mac + win + AppImage)"
npx electron-builder -mw --config electron-builder.json
find desktop-dist -name "* 2.*" -delete 2>/dev/null || true
npx electron-builder --linux AppImage --x64 --config electron-builder.json
npx electron-builder --linux AppImage --arm64 --config electron-builder.json

echo "==> 3/3 deb（docker + dpkg-deb，x64 与 arm64）"
docker run --rm -v "$PWD":/project -v /tmp/deb-build:/deb-build -w /project electronuserland/builder:20 \
  /bin/bash -c "bash scripts/mkdeb.sh amd64 desktop-dist/linux-unpacked /project/desktop-dist && bash scripts/mkdeb.sh arm64 desktop-dist/linux-arm64-unpacked /project/desktop-dist"

mkdir -p ~/Desktop/DingYue-桌面版
rm -f ~/Desktop/DingYue-桌面版/*
cp desktop-dist/DingYue-${VERSION}-mac.dmg \
   desktop-dist/DingYue-${VERSION}-setup.exe \
   desktop-dist/DingYue-${VERSION}-amd64.deb \
   desktop-dist/DingYue-${VERSION}-arm64.deb \
   desktop-dist/DingYue-${VERSION}-x86_64.AppImage \
   desktop-dist/DingYue-${VERSION}-arm64.AppImage \
   ~/Desktop/DingYue-桌面版/
ls -lh ~/Desktop/DingYue-桌面版/
echo "✅ 桌面安装包 v${VERSION} 已更新到桌面"
