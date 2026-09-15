#!/usr/bin/env bash
# Launch SRS Studio with Node and TeX Live from the user's home install.
set -e
cd "$(dirname "$0")"
[ -d "$HOME/.local/node/bin" ] && export PATH="$HOME/.local/node/bin:$PATH"
for d in "$HOME"/texlive/*/bin/*; do
  [ -d "$d" ] && export PATH="$d:$PATH" && break
done
command -v node >/dev/null || { echo "Không tìm thấy node trong PATH."; exit 1; }
command -v xelatex >/dev/null || echo "Cảnh báo: không có xelatex — Xuất PDF sẽ báo lỗi."
exec npm start
