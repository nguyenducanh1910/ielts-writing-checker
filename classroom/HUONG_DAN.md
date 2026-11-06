# IELTS Classroom Checker: Hướng dẫn sử dụng

Hệ thống chạy trong tài khoản Google của thầy/cô (Google Sheets + Apps Script). Writing được chấm trên web IELTS Writing Checker của thầy/cô; chỉ Speaking (và chép bài viết tay, nếu có) dùng Gemini API.

## Quy trình mỗi tuần

```
Thầy/cô                                  Hệ thống (tự động)
───────                                  ──────────────────
1. Bỏ đề vào 1 thư mục Drive       ──►  Đọc đề Word, Teacher's Book, file nghe
2. Điền 1 dòng sheet "Giao bài"    ──►  Tạo Google Form điền đáp án, lưu đáp án,
   + bấm menu "Giao bài"                 đăng bài lên Classroom (đề PDF, file Writing riêng cho từng HS)
                                         Mỗi giờ: lấy bài nộp, chấm Reading/Listening,
                                         gửi Writing lên web, Gemini chấm Speaking
3. Chấm Writing trên web như cũ    ──►  Điểm Writing tự về Sheet, web tự gửi email
4. (Không cần làm gì)              ──►  Hết hạn nộp: tự gửi mỗi HS kết quả R/L + giải thích câu sai,
                                         tự phân tích câu hỏi của cả lớp và gửi tóm tắt cho thầy/cô
5. Duyệt Speaking (tick ô)         ──►  Gửi email nhận xét Speaking cho HS
                                         19h: nhắc HS chưa nộp · 7h: báo cáo cho thầy/cô
```

---

## 1. Chuẩn bị thư mục bài

Mỗi bài tập là **1 thư mục trên Google Drive**, ví dụ `K230 / L19 RW`. Tên file phải có chữ **Reading / Listening / Writing / Speaking** để hệ thống biết file thuộc kỹ năng nào.

**Ví dụ buổi Reading + Writing (thư mục `L19 RW`):**

| File | Vai trò | Có đăng cho HS? |
|---|---|---|
| `Đề Reading 4.5-5.5.pdf` | Đề cho HS xem (khuyên dùng PDF) | Có |
| `Đề Reading 4.5-5.5.docx` | Để hệ thống đọc số câu và dạng câu | Chỉ khi không có bản PDF |
| `IELTS_Reading_Midterm_Teacher.docx` | **Đáp án** (có "BẢNG ĐÁP ÁN") | **Không bao giờ** |
| `Đề Writing 4.5-5.5.docx` | Đề Writing, HS viết bài vào chính file này | Có, mỗi HS 1 bản riêng |

**Ví dụ buổi Listening + Speaking (thư mục `L19 LS`):**

| File | Vai trò |
|---|---|
| `Đề Listening ... .pdf` / `.docx` | Đề Listening |
| `Listening L19.mp3` | File nghe, được đăng cho HS |
| `IELTS_Listening_Midterm_Teacher.docx` | Đáp án, **không** đăng |
| `Speaking cue card.docx` | Đề Speaking (AI dùng để biết HS đang trả lời câu nào) |

### Quy ước để hệ thống đọc đúng

- **File đáp án:** tên file có chữ `Teacher`, `ĐÁP ÁN` hoặc `Answer key`. Những file này **không bao giờ** được đăng lên Classroom.
- **Đề Reading/Listening:** giữ các dòng tiêu đề chuẩn IELTS như `Questions 1–6`. Số câu mỗi buổi nhiều hay ít đều được, vì hệ thống tự đếm.
- **Bảng đáp án:** đặt dưới tiêu đề `BẢNG ĐÁP ÁN` (giống Teacher's Book hiện tại), hoặc một file riêng có dòng `ĐÁP ÁN` rồi mỗi câu 1 dòng:
  ```
  ĐÁP ÁN
  1. vi
  19. car parks
  21. two hours / 2 hours
  ```
  Đáp án đúng khác ghi theo dạng `Hartley (chấp nhận: HARTLEY)` hoặc ngăn cách bằng ` / `.
- **Đề Writing:** giữ các dòng `WRITING TASK 1`, `WRITING TASK 2` (trước đề) và `TASK 1 – Answer`, `TASK 2 – Answer` (chỗ HS viết bài). Ảnh biểu đồ Task 1 để ngay trong file Word. Buổi chỉ có Task 2 thì bỏ phần Task 1 đi.
- **File Word cũ (.doc):** mở bằng Word rồi lưu lại thành `.docx`.

---

## 2. Giao bài (sheet "Giao bài")

Điền mỗi bài 1 dòng:

| Cột | Ví dụ |
|---|---|
| Lớp | `K230 5.5 TC - BTVN` (chọn trong danh sách) |
| Buổi | `L19` (tiêu đề trên Classroom sẽ là `L19 RW`) |
| Loại bài | `Reading + Writing`, `Listening + Speaking`, hoặc 1 kỹ năng |
| Link thư mục Drive | dán link thư mục |
| Hạn nộp | `04/11/2026 20:00` |
| Ghi chú thêm cho HS | (tuỳ chọn) thêm vào cuối phần hướng dẫn |
| Đăng ngay | tick: đăng luôn cho HS · bỏ tick: tạo **bản nháp** trên Classroom để thầy/cô xem lại rồi tự bấm *Giao* |

Sau đó:
1. **IELTS Checker → Giao bài: kiểm tra trước (không đăng).** Cột *Chi tiết* sẽ cho biết hệ thống đọc được gì, ví dụ: *"Reading: 26 câu, đủ đáp án (1–6 Headings i–ix; 7–13 TRUE/FALSE/NOT GIVEN; …)"*. Nếu thiếu đáp án, lệch số câu hoặc thiếu file, cột *Trạng thái* sẽ báo lỗi rõ ràng.
2. **IELTS Checker → Giao bài: tạo Form & đăng lên Classroom.** Hệ thống sẽ:
   - Tạo 1 Google Form cho mỗi phần Reading/Listening (mỗi câu 1 ô; T/F/NG, A–G, i–ix hiện sẵn lựa chọn). Form thu email để biết HS nào trả lời.
   - Lưu đáp án vào sheet **Đáp án**.
   - Đăng bài lên Classroom kèm đề, file nghe, file Writing (mỗi HS 1 bản), link Form, hạn nộp và hướng dẫn từng bước cho HS.
3. Muốn giao lại một dòng (ví dụ sau khi sửa lỗi): xoá ô **Trạng thái** của dòng đó rồi chạy lại.

Form và ảnh biểu đồ được lưu trong thư mục con `_IELTS Checker` bên trong thư mục bài.

---

## 3. Học sinh làm bài

Phần mô tả bài trên Classroom tự ghi sẵn hướng dẫn:
- **Reading/Listening:** đọc/nghe đề, điền đáp án vào Google Form (đăng nhập đúng tài khoản Classroom).
- **Writing:** mở file Writing riêng của mình, viết **ngay dưới dòng "TASK 1 – Answer" / "TASK 2 – Answer"**, không xoá tiêu đề, không tạo file mới.
- **Speaking:** ghi âm bằng app ghi âm của điện thoại (mp3, m4a), đính kèm file vào bài, không dán link Drive, không quay video.
- **Tên file không quan trọng.** Hệ thống nhận bài theo nội dung: Writing là file có dòng "TASK – Answer", Speaking là file âm thanh.
- Làm xong bấm **Nộp bài**.

---

## 4. Xem kết quả (sheet "Nộp bài")

Bài gộp được tách thành nhiều dòng: một bài RW có 3 dòng mỗi HS (Reading, Writing Task 1, Writing Task 2), một bài LS có 2 dòng (Listening, Speaking).

| Trạng thái chấm | Nghĩa là | Thầy/cô cần làm |
|---|---|---|
| Đã chấm | R/L đã chấm theo đáp án (cột *Nhận xét tóm tắt* liệt kê câu sai) | Không cần làm gì: hết hạn nộp hệ thống tự gửi (muốn gửi sớm thì tick **Duyệt gửi**) |
| Đã gửi lên web — chờ chấm | Bài Writing đã vào hàng chờ của web | Chấm trên web (link trong cột *File nhận xét*) |
| Đã chấm trên web — web đã gửi email | Điểm Writing đã về Sheet | Không cần làm gì |
| Đã chấm (AI) — chờ duyệt | Gemini đã chấm Speaking, có file nhận xét chi tiết | Xem, sửa nếu cần, tick **Duyệt gửi** |
| Bỏ qua: … | HS chưa làm phần đó (VD bỏ trống Task 1, chưa có file ghi âm) | Không bắt buộc |
| Lỗi: … | VD HS xoá dòng "TASK 1 – Answer" | Kiểm tra tay; xoá ô *Trạng thái chấm* để chấm lại |
| Lỗi — cần kiểm tra tay: … | HS có nộp nhưng hệ thống không đọc được: viết Writing ở file khác (bài RW), nộp ảnh viết tay vào chỗ file mẫu, ghi âm định dạng lạ (.amr…), file quá lớn hoặc link Drive không mở được | Xem bài nộp; ô trong file phạt để trống cho thầy/cô tự điền |

Một vài điểm cần biết:
- Reading/Listening được chấm ngay khi HS gửi Form, kể cả khi HS quên bấm *Nộp* trên Classroom.
- Band R/L của đề ít hơn 40 câu được **quy đổi theo tỉ lệ /40**, chỉ để tham khảo.
- HS nộp lại thì hệ thống tự chấm lại.

### Quy tắc chấm Reading/Listening (theo Teacher's Book)
- Không phân biệt hoa/thường. `T`/`F`/`NG`/`Y`/`N` được hiểu là TRUE/FALSE/NOT GIVEN/YES/NO.
- Viết thêm từ hoặc đơn vị đã in sẵn vẫn đúng: `7.15 pm`, `10 weeks`, `£95`, `Science Building`, `a colleague`.
- Số điện thoại chỉ so các chữ số: `0161 4960 738` = `0161 496 0738`.
- **Sai chính tả = sai.** Viết thiếu cũng sai (`two` ≠ `two hours`), vượt số từ cũng sai (`at least two hours`).

---

## 5. Sau hạn nộp: kết quả cho HS và phân tích câu hỏi (tự động)

### Email kết quả cho từng HS
Khi hết hạn nộp (cộng thêm số giờ chờ trong *Cấu hình*, mặc định 0), mỗi HS đã làm Form nhận 1 email cho từng phần Reading/Listening:
- **Điểm** và **mức độ** theo *Thang đánh giá* của Teacher's Book (VD *Đạt (8–10 câu)*). Teacher's Book không có thang thì hiện band quy đổi để tham khảo.
- **Chỉ những câu em làm sai**: em trả lời gì, đáp án đúng, và phần *Giải thích chi tiết* của đúng câu đó (Câu hỏi, Keywords, Vị trí, Paraphrase, Chốt đáp án, Bẫy; hoặc Dẫn chứng, Script, Giải thích tuỳ Teacher's Book).
- Ngay trước khi gửi, hệ thống chấm lại theo câu trả lời **mới nhất** trên Form (phòng khi HS sửa bài trước hạn).
- Đã gửi rồi thì **không chấm lại và không gửi lại**. HS nộp muộn sẽ nhận email ở lần chạy kế tiếp.

Giải thích được lấy từ Teacher's Book lúc giao bài và lưu ở sheet **Đáp án** (cột *Giải thích (gửi HS)*). Thầy/cô có thể sửa trực tiếp ô đó trước hạn nộp. Bài đã giao trước bản cập nhật này (VD L24) sẽ tự được đọc lại Teacher's Book từ thư mục bài.

Hệ thống đọc được 2 kiểu Teacher's Book hiện có:
- Kiểu bảng 4 bước: dòng `Câu 1 → D | Mức độ: Dễ • p ≈ 0.70 • D ≈ 0.30 • Lỗi dự kiến: …` rồi các dòng *Câu hỏi / B2 – Keywords / B3 – Vị trí / Paraphrase / B4 – Chốt đáp án / Bẫy*.
- Kiểu đoạn: `Câu 1. …` rồi `Đáp án: … | Vị trí: …`, `Dẫn chứng: …`, `Script: …`, `Giải thích: …`.

Chỉ cần giữ tiêu đề mục *Giải thích chi tiết* và *Thang đánh giá* như hiện tại. Bước *Giao bài: kiểm tra trước* sẽ báo, ví dụ: *"giải thích 13/13 câu, thang đánh giá Vững/Đạt/Cần ôn lại/Cần hỗ trợ thêm"*.

### Phân tích câu hỏi của cả lớp (Teacher's Book mục 7)
Cùng lúc đó hệ thống tính từ câu trả lời trên Form và ghi vào sheet **Phân tích câu hỏi**, đồng thời gửi 1 email tóm tắt cho thầy/cô:
- Mỗi câu: số HS đúng/sai, **p** = số HS đúng ÷ số HS làm, **D** = (đúng nhóm G − đúng nhóm Y) ÷ số HS mỗi nhóm, so với p/D dự kiến trong Teacher's Book, và các **câu trả lời sai hay gặp** (VD *A (5), E (2)*) để biết HS mắc distractor nào.
- Nhóm G/Y: 27% điểm cao nhất / thấp nhất; lớp dưới 20 HS thì chia đôi lớp.
- **Cần chú ý** (dòng tô vàng): *Chữa kỹ trên lớp* khi p < 0.30; *Xem lại câu hỏi/đáp án* khi D âm hoặc D < 0.20. Để tránh báo nhầm, không đánh dấu theo D khi mỗi nhóm có dưới 3 HS hoặc khi gần như cả lớp làm đúng (p ≥ 0.90).
- Dòng **Cả lớp**: điểm trung bình, số HS chưa làm, phân bố mức độ (VD *Vững: 3 · Đạt: 10 · Cần ôn lại: 4 · Cần hỗ trợ thêm: 1*).
- HS nộp muộn thì bảng tự cập nhật (email tóm tắt chỉ gửi 1 lần).

Menu liên quan:
- **Phân tích câu hỏi ngay (chưa cần hết hạn)**: xem trước bảng phân tích, không gửi email nào.
- **Gửi kết quả R/L + phân tích (bài đã hết hạn)**: chạy ngay thay vì chờ lần chạy tự động mỗi giờ.

Thiết lập trong sheet *Cấu hình*: *Tự gửi kết quả R/L sau hạn nộp*, *Gửi kết quả R/L sau hạn (giờ)* (VD 24 nếu muốn chữa trên lớp trước rồi mới gửi), *Tự phân tích câu hỏi sau hạn nộp*.

### File phạt của lớp (tự điền Done / Late / Missed 10k)
Mỗi lớp dán link file phạt vào cột **Link file phạt** (sheet *Lớp học*). Sau hạn nộp, mỗi giờ hệ thống điền vào khối BTVN của file phạt:
- **Done**: làm đủ kỹ năng đó đúng hạn. **Late**: làm nhưng sau hạn (không phạt). **Missed 10k**: không làm kỹ năng đó.
- Bài giao bằng sheet *Giao bài* được xét **từng kỹ năng**: Reading/Listening = có điền Form; Writing = có viết dưới dòng "TASK – Answer"; Speaking = có file ghi âm. Bài giao tay trên Classroom chỉ xét HS có bấm *Nộp* hay không.
- **Không bao giờ ghi đè** ô thầy/cô đã chọn (VD *Review + Thi*). Ô Writing bị lỗi cần xem tay sẽ để trống.
- Ô **TỔNG HỢP YÊU THƯƠNG** của tuần được viết tự động nếu đang trống hoặc do hệ thống viết; ô thầy/cô tự gõ thì giữ nguyên.
- Hệ thống tìm cột theo tiêu đề buổi (VD `L22 R + W`), ưu tiên tab của tháng hạn nộp (VD *Extra homework T11*). **Nhớ tạo sẵn cột cho buổi mới** như hiện nay; nếu thiếu, sheet *Nhật ký* sẽ báo "file phạt chưa có cột buổi L…".
- Tên HS trên Classroom (VD "Vinh Hoang") được ghép với tên trong file phạt (VD "Hoàng Quang Vinh") theo email ở tab *Danh sách Pairs* hoặc theo tên. Kết quả ở sheet **Ghép tên HS**: ô nào trống thì thầy/cô điền tay tên đúng như trong file phạt.
- **Tab tháng mới tự tạo**: mỗi sáng (7h), nếu file phạt chưa có tab của tháng này, hệ thống nhân bản tab tháng trước (VD *Extra homework T10* → *Extra homework T11*). Từ ngày 25 (*Cấu hình* → *Tạo tab tháng sau trong file phạt từ ngày*), hệ thống tạo luôn tab tháng sau. Tab mới giữ danh sách HS, công thức và định dạng. Ô Done/Missed, ngày và ô tổng hợp được xoá trắng. Nhãn tuần (thứ Hai – thứ Bảy, tuần thuộc tháng có ngày thứ Bảy) và tên buổi dự kiến (nối tiếp buổi cuối, xen kẽ R + W / L + S) được điền sẵn. Thầy/cô chỉ cần sửa nếu lịch khác. Các khối khác trong tab (Extra homework, Final Retake…) và tab *Bài tập Web + Submission* không bị thay đổi.
- Menu: **File phạt: xem trước (không ghi)**, **File phạt: điền ngay**, **File phạt: tạo tab tháng mới ngay**. Bật/tắt ở *Cấu hình* → *Tự điền file phạt*.

---

## 6. Cài đặt / cập nhật

### Đã cài bản trước (cập nhật)
1. Mở Apps Script, dán đè **Code.gs** (và **appsscript.json** nếu có thay đổi), bấm **Lưu**.
2. Tải lại Sheet và chạy **IELTS Checker → 1. Cài đặt lần đầu**. Thao tác này chỉ thêm phần mới (sheet, cột, thiết lập mới), không xoá dữ liệu cũ. Nếu quên bước này, hệ thống vẫn tự thêm các phần mới khi chạy.
3. Google sẽ hỏi cấp quyền lại, vì script cần quyền **tạo bài tập trên Classroom**. Chọn *Nâng cao → Đi tới… → Cho phép*.
4. Chạy lại **Bật chạy tự động**.

Các bài tập cũ (giao tay trên Classroom) vẫn được theo dõi như trước. Hệ thống chỉ chấm R/L của bài cũ nếu thầy/cô nhập *Mã đáp án* cho bài đó.

### Cài mới từ đầu
1. Tạo Google Sheet mới (đúng tài khoản giáo viên Classroom) → **Tiện ích mở rộng → Apps Script**.
2. Dán **Code.gs**. Vào *Cài đặt dự án*, tick *Hiển thị tệp kê khai appsscript.json*, rồi dán **appsscript.json**. Bấm **Lưu**.
3. Tải lại Sheet và chạy **IELTS Checker → 1. Cài đặt lần đầu**, cấp quyền.
4. **2. Nhập Gemini API key** (lấy tại https://aistudio.google.com/apikey) để chấm Speaking.
5. **3. Kết nối web chấm Writing**: nhập ID Sheet dữ liệu của web, copy mã kết nối, dán vào Script Properties của project web với tên `PORTAL_SECRET`, rồi chạy lại menu 3 cho đến khi có 2 dấu ✔.
6. **Bật chạy tự động**.

---

## 7. Giới hạn & lưu ý

- **Gemini:** gói Gemini Pro (trả phí trên app) **không** áp dụng cho API key. API key lấy ở AI Studio có gói miễn phí, đủ cho khoảng 60 bài Speaking/tuần. Nếu bị giới hạn, hệ thống tự chấm tiếp ở lần chạy sau. Gói miễn phí có thể dùng dữ liệu để cải thiện AI; muốn bảo mật hơn thì bật thanh toán.
- **AI chấm Speaking chỉ mang tính tham khảo** (thường lệch khoảng ±0.5, nhất là Pronunciation), nên luôn cần thầy/cô duyệt.
- **Email:** Gmail thường gửi được khoảng 100 email/ngày. Nhắc nhở đã gộp thành 1 email/HS và 1 dòng cho mỗi bài. Email kết quả R/L là 1 email/HS/phần; nếu hết hạn mức, phần còn lại tự gửi vào hôm sau.
- **Form vẫn mở sau hạn nộp** để HS nộp muộn vẫn làm được. HS đã nhận kết quả (có đáp án) mà sửa Form thì điểm **không** thay đổi.
- **Listening làm ở nhà:** hệ thống không ngăn được HS nghe lại nhiều lần.
- **File ghi âm Speaking:** tối đa khoảng 14 MB (~10 phút mp3). Đọc được mp3, m4a, wav, aac, ogg/opus, flac, aiff, 3gp; video mp4/mov. Định dạng khác (VD .amr) sẽ báo *Lỗi — cần kiểm tra tay*, không tính là không làm.
- **Writing bài 1 Task:** nếu HS viết ở file mới thay vì file mẫu, hệ thống vẫn chấm file đó. Bài có cả Task 1 và Task 2 thì báo *Lỗi — cần kiểm tra tay* để thầy/cô xem.

## Gặp lỗi?

Xem cột **Trạng thái** (sheet Giao bài), **Trạng thái chấm** (sheet Nộp bài) hoặc sheet **Nhật ký**. Mỗi lỗi đều ghi rõ lý do và cách sửa.

---

## 8. Web portal "Lớp học" (trên web Writing)

Đăng nhập web Writing như thường lệ. Giáo viên thấy nút chuyển **Lớp học | Writing** trên thanh menu:

- **Tổng quan:** việc cần làm (Speaking chờ duyệt, Writing chờ chấm, bài cần kiểm tra tay), bài sắp đến hạn / vừa hết hạn, ai chưa nộp.
- **Bài nộp:** mở từng bài, nghe file ghi âm (mở trên Drive), sửa band và nhận xét, bấm **Duyệt & gửi ngay** hoặc **Chấm lại**.
- **Giao bài:** thay cho sheet "Giao bài": chọn lớp, dán link thư mục, chọn hạn, **Kiểm tra trước** rồi **Giao bài**.
- **Kết quả & phạt:** phân tích câu hỏi (p, D), bảng điểm lớp, file phạt tháng (đọc thẳng từ file phạt).

Học sinh có mục **Lớp học** riêng: bài cần làm, điểm đã được gửi, tiền phạt tháng này. Học sinh phải đăng nhập web bằng **đúng email dùng trên Google Classroom** và chỉ thấy dữ liệu của chính mình.

Kỹ thuật: hệ thống Classroom có bản triển khai **Ứng dụng web** ("Web portal Lớp học", Thực thi: Tôi, Ai có quyền: Bất kỳ ai). Web chỉ gửi phiên đăng nhập; hệ thống tự hỏi web Writing xem ai đang đăng nhập. Khi sửa code Apps Script, vào **Triển khai > Quản lý tùy chọn triển khai > Chỉnh sửa > Phiên bản mới** để web dùng code mới (giữ nguyên link).

## 9. Cập nhật 04/11: chống lỗi, giao bài, tiến bộ học sinh, duyệt hàng loạt

**Chống lỗi**
- Trang nào không hiển thị được sẽ báo lỗi kèm nút "Try again" (không quay vòng mãi). Lỗi được ghi vào sheet **Nhật ký** (dòng "Lỗi trình duyệt").
- Chân trang (khi giáo viên đăng nhập) ghi phiên bản: Web · Writing · Lớp học. Nếu một web app chạy bản cũ hơn trang web cần, đầu trang hiện **khung đỏ** kèm cách sửa: mở dự án Apps Script > Triển khai > Quản lý tùy chọn triển khai > bút chì > Phiên bản: **Phiên bản mới** > Triển khai.
- Mỗi sáng, cùng báo cáo ngày, hệ thống tự kiểm tra: phiên bản 2 web app, web Writing có trả lời không, lỗi trong 24 giờ qua, trigger tự động. Có vấn đề → tiêu đề email báo cáo có dấu ⚠ và mục "Hệ thống cần bạn xử lý". Trang Tổng quan có ô **Hệ thống** + nút "Kiểm tra ngay".
- Khi sửa Code.gs: tăng `CLASSROOM_VERSION` ở đầu file **và** `src/versions.ts` trên GitHub cho giống nhau.

**Giao bài**
- Link **Tải file mẫu Teacher's Book (Word)** ngay dưới ô thư mục. Soạn theo mẫu là hệ thống đọc đủ: Đáp án (cột Chấp nhận = đáp án thay thế), Giải thích chi tiết (kể cả dạng cặp "Choose TWO letters"), Độ khó và độ phân hoá, Thang đánh giá.
- "Kiểm tra trước" hiện bảng **Xem trước**: từng câu trên Google Form, đáp án, câu nào có giải thích, mức độ/lỗi dự kiến, file đính kèm cho HS.
- Thư mục Listening chưa có file nghe → hiện nút **Tải lên thư mục** (mp3/m4a ≤ 25 MB; file lớn hơn thì kéo thả thẳng vào Drive).
- Đề Word không có bản PDF → khi giao bài hệ thống tự tạo PDF cho HS (lỗi thì đính kèm file Word như cũ).

**Tiến bộ học sinh**
- Giáo viên: menu **Học sinh** → chọn HS → band theo thời gian (4 kỹ năng), lỗi hay lặp lại (lấy từ cột "Lỗi dự kiến" của Teacher's Book), câu sai 3 tuần gần đây.
- Học sinh: menu **Tiến bộ** → biểu đồ band + "Ôn lại câu sai" (tự trả lời rồi bấm Xem đáp án). HS chỉ thấy kết quả đã gửi qua email.
- Chủ nhật, cùng giờ báo cáo: mỗi HS có câu R/L làm sai trong tuần nhận **email ôn tập** (câu sai, đáp án, giải thích). Tắt ở sheet Cấu hình: "Gửi email ôn tập cuối tuần".

**Chấm**
- Bài nộp › Chờ duyệt: tick nhiều bài → **Duyệt các bài đã chọn** hoặc **Duyệt & gửi ngay**.
- Mở 1 bài Speaking → "Xem bản nháp chi tiết của AI" hiện transcript, 4 tiêu chí, lỗi cần sửa ngay trên trang (không cần mở Google Docs).

## 10. Lớp mới trên Google Classroom (tự động hoá như các lớp khác)

Khi thầy/cô tạo lớp mới trên Google Classroom, mỗi giờ hệ thống tự phát hiện, ghi vào sheet *Lớp học* với **Trạng thái = "Mới — chờ xác nhận"** (cột *Theo dõi* chưa tick) và gửi email báo. Lớp chưa được theo dõi cho tới khi thầy/cô xác nhận. Muốn kiểm tra ngay: trang **Tổng quan** → **Kiểm tra lớp mới**.

Trên trang **Tổng quan** có thẻ **Lớp mới trên Google Classroom**. Với mỗi lớp:

- **Tạo file phạt cho lớp**: chọn *Lớp mẫu* (lớp đã có file phạt), *Buổi đầu tiên* (VD 1 → L1) và *Buổi đầu là* R + W hay L + S. Hệ thống nhân bản file phạt của lớp mẫu thành **Check BTVN - &lt;mã lớp&gt;** cùng thư mục, cùng chia sẻ:
  - giữ tab BTVN của tháng này (định dạng, công thức, danh sách chọn Done/Late/Missed) và tab *Danh sách Pairs*; xoá các tab tháng khác và phần bài tập thêm của lớp mẫu;
  - danh sách HS lấy từ Classroom; tên buổi điền từ buổi đầu tiên, bỏ trống các tuần đã qua; link Classroom ở đầu khối đổi sang lớp mới;
  - tab *Danh sách Pairs* có sẵn Name + Email của HS (cột Pair, SĐT để thầy/cô điền).
- **Thêm lớp vào web Writing**: tạo lớp cùng tên trên web Writing và xếp HS (chưa có lớp) vào đó.
- Bấm **Bắt đầu theo dõi**: hệ thống tick *Theo dõi*, ghi link file phạt, rồi từ lần chạy tự động kế tiếp làm mọi việc như các lớp khác (đồng bộ bài, chấm, nhắc hạn, gửi kết quả, điền file phạt, tạo tab tháng mới). **Bỏ qua** nếu không phải lớp cần theo dõi.

**HS mới vào lớp giữa khoá** (mọi lớp đang theo dõi): khi HS xuất hiện lần đầu trong bài nộp, nếu chưa có tên trong file phạt, hệ thống tự thêm 1 dòng vào khối BTVN của tab tháng này (và tháng sau nếu đã có), đánh lại STT, thêm Name + Email vào *Danh sách Pairs*, ghi vào sheet *Ghép tên HS* (cách ghép "HS mới — đã thêm vào file phạt") và thêm HS vào lớp trên web Writing. Tài khoản không phải HS (email của thầy/cô, tài khoản thử chưa bao giờ ghép được tên ở lớp khác) không được thêm. Các HS đã có trong *Ghép tên HS* từ trước không bị thêm lại.

Cần triển khai **phiên bản mới** cho cả 2 web app (Lớp học và Writing) để dùng tính năng này.

## 11. Cập nhật 05/11: chấm Writing tự động (miễn phí) và chống lỗi Gemini

### Chấm Writing: Claude chép–dán 1 lần, còn lại tự động
1. **Claude (làm tay, miễn phí trong gói Claude.ai):** trên hàng chờ dùng **Copy batch for Claude** (tối đa 5 bài Task 2) hoặc **Copy for Claude** trên từng bài (Task 1 kèm ảnh), dán vào Claude Project, rồi dán câu trả lời về web.
2. **Gemini (tự động, khoá miễn phí):** bấm **Bắt đầu chấm (Gemini)** trên trang chấm, hoặc **Gemini chấm & đối chiếu N bài đã dán Claude** trên hàng chờ (chạy nền, khoảng 1–2 phút mỗi bài). Gemini chấm độc lập (dùng hướng dẫn, band descriptors, danh sách lỗi và 3–5 bài mẫu cùng dạng của thầy), rồi đối chiếu với bản của Claude, có tính độ lệch điểm của từng công cụ so với điểm cuối của thầy.
3. **Kết quả đối chiếu được điền sẵn vào form** (ghi chú đối chiếu mở sẵn phía trên form; kết quả Gemini ở tab Gemini). Thầy duyệt, sửa, bấm gửi như cũ — hệ thống không tự gửi cho học viên.
4. **Bài mẫu tự động:** bài đã gửi điểm tự thành bài mẫu chuẩn (calibration). Bỏ tick "Use as calibration sample" để loại; bài đã bỏ tick không bị thêm lại khi gửi lại điểm. Lần chấm sau Gemini tự dùng bộ mẫu mới; nút tải bài mẫu cho Claude Project vẫn ở trang Claude setup.

**Cài đặt 1 lần** (web → menu **Chấm tự động**): dán khoá Gemini API (tạo miễn phí ở aistudio.google.com), chọn model (mặc định gemini-flash-latest; tự chuyển sang gemini-flash-lite-latest khi quá tải), số bài mẫu mỗi lần, và (không bắt buộc) dán band descriptors đang để trong Claude Project. Bấm **Kiểm tra kết nối**.
Lưu ý: với khoá miễn phí, Google có thể dùng nội dung gửi lên để cải thiện sản phẩm.

**Việc cần làm 1 lần trong dự án Apps Script "IELTS Writing Checker"** (sau khi dán code mới): chạy hàm **setup** (thêm bảng AiJobs, cột "source" cho bài mẫu) và bấm **Cho phép** quyền "kết nối với dịch vụ bên ngoài" (để gọi Gemini); rồi Triển khai → Phiên bản mới.

### Hệ thống Lớp học
- **Gemini quá tải không còn chặn cả lượt chấm:** lỗi 503 → thử lại, rồi thử model nhẹ hơn (gemini-flash-lite-latest); vẫn lỗi thì chỉ bài cần AI chuyển "Chờ: Gemini quá tải", các bài khác (R/L, gửi Writing lên web) vẫn chấm. Quá tải liên tục hơn 3 giờ → cảnh báo trên Tổng quan và trong kiểm tra hệ thống.
- **Lớp mới:** tuỳ chọn "Chỉ tự chấm bài giao từ hôm nay" (bật sẵn) — bài cũ đã hết hạn chỉ theo dõi nộp bài, không gửi lên web Writing.
- **Nhật ký:** "Chấm: N bài R/L" chỉ đếm bài thật sự chấm (bài cũ không có đáp án/Form không còn được đếm).
- **Link ngoài Google Drive** (OneDrive, Canva…): ghi "Lỗi — cần kiểm tra tay", ô file phạt để trống cho thầy quyết (không tự tính Missed), và tự email nhắc HS nộp lại bằng file/Google Drive.
- **File bài làm trống:** ghi "Bỏ qua: file bài làm trống" và tự email nhắc HS nộp lại (mỗi bài nhắc 1 lần, không nhắc khi đã quá hạn hơn 3 ngày).
