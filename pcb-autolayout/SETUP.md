# Cài và chạy pcb-autolayout trên máy khác

## Lấy mã

```bash
git clone https://github.com/HoangViet93/ARIA.git
cd ARIA
git checkout claude/pcb-autolayout-plan
```

Dự án nằm ở `pcb-autolayout/`; skill cho Claude Code ở `.claude/skills/pcb-*` (mở Claude Code tại thư mục
`ARIA` là tự nạp). Board tham khảo (microRusEFI, DropBear) **không** nằm trong git vì giấy phép bên thứ ba:
`sh pcb-autolayout/engine/tools/fetch_reference.sh` để tải lại.

Đọc trước: `PLAN-v4.md` (kết luận review), `SPEC-v4.md` (yêu cầu + kiến trúc v4.1 — việc tiếp theo là M-1/M0).

## Linux (khuyên dùng — Ubuntu 24.04 hoặc WSL2 trên Windows)

```bash
sudo add-apt-repository ppa:kicad/kicad-9.0-releases && sudo apt update
sudo apt install kicad kicad-footprints kicad-demos librsvg2-bin python3-pip
python3 -m pip install --break-system-packages numpy scipy shapely numba pyyaml matplotlib pytest
cd pcb-autolayout/engine
python3 -c "import pcbnew; print(pcbnew.Version())"     # phải ra 9.0.x
python3 run.py ../trials/bcm4l-100                      # thử toàn trình, vài phút
```

Không cần chroot `/opt/k9` / lệnh `k9` như máy cloud cũ — cái đó chỉ để vượt proxy chặn PPA. Ở đâu tài
liệu ghi `k9 python3 …` thì trên máy thường gõ `python3 …`.

## Windows thuần (được, nhưng ít kiểm hơn)

```bat
set KICAD=C:\Program Files\KiCad\9.0
"%KICAD%\bin\python.exe" -m pip install numpy scipy shapely numba pyyaml matplotlib
set PATH=%KICAD%\bin;%PATH%
set KICAD_FP_ROOT=%KICAD%\share\kicad\footprints
cd pcb-autolayout\engine
python run.py ..\trials\bcm4l-100
```

Chỗ có thể vướng: `bench.py` tìm demo ở `/usr/share/kicad/demos` (đường Linux); bước xuất ảnh PNG cần
`rsvg-convert`. Không có thì vẫn ra board + DRC + kiểm rule, chỉ thiếu ảnh.

## Chỉ trích thông tin board để gửi (không cần cài gì thêm)

```bat
"C:\Program Files\KiCad\9.0\bin\python.exe" pcb-autolayout\engine\tools\pcb_extract.py ZCU.kicad_pcb --anonymize
python pcb-autolayout\engine\tools\pcb_extract.py thu_muc_gerber --anonymize
```

## Kiểm nhanh sau khi cài

```bash
cd pcb-autolayout/engine
python3 tests/test_pcb_extract.py      # không cần KiCad
python3 tests/test_fplib.py            # cần pcbnew + thư viện footprint
python3 -m pytest -q tests             # toàn bộ test engine
```

## Máy có GPU (i7 / 32 GB / RTX 3070)

Engine hiện chạy CPU (numba), không dùng GPU. 32 GB RAM đủ cho mọi trial hiện có. GPU dành cho phần
Qwen/phân tích log CAN nếu làm sau.
