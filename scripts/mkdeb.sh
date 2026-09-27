#!/bin/bash
set -e
ARCH="$1"; UNPACKED="$2"; OUT="$3"
VERSION=$(node -p "require('/project/package.json').version")
PKG=/tmp/pkgroot
rm -rf "$PKG" && mkdir -p "$PKG/DEBIAN" "$PKG/opt/DingYue" "$PKG/usr/share/applications" "$PKG/usr/share/icons/hicolor/512x512/apps"
cp -a "$UNPACKED/." "$PKG/opt/DingYue/"
cat > "$PKG/DEBIAN/control" <<CTL
Package: dingyue
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: RosyCandy <rosyhazes@126.com>
Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libsecret-1-0
Description: DingYue 订阅管理助手
 轻量订阅管理系统，支持到期提醒、多账户与多币种统计。
CTL
cat > "$PKG/DEBIAN/postinst" <<'POST'
#!/bin/bash
set -e
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database /usr/share/applications || true; fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache /usr/share/icons/hicolor || true; fi
exit 0
POST
chmod 644 "$PKG/DEBIAN/control" "$PKG/DEBIAN/postinst"; chmod 755 "$PKG/DEBIAN/postinst"
cat > "$PKG/usr/share/applications/dingyue.desktop" <<DESK
[Desktop Entry]
Name=DingYue
Comment=DingYue 订阅管理助手
Exec=/opt/DingYue/dingyue
Icon=dingyue
Type=Application
Categories=Utility;Office;
StartupWMClass=DingYue
DESK
cp /project/resources/icon-512.png "$PKG/usr/share/icons/hicolor/512x512/apps/dingyue.png"
chmod 644 "$PKG/usr/share/applications/dingyue.desktop" "$PKG/usr/share/icons/hicolor/512x512/apps/dingyue.png"
dpkg-deb --build --root-owner-group "$PKG" "$OUT/DingYue-$VERSION-$ARCH.deb"
