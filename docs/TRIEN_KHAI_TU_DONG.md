# Triển khai máy chủ tự động (GitHub Actions + clasp)

Khi code của máy chủ Writing (`apps-script/`) hoặc hệ thống Lớp học (`classroom/`) thay đổi trên
nhánh `main`, GitHub tự làm các bước trước đây phải làm tay trong trình soạn thảo Apps Script:

1. chạy kiểm tra (lint, test) và đóng gói code;
2. tải bản đang chạy về làm bản sao lưu (lưu 90 ngày trong mục _Artifacts_ của lần chạy);
3. dừng lại nếu `appsscript.json` (quyền truy cập) khác bản đang chạy;
4. bỏ qua dự án nào code không đổi (không tạo phiên bản thừa);
5. đẩy code lên, chuyển bản triển khai web app hiện có sang **phiên bản mới** (đường dẫn web app giữ nguyên);
6. hỏi web app cho tới khi nó báo đúng phiên bản mới.

Quy trình nằm ở `.github/workflows/deploy-gas.yml` và `scripts/deploy-gas.mjs`.

## Cài đặt một lần (thầy tự làm, khoảng 10 phút)

Các bước này cần tài khoản Google của thầy nên chỉ thầy làm được. Không gửi nội dung khoá cho ai,
kể cả Claude.

### 1. Bật Google Apps Script API

Mở <https://script.google.com/home/usersettings> và bật **Google Apps Script API**.

### 2. Đăng nhập clasp trên máy Mac

Cần Node.js. Mở Terminal, gõ `node -v`; nếu báo không có lệnh, cài bản LTS ở <https://nodejs.org>.

```bash
npx @google/clasp@3.4.1 login
```

Trình duyệt mở ra: chọn tài khoản `nguyenducanh1910202@gmail.com` → **Cho phép**. Terminal báo
đăng nhập thành công là xong. Thông tin đăng nhập nằm ở tệp `~/.clasprc.json`.

### 3. Lưu vào GitHub dưới dạng secret

```bash
pbcopy < ~/.clasprc.json
```

(lệnh này chép nội dung tệp vào bộ nhớ tạm, không hiện ra màn hình)

Trên GitHub: kho `ielts-writing-checker` → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**:

- Name: `CLASPRC_JSON`
- Secret: dán (Cmd+V)
- **Add secret**

Sau đó xoá tệp trên máy cho an toàn: `rm ~/.clasprc.json`.

### 4. Chạy thử

GitHub → **Actions** → **Deploy Apps Script (Writing + Lớp học)** → **Run workflow** → tích
**Only check, do not deploy** → **Run workflow**. Lần chạy xanh và báo "already up to date" cho cả
hai dự án là thiết lập đúng.

## Dùng hằng ngày

- Không cần làm gì: sửa code trên `main` là máy chủ tự cập nhật sau vài phút.
- Muốn triển khai lại bằng tay: **Run workflow** (có thể chọn một dự án, hoặc tích _force_).
- Nếu lần chạy đỏ vì `appsscript.json` khác: quyền truy cập đã đổi. Kiểm tra kỹ, rồi chạy tay với
  **allow_manifest_change**; sau đó mở dự án Apps Script và chạy một hàm bất kỳ để cấp lại quyền.
- Khôi phục bản trước: vào lần chạy → _Artifacts_ → tải `apps-script-before-…`; hoặc trong
  Apps Script → **Triển khai** → **Quản lý các tùy chọn triển khai** → bút chì → chọn phiên bản cũ.

## Thu hồi quyền

Muốn tắt hẳn: xoá secret `CLASPRC_JSON` trên GitHub, và vào
<https://myaccount.google.com/permissions> gỡ quyền của **clasp**.

Lưu ý: ai có nội dung `CLASPRC_JSON` thì sửa được các dự án Apps Script của thầy. GitHub mã hoá
secret và không hiện lại nội dung; không dán nó vào chat, email hay tệp nào khác.
