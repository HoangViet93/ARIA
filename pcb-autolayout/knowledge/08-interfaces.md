# 08 — Luật theo từng chuẩn giao tiếp

> Giá trị dưới đây là **điển hình** để khởi tạo `constraints.yaml`. Datasheet /
> hướng dẫn layout của chip cụ thể luôn ưu tiên hơn (đặc biệt skew và length).
> Khi không có số của hãng, Claude ghi rõ "dùng giá trị mặc định knowledge/08".

| Mã | Chuẩn | Trở kháng | Ràng buộc chính |
|---|---|---|---|
| IF-USB2 | USB 2.0 HS | 90 Ω diff ±15 % | Skew nội cặp nhỏ (theo hãng, thường vài chục mil trở xuống); ≤ 2 via; ESD điện dung thấp sát connector; CMC tuỳ chọn; không qua khe plane |
| IF-USB3 | USB 3.x | 90 Ω diff | Skew nội cặp rất nhỏ (~≤ 5 mil); tụ AC coupling 100 nF trên cặp TX (đối xứng, 0201/0402); hạn chế via, stub; ESD < 0.3–0.5 pF |
| IF-USBC | USB-C | như trên | CC1/CC2 không cần trở kháng; VBUS theo dòng (3/5 A); cặp SuperSpeed có mux nếu cần đảo chiều |
| IF-ETH100 | 10/100BASE-TX | 100 Ω diff (MDI) | Magnetics sát connector (hoặc RJ45 tích hợp); **void mọi plane dưới magnetics** giữa phía PHY và phía cáp; Bob Smith 75 Ω + 1 nF/2 kV về chassis; PHY ↔ magnetics ngắn |
| IF-ETH1G | 1000BASE-T | 100 Ω diff × 4 cặp | Như trên; skew cặp–cặp lỏng (vài cm); nội cặp chặt |
| IF-RGMII | RGMII | 50 Ω SE | Match trong nhóm TX/RX (thường ±1–2 mm); delay clock 1.5–2 ns (trong PHY/MAC hoặc bằng đường); R series sát driver |
| IF-RMII | RMII 50 MHz | 50 Ω SE | REF_CLK ngắn, R series; match lỏng |
| IF-T1 | 100/1000BASE-T1 (automotive) | 100 Ω diff | Theo OPEN Alliance: CMC + ESD + tụ AC/mạch termination common-mode sát connector; đối xứng tuyệt đối; không qua khe |
| IF-CAN | CAN / CAN FD / CAN XL | ~120 Ω diff (lỏng) | Transceiver sát connector; termination tách đôi 2×60 Ω + 4.7 nF tới GND (nếu node có termination); CMC tuỳ chọn; ESD chuyên CAN sát connector; stub trên board ngắn |
| IF-LIN | LIN | — | Master: 1 kΩ + diode lên VBAT; tụ 220 pF (slave) / ~1 nF (master) sát connector; ESD/TVS; bus chậm, ưu tiên EMC hơn SI |
| IF-FR | FlexRay | ~100 Ω diff | Như CAN, termination tách đôi theo spec |
| IF-SPI | SPI ≤ 50 MHz | 50 Ω SE nếu dài | R series 22–33 Ω sát driver (SCLK); match lỏng; tải nhiều thì daisy/fly-by |
| IF-QSPI | Quad/Octal SPI | 50 Ω SE | Match IO với CLK (±2–5 mm tuỳ tốc độ); R series sát MCU; flash sát MCU |
| IF-I2C | I²C | — | Pull-up sát master; tổng điện dung ≤ 400 pF (std/fast); không cần trở kháng |
| IF-UART | UART | — | Không đặc biệt; R series khi ra connector + ESD |
| IF-SD | SD/SDIO/eMMC | 50 Ω SE | CLK ngắn, R series sát host; DAT/CMD match với CLK (±1–3 mm); pull-up CMD/DAT theo spec |
| IF-DDR3/4 | DDR3/DDR4 | 40–50 Ω SE, 80–100 Ω diff (CK, DQS) | **Fly-by** cho CA/CMD/CK + Vtt termination; byte lane: DQ/DM match với DQS trong byte (theo chip, thường ± vài ps tới ~±10 ps); không đổi lớp trong byte lane khác nhau; VREF tách sạch. v3 — cần mô phỏng |
| IF-LPDDR4 | LPDDR4 | 40 Ω SE, 80 Ω diff | Point-to-point; match chặt; theo hướng dẫn SoC tuyệt đối |
| IF-MIPI | MIPI CSI-2 / DSI D-PHY | 100 Ω diff | Skew nội cặp nhỏ; lane–lane match với clock lane (theo hãng); ≤ 2 via |
| IF-LVDS | LVDS / FPD-Link (dây xoắn) | 100 Ω diff | Termination 100 Ω sát receiver (nếu chưa tích hợp) |
| IF-COAX | FPD-Link III/IV, GMSL (coax) | 50 Ω SE | Xem RF §5; PoC filter |
| IF-HDMI | HDMI TMDS | 100 Ω diff | ESD điện dung rất thấp; match nội cặp chặt, cặp–cặp lỏng |
| IF-PCIE | PCIe Gen2/3/4 | 85 Ω (hoặc 100 Ω) diff | Tụ AC 100–220 nF trên TX gần transmitter; via tối thiểu, stub ngắn/back-drill ≥ Gen3 dài; REFCLK 100 Ω diff. v3 |
| IF-SWD | SWD / JTAG | — | Connector debug gần MCU; R series 22–100 Ω; ESD nếu ra ngoài vỏ |
| IF-XTAL | Thạch anh | — | PLC-020…023 |

## Ghi chú chung cho mọi cặp vi sai

SI-050…055 áp dụng. CMC đặt sát connector, sau ESD hoặc trước tuỳ hướng dẫn của
transceiver (Claude ghi rõ nguồn khi chọn).
