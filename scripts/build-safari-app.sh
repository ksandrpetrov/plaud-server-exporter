#!/usr/bin/env bash
# Build a macOS host app + Safari Web Extension from browser-extension/.
#
# Without a valid Apple Developer certificate, the app is signed with a stable
# local self-signed identity ("Plaud Export Local Dev"). Safari still treats it
# as unsigned, so use --install-launch-agent to auto-enable "Allow unsigned
# extensions" when Safari starts (one password prompt per login session).
#
# Usage:
#   ./scripts/build-safari-app.sh [--install] [--install-launch-agent] [--open-safari]
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT/browser-extension"
BUILD_DIR="$ROOT/build/safari"
STAGE_DIR="$BUILD_DIR/extension-src"
XCODE_DIR="$BUILD_DIR/xcode"
DERIVED_DATA="$BUILD_DIR/DerivedData"
PROJECT_DIR="$XCODE_DIR/Plaud Export"
PROJECT="$PROJECT_DIR/Plaud Export.xcodeproj"
SCHEME="Plaud Export"
APP_NAME="Plaud Export"
BUNDLE_ID="app.plaud-exporter.safari"
CERT_NAME="Plaud Export Local Dev"
INSTALL_DIR="${PLAUD_SAFARI_INSTALL_DIR:-$HOME/Applications}"
PRODUCTS="$DERIVED_DATA/Build/Products/Release/$APP_NAME.app"

DO_INSTALL=0
DO_LAUNCH_AGENT=0
DO_OPEN_SAFARI=0

for arg in "$@"; do
  case "$arg" in
    --install) DO_INSTALL=1 ;;
    --install-launch-agent) DO_LAUNCH_AGENT=1 ;;
    --open-safari) DO_OPEN_SAFARI=1 ;;
    -h | --help)
      sed -n '1,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Safari host app build requires macOS." >&2
    exit 1
  fi
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 1
  fi
}

stage_extension() {
  echo "==> Staging extension runtime files"
  rm -rf "$STAGE_DIR"
  mkdir -p "$STAGE_DIR"
  local item
  for item in manifest.json background.js content.js background common features popup assets _locales; do
    cp -R "$EXT_DIR/$item" "$STAGE_DIR/$item"
  done
}

ensure_signing_identity() {
  if security find-certificate -c "$CERT_NAME" -p >/dev/null 2>&1; then
    echo "==> Using existing signing identity: $CERT_NAME"
    return 0
  fi

  echo "==> Creating local self-signed code signing identity: $CERT_NAME"
  local tmp
  tmp="$(mktemp -d)"
  cat >"$tmp/openssl.cnf" <<EOF
[ req ]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[ dn ]
CN = $CERT_NAME
O = Plaud Export Local
C = RU

[ v3_req ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = codeSigning
EOF

  openssl req -x509 -newkey rsa:2048 \
    -keyout "$tmp/key.pem" \
    -out "$tmp/cert.pem" \
    -days 3650 \
    -nodes \
    -config "$tmp/openssl.cnf" >/dev/null 2>&1
  openssl pkcs12 -export -legacy \
    -out "$tmp/identity.p12" \
    -inkey "$tmp/key.pem" \
    -in "$tmp/cert.pem" \
    -passout pass:plaud >/dev/null 2>&1

  security import "$tmp/identity.p12" \
    -k "$HOME/Library/Keychains/login.keychain-db" \
    -P plaud \
    -T /usr/bin/codesign \
    -T /usr/bin/security \
    -T /usr/bin/xcodebuild >/dev/null

  rm -rf "$tmp"
  echo "    Imported into login keychain. Open Keychain Access and set"
  echo "    Trust → Code Signing → Always Trust for \"$CERT_NAME\" if codesign prompts."
}

generate_xcode_project() {
  echo "==> Generating Safari Xcode project"
  rm -rf "$XCODE_DIR"
  xcrun safari-web-extension-converter "$STAGE_DIR" \
    --project-location "$XCODE_DIR" \
    --app-name "$APP_NAME" \
    --bundle-identifier "$BUNDLE_ID" \
    --macos-only \
    --copy-resources \
    --no-open \
    --no-prompt \
    --force

  # Converter sets the host app bundle id to "<bundle-id>.Plaud-Export"; fix it.
  sed -i '' 's/app\.plaud-exporter\.Plaud-Export/app.plaud-exporter.safari/g' \
    "$PROJECT/project.pbxproj"
}

build_app() {
  echo "==> Building Release app"
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Release \
    -derivedDataPath "$DERIVED_DATA" \
    clean build \
    CODE_SIGN_STYLE=Manual \
    "CODE_SIGN_IDENTITY=$CERT_NAME" \
    DEVELOPMENT_TEAM= \
    OTHER_CODE_SIGN_FLAGS=--timestamp=none
}

install_app() {
  local dest="$INSTALL_DIR/$APP_NAME.app"
  echo "==> Installing to $dest"
  rm -rf "$dest"
  mkdir -p "$INSTALL_DIR"
  ditto "$PRODUCTS" "$dest"

  local lsregister="/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister"
  "$lsregister" -f -R -trusted "$dest" >/dev/null

  pluginkit -r "$dest" >/dev/null 2>&1 || true
  pluginkit -a "$dest"
  echo "    Registered Safari extension from $dest"
}

install_launch_agent() {
  local agent_label="app.plaud-exporter.safari-unsigned"
  local agent_dir="$HOME/Library/LaunchAgents"
  local agent_plist="$agent_dir/${agent_label}.plist"
  local script_src="$ROOT/scripts/macos/allow-safari-unsigned-extensions.applescript"
  local script_dst="$agent_dir/${agent_label}.scpt"

  echo "==> Installing LaunchAgent for Safari unsigned extensions"
  mkdir -p "$agent_dir"
  osacompile -o "$script_dst" "$script_src"

  cat >"$agent_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${agent_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>${script_dst}</string>
  </array>
  <key>WatchPaths</key>
  <array>
    <string>/Applications/Safari.app</string>
  </array>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF

  launchctl bootout "gui/$(id -u)/${agent_label}" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$agent_plist"
  echo "    LaunchAgent installed: $agent_plist"
  echo "    Safari will prompt for your password when enabling unsigned extensions."
}

open_safari_settings() {
  echo "==> Opening Safari extension settings"
  open -a Safari "x-safari-extension://app.plaud-exporter.safari.Extension/" 2>/dev/null || open -a Safari
  osascript <<'APPLESCRIPT' || true
tell application "Safari"
  activate
  delay 0.5
end tell
tell application "System Events" to tell process "Safari"
  click menu item "Settings…" of menu "Safari" of menu bar 1
  delay 0.5
  try
    click button "Extensions" of toolbar 1 of window 1
  end try
end tell
APPLESCRIPT
}

print_next_steps() {
  cat <<EOF

Done.
  App:       $PRODUCTS
EOF
  if [[ "$DO_INSTALL" -eq 1 ]]; then
    cat <<EOF
  Installed: $INSTALL_DIR/$APP_NAME.app
EOF
  fi
  cat <<EOF

Next steps in Safari (once per machine):
  1. Safari → Settings → Advanced → enable "Show features for web developers"
  2. Safari → Settings → Developer → enable "Allow unsigned extensions" (password)
  3. Safari → Settings → Extensions → enable "Plaud Export Extension"

After --install-launch-agent, step 2 runs automatically when Safari starts.
Rebuild after extension changes: ./scripts/build-safari-app.sh --install
EOF
}

main() {
  require_macos
  require_tool xcrun
  require_tool xcodebuild
  require_tool openssl
  require_tool osacompile
  require_tool pluginkit

  stage_extension
  ensure_signing_identity
  generate_xcode_project
  build_app

  if [[ "$DO_INSTALL" -eq 1 ]]; then
    install_app
  fi
  if [[ "$DO_LAUNCH_AGENT" -eq 1 ]]; then
    install_launch_agent
  fi
  if [[ "$DO_OPEN_SAFARI" -eq 1 ]]; then
    open_safari_settings
  fi

  print_next_steps
}

main "$@"
