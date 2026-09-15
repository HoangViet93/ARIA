# Đề xuất: giá trị enum, và sticker ảnh hưởng UI/UX

> **Đã làm xong.** Quyết định cuối: (1) **không** dùng mã thô `0 = RELEASED`,
> chỉ nhãn; (2) Setting là **bản ghi con**, không phải kiểu item — nên DVP
> không link được tới một setting cụ thể; (3) Warning ID chỉ là text, chưa làm
> khuôn URL. Ba câu còn lại làm theo đề xuất trong tài liệu này: hai thời gian
> trễ, có lựa chọn "không lưu", tab UI/UX riêng.
> Xem `docs/FEATURES.md` FR-9 và FR-10 cho kết quả.

Tài liệu này giữ lại lập luận dẫn tới các quyết định trên.

## 0. Hai việc này gặp nhau ở một chỗ

Cả hai đều cần đúng một widget: **một danh sách giá trị rời rạc, trong đó một
giá trị là mặc định**. Interface enum cần nó, Calibration enum cần nó, và
"các giá trị setting" cũng chính là nó. Làm một lần, dùng ba chỗ. Nếu làm rời
rạc thì sẽ có ba cách nhập liệu khác nhau cho cùng một khái niệm — đó là thứ
người dùng nhận ra ngay và ghét.

---

# Phần 1 — Enum cho Interface và Calibration

## 1.1 Không thêm trường "kiểu dữ liệu"

Bạn đã bỏ trường *Kiểu dữ liệu* khỏi Calibration ở vòng trước. Đừng đưa nó về
dưới tên khác. Thay vào đó:

> **Có danh sách giá trị ⇒ là enum. Danh sách rỗng ⇒ là số/tự do như hiện nay.**

Bản thân dữ liệu là cái phân biệt, không cần một ô "loại" để người dùng phải giữ
cho khớp. Bớt một trường, bớt một trạng thái sai được.

Thêm **đúng một trường** cho cả hai kiểu item:

| key | nhãn | kind |
|---|---|---|
| `values` | Giá trị cho phép | `valuelist` (kind mới) |

Khi `values` có nội dung, form và bản đọc **tự ẩn** những trường vô nghĩa:

| | `values` rỗng (như hiện nay) | `values` có nội dung (enum) |
|---|---|---|
| Đơn vị | hiện | ẩn (bảng interface in chữ `enum`) |
| Giá trị nhỏ nhất / lớn nhất | hiện | ẩn |
| Giá trị mặc định | ô text tự do | **chọn trong danh sách** |

## 1.2 Mặc định nằm ngay trong danh sách

Đây là điểm UX quan trọng nhất của phần này. Nếu "Giá trị cho phép" và "Giá trị
mặc định" là hai ô riêng, thì sẽ có một lớp lỗi vĩnh viễn: mặc định không nằm
trong danh sách, hoặc đổi tên một giá trị mà quên sửa mặc định. Ta phải viết
kiểm tra cho nó, hiện cảnh báo, rồi người dùng phải đi sửa.

Bỏ hẳn lớp lỗi đó bằng cách cho chọn mặc định **ngay trên chip**:

```
Giá trị cho phép
┌───────────────────────────────────────────────────────────┐
│  ⠿  0 ▸ RELEASED    ○ mặc định   ✕                        │
│  ⠿  1 ▸ APPLYING    ○ mặc định   ✕                        │
│  ⠿  2 ▸ APPLIED     ● mặc định   ✕                        │
│  ⠿  3 ▸ FAULT       ○ mặc định   ✕                        │
│  ＋ thêm giá trị                                           │
└───────────────────────────────────────────────────────────┘
   ⠿ kéo để đổi thứ tự · dán được cả danh sách nhiều dòng
```

Đổi tên `APPLIED` thì mặc định đi theo, vì nó là cùng một dòng. Không có gì để
lệch nhau nữa.

Hành vi cần có:
- **Enter** để thêm dòng tiếp; **Backspace** trên ô rỗng để xóa dòng trước.
- **Dán** một khối nhiều dòng, hoặc một chuỗi ngăn bởi `;` / `,` / tab → tách
  thành nhiều dòng. Người ta sẽ dán từ Excel và từ DBC, không ai gõ tay 12 trạng
  thái.
- Kéo thả đổi thứ tự — thứ tự **có nghĩa** khi có mã thô (xem dưới).

## 1.3 Mã thô đi kèm nhãn — nên có, và nên là tùy chọn

Trong automotive, một tín hiệu enum hầu như luôn có bảng giá trị: `0=RELEASED`,
`1=APPLYING`. Bạn đã nói sẽ import DBC — DBC lưu đúng dạng đó (`VAL_`). Nếu bây
giờ chỉ lưu nhãn thì lúc import DBC sẽ phải đổi cấu trúc dữ liệu, tức là đụng
lại toàn bộ chuỗi parse → hiển thị → PDF một lần nữa.

Đề xuất: mỗi dòng là `mã = nhãn`, **mã có thể bỏ trống**.

```
\itemfield{values}{0 = RELEASED; 1 = APPLYING; 2 = APPLIED; 3 = FAULT}
\itemfield{values}{Bật; Tắt}          % không cần mã thì thôi
```

Vẫn là trường plain text, vẫn dùng dấu `;` như `multi`/`refs` sẵn có — không
thêm ngữ pháp mới vào `data.tex`. `=` không phải ký tự đặc biệt của LaTeX.

Ràng buộc phải nói rõ: **nhãn không được chứa `;`**. Checker sẽ bắt.

## 1.4 Hiện ở đâu

**Bản đọc của item** (calibration, hoặc interface đang đứng một mình): thêm một
hàng `Giá trị cho phép` với các chip, chip mặc định có viền đậm và chữ "mặc
định".

**Bảng interface ở giữa** — đây là chỗ phải cẩn thận. Bảng đã có 9 cột. Thêm cột
"Giá trị" thì cột đó rỗng với đa số tín hiệu và bảng thì chật thêm. Đề xuất:

- cột **Đơn vị** in `enum` thay vì để trống,
- cột **Mặc định** in nhãn mặc định (`APPLIED`),
- danh sách đầy đủ hiện thành một hàng chip nhỏ **ngay dưới phần Mô tả**, trong
  chính ô đó.

Không thêm cột, vẫn đọc được cả bảng trong một màn hình.

## 1.5 Tag `@` tới một giá trị cụ thể — đề xuất để sau

Câu văn hay gặp: "khi `@EPB_Status` bằng `APPLIED` thì...". Cho `@` trỏ thẳng
tới `@EPB_Status.APPLIED` sẽ rất hợp lý, và đổi tên giá trị thì mọi chỗ đổi theo
— đúng tinh thần `\calref` đang có.

Nhưng nó là một node rich text mới (`\enumref{mã}{giá trị}`), tức là phải khớp ở
cả ba chỗ node/serialize/parse cộng thêm PDF. **Không gộp vào đợt này.** Ghi
nhận để không thiết kế chặn đường: lưu `mã = nhãn` từ đầu chính là để sau này
`\enumref` trỏ được vào một dòng cụ thể.

## 1.6 Kiểm tra và cảnh báo diff

`scripts/check.js` thêm:
- nhãn trùng nhau trong một danh sách — lỗi;
- mã thô trùng nhau — lỗi;
- có dòng có mã, có dòng không — cảnh báo (bảng giá trị làm dở thường là quên);
- nhãn chứa `;` — lỗi;
- `values` có nội dung nhưng `minValue`/`maxValue` cũng có — cảnh báo (dữ liệu
  cũ còn sót lại sau khi đổi sang enum).

`lib/docDiff.js` thêm cờ an toàn:
- **xóa một giá trị enum** → lỗi. Có thể đang có design hoặc DVP nói về nó.
- **đổi mã thô của một nhãn** → lỗi. Đây là thay đổi payload trên CAN, không
  phải sửa chữ.
- **đổi mặc định** → cảnh báo (đã có tiền lệ ở calibration).
- **đổi nhãn** → cảnh báo, và hiện rõ `cũ → mới`.

## 1.7 Ước lượng

`itemTypes.js` một kind mới; widget chip trong form; hai chỗ hiển thị; ngữ pháp
`data.tex` **không đổi**; một dòng `\srslabel@values`; macro in chip trong PDF;
5 luật checker; 4 cờ diff; test cho vòng lưu/đọc và cho ẩn/hiện trường.
**Khoảng nửa ngày**, rủi ro thấp vì không đụng ngữ pháp lưu trữ.

---

# Phần 2 — Sticker "ảnh hưởng UI/UX"

## 2.1 Câu hỏi kiến trúc phải trả lời trước

**Setting nên là bản ghi con của Function/Design, hay là một kiểu item riêng?**

Cái này quyết định mọi thứ phía sau, nên nói thẳng:

| | Bản ghi con (như `steps` của DVP) | Kiểu item riêng |
|---|---|---|
| Có mã riêng | không | có, `EPB-0031` |
| DVP nói "kiểm chứng cho setting này" | **không được** | được |
| `@` trỏ tới setting trong văn bản | không | được |
| Hiện ngay trong requirement | có | phải nhảy đi chỗ khác |
| Một setting dùng chung nhiều function | phải chép ra | trỏ tới cùng một item |
| Công sửa | vừa | lớn (kiểu item thứ 7, đụng 6 chỗ) |

**Tôi đề xuất bản ghi con**, đúng như cách bạn mô tả. Lý do: điều bạn muốn là
*đánh dấu* và *hiển thị tốt hơn*, không phải truy vết setting. Và một setting
thực tế thuộc về đúng một chức năng sinh ra nó.

Nhưng phải nói rõ cái mất: **DVP sẽ không link được tới một setting cụ thể**, chỉ
link tới function/design chứa nó. Nếu bạn cần "test case này kiểm chứng setting
Auto Hold" thì phải làm kiểu item riêng — và nên quyết bây giờ, đổi sau đắt hơn
nhiều.

## 2.2 Mô hình

Sticker là một trường mới trên **function** và **design** (không có ở
information/DVP/calibration/interface):

| key | nhãn | kind |
|---|---|---|
| `uiImpact` | Ảnh hưởng UI/UX | `flag` (kind mới — ô tick) |

Tick vào thì hiện thêm hai khối, **cả hai đều lặp lại được nhiều dòng**:

**Setting** — bảng, mỗi dòng:

| cột | kiểu |
|---|---|
| Tên setting | text (`Auto Hold`) |
| Các giá trị | **đúng widget của Phần 1**, mặc định chọn bằng chấm tròn |
| Lưu theo | `Theo profile lái xe` / `Global (toàn xe)` / `Không lưu (reset mỗi chu kỳ)` |

Giá trị mặc định không phải cột riêng — nó là chấm tròn trong danh sách giá trị,
y hệt Phần 1. Nhất quán, và không lệch được.

> Tôi thêm lựa chọn thứ ba "không lưu" vì thực tế có setting chỉ sống trong một
> chu kỳ ignition. Nếu không cần thì bỏ, chỉ còn hai.

**Cảnh báo** — thẻ, mỗi thẻ:

| trường | kiểu |
|---|---|
| Warning ID | text, trỏ tới tài liệu UI/UX (`WRN-EPB-012`) |
| Mature time | số + đơn vị (ms / s) |
| Điều kiện hiện cảnh báo | rich text |
| Điều kiện tắt cảnh báo | rich text |

### Chỗ tôi cần bạn xác nhận

Bạn viết *"mature time enter condition, exit condition"*. Tôi hiểu là **ba
trường** (một mature time, một enter, một exit). Nhưng trong HMI spec thường có
**hai** thời gian trễ — trễ bật và trễ tắt. Nếu đúng vậy thì nên là:

```
Điều kiện hiện   [rich text]              trễ [500] [ms]
Điều kiện tắt    [rich text]              trễ [200] [ms]
```

Cách này còn hiển thị đẹp hơn: mỗi điều kiện đứng cạnh thời gian của chính nó.
Cần bạn chốt: **một mature time hay hai?**

### Đụng tên với trường sẵn có

Design **đã có** `enterCondition` / `exitCondition` ở mức item. Giờ cảnh báo lại
có enter/exit của riêng nó. Nếu đặt nhãn giống nhau thì người đọc sẽ nhầm. Nhãn
phải khác hẳn: item là *"Enter condition"* của thiết kế, cảnh báo là *"Điều kiện
hiện cảnh báo"*. Và trong PDF hai khối phải nằm rõ ràng ở hai cấp.

## 2.3 Lưu trong `data.tex`

Theo đúng khuôn `\begin{teststeps}` đang chạy tốt — không thêm môi trường lồng
có tham số, vì đó là chỗ parser hiện tại chưa làm.

```latex
\begin{srsitem}{EPB-0012}{function}{Giữ phanh tự động}
\itemdesc{...}
\begin{itemprops}
\itemfield{deployMaster}{EPB ECU}
\itemfield{uiImpact}{1}
\end{itemprops}

\begin{uisettings}
\uisetting{Auto Hold}{Tắt; Bật}{Bật}{profile}
\uisetting{Cảnh báo âm thanh}{Tắt; Nhỏ; To}{Nhỏ}{global}
\end{uisettings}

\begin{uiwarnings}
\uiwarning{WRN-EPB-012}{500 ms}
\uiwarnrich{enter}{Phanh đỗ \textbf{không} nhả sau 2 chu kỳ.}
\uiwarnrich{exit}{Phanh đỗ đã nhả hoàn toàn.}
\uiwarning{WRN-EPB-013}{0 ms}
\uiwarnrich{enter}{Mất tín hiệu \ifref{EPB-0055}.}
\end{uiwarnings}
\end{srsitem}
```

`\uiwarning` mở một bản ghi mới, các `\uiwarnrich` phía sau gắn vào bản ghi đó —
đúng cơ chế `\begin{srsitem}` + `\itemfield` đang dùng, chỉ khác là phẳng. Parser
chỉ cần thêm hai môi trường vào danh sách wrapper và ba macro vào bảng arity.

Trong bộ nhớ: `item.settings = []` và `item.warnings = []`, nằm **ngoài**
`item.fields`, giống hệt `item.steps` — vì lý do đã ghi trong `itemTypes.js`: nhét
mảng vào map chuỗi là kiểu hỏng dữ liệu âm thầm mà repo này đã dính nhiều lần.

## 2.4 Hiển thị — đây mới là phần bạn muốn

**Cây TOC:** một chấm nhỏ hoặc chữ `UI` bên cạnh badge loại, ở những item có
tick. Quét mắt một cái là thấy phần nào chạm HMI.

**Giữa tài liệu:** một chip `UI/UX` cạnh badge `FUNC`/`DSGN`. Rồi hai khối:

```
  2.3  Giữ phanh tự động     FUNC   UI/UX    EPB-0012

       ...mô tả...
       Deploy to — Master     EPB ECU

       SETTING
       ┌────────────────┬─────────────────────────┬──────────────────┐
       │ Auto Hold      │ Tắt · ‹Bật›             │ Theo profile     │
       │ Cảnh báo âm    │ Tắt · ‹Nhỏ› · To        │ Global           │
       └────────────────┴─────────────────────────┴──────────────────┘

       CẢNH BÁO
       ┌──────────────────────────────────────────────────────────────┐
       │ WRN-EPB-012                                    mature 500 ms │
       │ Hiện khi   Phanh đỗ không nhả sau 2 chu kỳ.                  │
       │ Tắt khi    Phanh đỗ đã nhả hoàn toàn.                        │
       └──────────────────────────────────────────────────────────────┘
```

`‹Bật›` là chip mặc định. Warning ID là chip đơn sắc, gợi ý rõ nó trỏ ra ngoài
quyển sách này.

**Tab thứ 5 — "UI/UX".** Đây là thứ đáng giá nhất của cả tính năng: bảng phẳng
gom **mọi** setting và **mọi** cảnh báo trong sách, kèm item nguồn, xuất được.
Chính là cái bạn gửi cho team HMI. Ở đó cũng là chỗ hợp lý để liệt kê các thiếu
sót (cảnh báo chưa có ID, setting chưa có giá trị nào).

Tôi cân nhắc nhét vào tab *Bảng item* dưới dạng chế độ, nhưng tab đó tên là
"Bảng item" và nội dung này không phải item. Tab riêng rõ hơn, và 5 tab vẫn vừa.

**Lọc:** thêm chip `UI/UX` vào thanh lọc của tab Bảng item, và một nút lọc tương
tự trên cây.

## 2.5 Warning ID trỏ ra ngoài — xử lý thế nào

`WRN-EPB-012` sống trong tài liệu UI/UX khác, app này không kiểm chứng được nó
có tồn tại không. Ba mức, đề xuất làm mức 1 và 2:

1. Chip đơn sắc, copy được. Checker bắt **trùng ID trong cùng quyển sách**.
2. Một thiết lập cấp project: *"Đường dẫn tài liệu UI/UX"* dạng khuôn
   `https://.../warnings/{id}`. Có khuôn thì chip bấm được, mở bằng trình duyệt
   ngoài. **Chỉ mở đường dẫn, không gửi nội dung tài liệu đi đâu** — giữ đúng
   ràng buộc bảo mật đang có.
3. Import danh sách Warning ID hợp lệ để kiểm tra chéo — để sau, cần biết tài
   liệu kia ở dạng gì.

## 2.6 Kiểm tra và cảnh báo diff

`check.js`:
- tick UI/UX nhưng không có setting lẫn cảnh báo → ghi chú (không phải lỗi: có
  thứ ảnh hưởng HMI mà không sinh setting hay cảnh báo nào);
- **có setting/cảnh báo nhưng chưa tick** → cảnh báo, vì sẽ lọt khỏi mọi báo cáo;
- cảnh báo thiếu Warning ID → lỗi;
- Warning ID trùng trong sách → lỗi;
- setting không có giá trị nào, hoặc không có mặc định → lỗi;
- tên setting trùng trong sách → cảnh báo (có thể cố ý, hai chức năng cùng chạm
  một setting).

`docDiff.js`:
- **xóa hoặc đổi Warning ID** → lỗi. Tài liệu UI/UX bên kia đang trỏ vào nó.
- **đổi mature time** → cảnh báo, in rõ `500 ms → 200 ms`.
- **xóa một giá trị setting** → lỗi.
- **đổi mặc định của setting**, **đổi nơi lưu** → cảnh báo.
- **bỏ tick UI/UX** → cảnh báo.

## 2.7 Bỏ tick thì dữ liệu đi đâu

Không xóa. Giữ nguyên `settings`/`warnings` trong file, chỉ ẩn khỏi form, và
checker nhắc "có dữ liệu UI/UX nhưng chưa tick". Repo này đã mất dữ liệu người
dùng một lần vì một thao tác âm thầm; không lặp lại.

## 2.8 Ước lượng

Phần này lớn hơn Phần 1 nhiều: hai kind mới, hai môi trường mới trong ngữ pháp
`data.tex` (đụng parser, generator, checker), hai khối form lặp lại được, hai
khối hiển thị, một tab mới, macro PDF cho bảng setting và thẻ cảnh báo, 6 luật
checker, 5 cờ diff. **Khoảng 1,5–2 ngày**, và phần PDF là rủi ro cao nhất —
`template.tex` đã có sẵn vài cái bẫy đã ghi trong chính file đó.

---

# 3. Thứ tự đề xuất

1. **Widget danh sách giá trị + enum cho Interface/Calibration** (Phần 1). Nhỏ,
   độc lập, và tạo ra đúng thứ Phần 2 cần dùng lại.
2. **Sticker + Setting + Cảnh báo, hiển thị trong tài liệu** (Phần 2, trừ tab).
3. **Tab UI/UX + lọc + xuất.**
4. Để sau: `@` trỏ tới một giá trị enum; kiểm chéo Warning ID.

# 4. Những chỗ cần bạn quyết

| # | Câu hỏi | Đề xuất của tôi |
|---|---|---|
| 1 | Giá trị enum có cần mã thô (`0 = RELEASED`) không? | **Có, tùy chọn** — DBC sau này cần |
| 2 | Setting là bản ghi con hay kiểu item riêng? | **Bản ghi con**, chấp nhận không link được từ DVP |
| 3 | Một mature time, hay trễ-bật và trễ-tắt riêng? | **Hai** — hợp thực tế HMI và hiển thị đẹp hơn |
| 4 | "Lưu theo" có cần lựa chọn thứ ba "không lưu" không? | **Có** |
| 5 | Một item có nhiều setting / nhiều cảnh báo không? | **Có**, cả hai đều là danh sách |
| 6 | Tab UI/UX riêng, hay nhét vào tab Bảng item? | **Tab riêng** |
| 7 | Có cần khuôn URL để bấm vào Warning ID không? | **Có**, một thiết lập cấp project |
