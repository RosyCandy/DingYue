#!/usr/bin/env bash
# 发布版本：打 APK -> 打 tag -> 推送 -> GitHub Release 挂上 DingYue.apk
# 用法：bash scripts/release.sh   （版本号取自 package.json）
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
REPO="RosyCandy/DingYue"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "⚠️  有未提交的改动，先 commit 再发布："
  git status --short
  exit 1
fi

echo "==> 1/4 打包 APK"
bash scripts/build-apk.sh

echo "==> 2/4 推送代码与 tag ($TAG)"
git push origin main
git tag -f "$TAG"
git push origin "$TAG"

echo "==> 3/4 创建 GitHub Release"
CRED=$(printf "protocol=https\nhost=github.com\n" | git credential fill)
TOKEN=$(echo "$CRED" | sed -n 's/^password=//p')
API="https://api.github.com/repos/${REPO}"
AUTH=(-H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json")

RELEASE_ID=$(curl -sf -X POST "${AUTH[@]}" \
  -d "{\"tag_name\":\"${TAG}\",\"name\":\"DuoDuo ${TAG}\",\"body\":\"安卓安装包（debug 签名，下载后直接安装）\",\"draft\":false,\"prerelease\":false}" \
  "${API}/releases" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))") \
  || RELEASE_ID=$(curl -sf "${AUTH[@]}" "${API}/releases/tags/${TAG}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")

echo "==> 4/4 上传 APK（DingYue.apk）"
TMP=$(mktemp -d)
cp "$HOME/Desktop/DingYue-v${VERSION}.apk" "${TMP}/DingYue.apk"
curl -sf -X POST "${AUTH[@]}" -H "Content-Type: application/octet-stream" \
  --data-binary @"${TMP}/DingYue.apk" \
  "https://uploads.github.com/repos/${REPO}/releases/${RELEASE_ID}/assets?name=DingYue.apk" > /dev/null

echo "✅ Release 已发布: https://github.com/${REPO}/releases/tag/${TAG}"
