#!/bin/sh
# Cài KiCad 9 vào chroot Ubuntu 26.04 (/opt/k9) + lệnh `k9 <lệnh>` chạy trong đó.
#
#   sudo sh pcb-autolayout/engine/tools/setup-kicad9.sh
#   k9 python3 run.py ../trials/bcm4l-100
#
# Vì sao chroot: Ubuntu 24.04 chỉ có KiCad 7.0.11; PPA kicad-9.0-releases
# (ppa.launchpadcontent.net) bị proxy môi trường chặn; conda-forge không có KiCad.
# Archive Ubuntu (truy cập được) có kicad 9.0.8 trong resolute (26.04). Chroot giữ
# nguyên KiCad 7 của máy → chạy 7 và 9 song song để so (PLAN-v2 C0).
# ~3 GB, ~5 phút. Chạy lại an toàn (bỏ qua bước đã xong).
set -e
R=${K9_ROOT:-/opt/k9}
REPO=$(cd "$(dirname "$0")/../../.." && pwd)

if [ ! -x "$R/usr/bin/apt-get" ]; then
    command -v debootstrap >/dev/null || apt-get install -y -q debootstrap
    S=/usr/share/debootstrap/scripts
    [ -e $S/resolute ] || ln -s gutsy $S/resolute
    mkdir -p "$R"
    debootstrap --variant=minbase --components=main,universe resolute "$R" http://archive.ubuntu.com/ubuntu
fi
cp /etc/resolv.conf "$R/etc/"
printf 'deb http://archive.ubuntu.com/ubuntu resolute main universe\ndeb http://archive.ubuntu.com/ubuntu resolute-updates main universe\n' \
    > "$R/etc/apt/sources.list"

cat > /usr/local/bin/k9 <<EOF
#!/bin/sh
# Chạy lệnh trong chroot KiCad 9 ($R). Thư mục làm việc giữ nguyên (repo được bind vào).
R=$R
for m in proc sys dev dev/pts; do mountpoint -q \$R/\$m || mount --bind /\$m \$R/\$m; done
mkdir -p \$R$REPO; mountpoint -q \$R$REPO || mount --bind $REPO \$R$REPO
exec chroot \$R /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C.UTF-8 \\
    NUMBA_CACHE_DIR=/tmp/numba9 http_proxy="\$http_proxy" https_proxy="\$https_proxy" \\
    sh -c 'cd "\$1" && shift && exec "\$@"' sh "\$(pwd)" "\$@"
EOF
chmod +x /usr/local/bin/k9

export http_proxy="${http_proxy:-$HTTP_PROXY}" https_proxy="${https_proxy:-$HTTPS_PROXY}"
k9 sh -c 'DEBIAN_FRONTEND=noninteractive apt-get update -q &&
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
    kicad kicad-footprints python3-numpy python3-numba python3-shapely python3-yaml \
    python3-matplotlib ca-certificates'
k9 python3 -c "import pcbnew; print('KiCad', pcbnew.Version())"
