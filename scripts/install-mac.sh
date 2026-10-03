#!/bin/bash
# Installs Sandlot as a Mac app (~/Applications/Sandlot.app): a copy of the built game, a tiny local web server and a launcher that
# opens it in its own Chrome window (no address bar, no tabs). It works offline; saves live in the app's own Chrome profile
# (~/Library/Application Support/Sandlot) and stay there across updates. Run again after pulling new work to update the copy.
#   npm run install-app
set -euo pipefail
cd "$(dirname "$0")/.."

APP="$HOME/Applications/Sandlot.app"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Google Chrome is needed (it draws the game). Install it from google.com/chrome and run this again."; exit 1; }

echo "Building the game..."
npm run build >/dev/null

echo "Making $APP ..."
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp -R dist "$APP/Contents/Resources/game"

# the app's icon, from the game's own 512 px icon
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 64 128 256 512; do
  sips -z $s $s public/icon-512.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d public/icon-512.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Sandlot</string>
  <key>CFBundleDisplayName</key><string>Sandlot</string>
  <key>CFBundleIdentifier</key><string>local.sandlot.game</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>sandlot</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# a tiny web server (the game's files must come from http://, not straight off the disk)
cat > "$APP/Contents/Resources/server.py" <<'PY'
import http.server, os, socketserver, sys
os.chdir(sys.argv[1])
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
                      '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml'}
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', int(sys.argv[2])), H) as s: s.serve_forever()
PY

cat > "$APP/Contents/MacOS/sandlot" <<'SH'
#!/bin/bash
# Sandlot: start the little server, open the game in its own window, stop the server when the window closes.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
PORT=48765
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$HOME/Library/Application Support/Sandlot"
mkdir -p "$PROFILE"
if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  /usr/bin/python3 "$RES/server.py" "$RES/game" "$PORT" &
  SERVER=$!
  for i in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done
fi
"$CHROME" --app="http://127.0.0.1:$PORT/" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check --window-size=1400,820 >/dev/null 2>&1
[ -n "${SERVER:-}" ] && kill "$SERVER" 2>/dev/null
exit 0
SH
chmod +x "$APP/Contents/MacOS/sandlot"

# (Spotlight and Launchpad pick it up from ~/Applications)
touch "$APP"
echo "Done: Sandlot is in your Applications folder (in your home folder). Open it from Spotlight (Cmd+Space, type Sandlot) or drag it to the Dock."
