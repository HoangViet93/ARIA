#!/bin/sh
# Tải board ECU mã nguồn mở do NGƯỜI vẽ (bộ H/V của PLAN-v2) vào pcb-autolayout/reference/ — KHÔNG commit
# (giấy phép riêng: microRusEFI theo rusEFI, DropBear CERN-OHL-S). github.com bị proxy chặn, raw.* thì không.
set -e
D=$(cd "$(dirname "$0")/../.." && pwd)/reference
get() {  # thư mục  url-gốc  file...
    dir=$1; base=$2; shift 2
    mkdir -p "$D/$dir"
    for f in "$@"; do
        curl -sSfL --max-time 120 -o "$D/$dir/$f" "$base/$(printf %s "$f" | sed 's/ /%20/g')" && echo "ok   $dir/$f" || echo "LỖI $dir/$f"
    done
}
get microRusEFI https://raw.githubusercontent.com/rusefi/hw_microRusEfi/master \
    micro_rusEFI.kicad_pcb micro_rusEFI.kicad_pro micro_rusEFI.kicad_sch stm32.kicad_sch adc.kicad_sch \
    hi-lo.kicad_sch pair.kicad_sch TLE8888-1QK.kicad_sch TLE9201SG.kicad_sch FlashMemory.kicad_sch readme.md
get DropBear https://raw.githubusercontent.com/speeduino/Hardware/main/DropBear/V2 \
    DropBear.kicad_pcb DropBear.kicad_pro DropBear.kicad_sch Connectors.kicad_sch "Power regulator.kicad_sch" \
    comms.kicad_sch crank-cam.kicad_sch drivers.kicad_sch inputs.kicad_sch inputs2.kicad_sch outputs.kicad_sch
