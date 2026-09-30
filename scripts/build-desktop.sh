#!/usr/bin/env bash
# 构建桌面安装包（V1.3.6 起只打包实际使用的目标）：
#   • macOS  Apple Silicon  dmg
#   • Windows x64           exe (NSIS)
# 在 macOS 本地运行；产物复制到 ~/Desktop/DingYue-桌面版/。
# 重要：不再清空输出目录——旧版本安装包永久保留（文件名带版本号，互不覆盖）。
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

echo "==> 1/3 构建 Web（公网 API）"
VITE_API_BASE_URL="https://ngaasiu.studio/api" npm run build

echo "==> 1.5/3 复制界面资源到打包目录（dist 是 electron-builder 保留目录名，需换名打包）"
rm -rf desktop-files && mkdir -p desktop-files && cp -a dist desktop-files/dist

echo "==> 2/3 electron-builder（V1.4.0 起：mac arm64+x64 dmg、win x64+arm64 NSIS）"
npx electron-builder --mac dmg --arm64 --x64 --config electron-builder.json
npx electron-builder --win nsis --x64 --arm64 --config electron-builder.json

echo "==> 3/3 复制到桌面（保留所有历史版本，不覆盖不删除）"
OUT_DIR="$HOME/Desktop/DingYue-桌面版"
mkdir -p "$OUT_DIR"
for f in \
  DingYue-${VERSION}-macos-arm64.dmg \
  DingYue-${VERSION}-macos-x64.dmg \
  DingYue-${VERSION}-windows-x64.exe \
  DingYue-${VERSION}-windows-arm64.exe; do
  cp "desktop-dist/$f" "$OUT_DIR/$f"
done

echo "==> 当前桌面上的全部历史版本："
ls -lht "$OUT_DIR/"
echo "✅ 桌面安装包 v${VERSION} 完成（旧版本已全部保留）"
