#!/bin/sh
# wt installer (POSIX sh)
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/johnpangalos/wt/main/install.sh | sh
#   WT_VERSION=v0.1.0 sh install.sh        # pin a version
#   PREFIX=/usr/local sh install.sh        # install to /usr/local/bin

set -eu

REPO="johnpangalos/wt"
BIN_NAME="wt"
PREFIX="${PREFIX:-$HOME/.local}"
INSTALL_DIR="$PREFIX/bin"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }

if command -v curl >/dev/null 2>&1; then
  DL='curl -fsSL'
  DL_O='curl -fsSL -o'
elif command -v wget >/dev/null 2>&1; then
  DL='wget -qO-'
  DL_O='wget -qO'
else
  die "need curl or wget on PATH"
fi

os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Darwin-arm64)              asset="wt-darwin-arm64" ;;
  Linux-x86_64)              asset="wt-linux-x64" ;;
  Darwin-x86_64)             die "macOS Intel not supported; build from source: https://github.com/$REPO#build-from-source" ;;
  Linux-aarch64|Linux-arm64) die "Linux arm64 not supported yet; build from source: https://github.com/$REPO#build-from-source" ;;
  *)                         die "unsupported platform: $os/$arch" ;;
esac

if [ -n "${WT_VERSION:-}" ]; then
  tag="$WT_VERSION"
else
  info "resolving latest wt release..."
  tag="$($DL "https://api.github.com/repos/$REPO/releases/latest" \
          | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
          | head -n1)"
  [ -n "$tag" ] || die "could not determine latest release tag (rate-limited? set WT_VERSION=vX.Y.Z)"
fi

base="https://github.com/$REPO/releases/download/$tag"
info "installing wt $tag for $os/$arch"

tmp="$(mktemp -d 2>/dev/null || mktemp -d -t wt)"
trap 'rm -rf "$tmp"' EXIT INT HUP TERM

$DL_O "$tmp/$asset"     "$base/$asset"     || die "download failed: $base/$asset"
$DL_O "$tmp/SHA256SUMS" "$base/SHA256SUMS" || die "download failed: $base/SHA256SUMS"

expected="$(grep "  $asset\$" "$tmp/SHA256SUMS" | awk '{print $1}')"
[ -n "$expected" ] || die "no checksum entry for $asset"

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
else
  die "need sha256sum or shasum to verify download"
fi

[ "$expected" = "$actual" ] || die "checksum mismatch for $asset: expected $expected, got $actual"

mkdir -p "$INSTALL_DIR"
mv "$tmp/$asset" "$INSTALL_DIR/$BIN_NAME"
chmod +x "$INSTALL_DIR/$BIN_NAME"

info "installed: $INSTALL_DIR/$BIN_NAME"

# shellcheck disable=SC2016  # literal $PATH is intentional — shown as advice to the user
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) printf '\nnote: %s is not on your PATH. add this to your shell rc:\n    export PATH="%s:$PATH"\n' "$INSTALL_DIR" "$INSTALL_DIR" ;;
esac
