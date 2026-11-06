/**
 * ============================================================================
 *  IELTS CLASSROOM CHECKER  —  Google Apps Script (gắn vào 1 Google Sheet)
 * ============================================================================
 *  Chức năng:
 *   1. Giao bài: đọc thư mục Drive (đề Word/PDF, Teacher's Book, file nghe) -> tự tạo Google Form
 *      điền đáp án, lưu đáp án, đăng bài lên Classroom (sheet "Giao bài")
 *   2. Đồng bộ lớp, bài tập, tình trạng nộp bài từ Google Classroom về Sheet
 *   3. Chấm Reading/Listening theo đáp án (chấp nhận đáp án tương đương, đơn vị in sẵn…)
 *   4. Writing: đọc file Word HS nộp -> gửi vào hàng chờ của web IELTS Writing Checker, điểm tự về Sheet
 *   5. Speaking: Gemini chấm file ghi âm theo 4 tiêu chí IELTS
 *   6. Giáo viên duyệt -> gửi email kết quả; nhắc HS chưa nộp; báo cáo hằng ngày
 *
 *  Xem file HUONG_DAN.md để cài đặt.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// HẰNG SỐ
// ---------------------------------------------------------------------------
const SH = {
  CFG: 'Cấu hình',
  COURSES: 'Lớp học',
  CW: 'Bài tập',
  SUB: 'Nộp bài',
  KEY: 'Đáp án',
  BAND: 'Quy đổi band',
  OVERVIEW: 'Tổng quan',
  LOG: 'Nhật ký',
  ASSIGN: 'Giao bài',
  ITEM: 'Phân tích câu hỏi',
  PENMAP: 'Ghép tên HS',
  SPK: 'Mẫu Speaking',
};

// Sheet "Đáp án": 4 cột đầu là đáp án; các cột sau lấy từ Teacher's Book (giáo viên sửa được)
const KEY_HEADERS = ['Mã đáp án', 'Câu', 'Đáp án', 'Ghi chú', 'Giải thích (gửi HS)', 'Mức độ', 'p dự kiến', 'D dự kiến', 'Lỗi dự kiến'];

const ITEM_HEADERS = [
  'Lớp', 'Bài tập', 'Phần', 'Câu', 'Đáp án', 'Số HS làm', 'Đúng', 'Sai', 'p (độ khó)', 'Mức độ', 'D (phân hoá)', 'Độ phân hoá',
  'Dự kiến (Teacher\'s Book)', 'Câu trả lời sai hay gặp', 'Cần chú ý', 'Cập nhật', 'CourseWork ID',
];
const I = indexMap_(ITEM_HEADERS);

const SKILL_OTHER = 'Khác (chỉ theo dõi)';
const SKILLS = [
  'Reading (Academic)', 'Reading (General)', 'Listening',
  'Writing Task 1', 'Writing Task 2', 'Speaking',
  'Reading + Writing', 'Listening + Speaking', 'Writing Task 1 + 2', SKILL_OTHER,
];

// Bài gộp -> các phần được chấm riêng (mỗi phần 1 dòng trong sheet "Nộp bài")
const SKILL_COMPONENTS = {
  'Reading + Writing': ['Reading (Academic)', 'Writing Task 1', 'Writing Task 2'],
  'Listening + Speaking': ['Listening', 'Speaking'],
  'Writing Task 1 + 2': ['Writing Task 1', 'Writing Task 2'],
};

const ASSIGN_TYPES = {
  'Reading + Writing': ['R', 'W'],
  'Listening + Speaking': ['L', 'S'],
  'Reading': ['R'], 'Listening': ['L'], 'Writing': ['W'], 'Speaking': ['S'],
};
const ASSIGN_HEADERS = [
  'Lớp', 'Buổi', 'Loại bài', 'Link thư mục Drive', 'Hạn nộp', 'Ghi chú thêm cho HS', 'Đăng ngay', // giáo viên nhập
  'Trạng thái', 'Bài trên Classroom', 'Chi tiết', 'CourseWork ID',                                 // hệ thống
];
const A = indexMap_(ASSIGN_HEADERS);

const COURSE_HEADERS = ['Theo dõi', 'Tên lớp', 'Phần/Ca', 'Số HS', 'Course ID', 'Link', 'Link file phạt', 'Trạng thái'];
/** Cột "Trạng thái" của sheet Lớp học: lớp mới tạo trên Classroom chờ giáo viên xác nhận trên web. */
const COURSE_STATE = { NEW: 'Mới — chờ xác nhận', ON: 'Đang theo dõi', IGNORED: 'Bỏ qua' };

// Ghép HS trên Classroom với tên trong file phạt của lớp
const PENMAP_HEADERS = ['Lớp', 'Email', 'Tên trên Classroom', 'Tên trong file phạt', 'Cách ghép'];

// Cột 2-5 (Kỹ năng .. Chấm tự động) và Form URL là cột giáo viên được sửa.
const CW_HEADERS = [
  'Lớp', 'Tiêu đề', 'Kỹ năng', 'Mã đáp án', 'Đề bài cho AI', 'Chấm tự động',
  'Hạn nộp', 'Tổng HS', 'Đã nộp', 'Nộp muộn', 'Chưa nộp', 'Link',
  'Course ID', 'CourseWork ID', 'Form URL', 'File đề (ID)', 'Tạo lúc',
  'Dạng bài Writing', 'Chủ đề Writing', // giáo viên sửa được — dùng khi gửi sang web chấm Writing
  'Dữ liệu bài (JSON)',                 // hệ thống: do "Giao bài" tạo (đáp án, Form, đề Writing/Speaking)
];

// Dạng bài theo web IELTS Writing Checker (nhãn hiển thị -> id)
const WRITING_TYPES = {
  task1_academic: { 'Dynamic': 'dynamic', 'Static': 'static', 'Process': 'process', 'Map': 'map', 'Mixed': 'mixed' },
  task2: { 'Agree or disagree': 'agree_disagree', 'Discussion': 'discussion', 'Pros & Cons': 'pros_cons', 'R.E.S': 'res', '2-part question': 'two_part' },
};
const WRITING_ENGINE_WEB = 'Web IELTS Writing Checker';
/** Phiên bản code này. Trang web (src/versions.ts) phải ghi đúng số này; tăng cả hai khi sửa Code.gs. */
const CLASSROOM_VERSION = '2026-11-07.1';
const DEFAULT_WRITING_API = 'https://script.google.com/macros/s/AKfycbzqAmX3yzhlRbtwwAjB9C-JUCRha1ZpEiO0ACOFFVg7i4S-ZsbcWKDeDytbgpU_Evw6/exec';
const DEFAULT_WRITING_APP = 'https://nguyenducanh1910.github.io/ielts-writing-checker/';

const SUB_HEADERS = [
  'Lớp', 'Bài tập', 'Kỹ năng', 'Học sinh', 'Email', 'Trạng thái', 'Nộp lúc', 'Hạn nộp', 'Bài làm', // 0-8 hệ thống
  'Điểm', 'Band', 'Nhận xét tóm tắt', 'File nhận xét', 'Trạng thái chấm', 'Chấm lúc',              // 9-14 chấm bài
  'Duyệt gửi', 'Đã gửi lúc', 'Nhắc lần cuối',                                                      // 15-17
  'Submission ID', 'Course ID', 'CourseWork ID', 'User ID', 'File IDs',                            // 18-22 hệ thống
];

const C = indexMap_(CW_HEADERS);   // C['Kỹ năng'] -> 2
const S = indexMap_(SUB_HEADERS);

const STATUS = {
  ON_TIME: 'Đã nộp',
  LATE: 'Nộp muộn',
  RETURNED: 'Đã trả bài',
  NOT_YET: 'Chưa nộp',
  MISSING: 'Thiếu (quá hạn)',
};

const CONFIG_DEFAULTS = [
  ['Số ngày theo dõi bài tập', 45, 'Chỉ đồng bộ bài tập tạo/hết hạn trong N ngày gần đây'],
  ['Chấm Writing bằng', WRITING_ENGINE_WEB, WRITING_ENGINE_WEB + ' hoặc Gemini AI'],
  ['Link web chấm Writing', DEFAULT_WRITING_APP, 'Trang web GitHub Pages của bạn'],
  ['Dùng Gemini chép bài viết tay', true, 'Khi HS nộp ảnh/PDF bài Writing viết tay: AI chép thành văn bản rồi mới gửi lên web'],
  ['Model Gemini', 'gemini-flash-latest', 'Có thể đổi sang gemini-2.5-pro hoặc model mới hơn'],
  ['Số bài AI chấm tối đa mỗi lần chạy', 15, 'Script tự chạy mỗi giờ, phần còn lại chấm ở lần sau'],
  ['Nghỉ giữa các lần gọi AI (giây)', 5, 'Tăng lên nếu hay bị lỗi 429 (vượt hạn mức miễn phí)'],
  ['Ngôn ngữ nhận xét', 'Tiếng Việt', 'Tiếng Việt hoặc English'],
  ['Tự gửi nhận xét khi đã tick "Duyệt gửi"', true, 'Bỏ tick nếu chỉ muốn gửi thủ công qua menu'],
  ['Tự gửi kết quả R/L sau hạn nộp', true, 'Hết hạn nộp: tự gửi mỗi HS điểm, các câu sai và giải thích từ Teacher\'s Book (không cần tick Duyệt gửi)'],
  ['Gửi kết quả R/L sau hạn (giờ)', 0, 'Chờ thêm N giờ sau hạn nộp mới gửi (VD 24 nếu muốn chữa trên lớp trước)'],
  ['Tự phân tích câu hỏi sau hạn nộp', true, 'Sheet "Phân tích câu hỏi": p, D, câu cần chữa kỹ; gửi email tóm tắt cho bạn'],
  ['Nhắc trước hạn (giờ)', 24, 'Nhắc HS chưa nộp khi còn ≤ N giờ đến hạn'],
  ['Nhắc khi quá hạn', true, ''],
  ['Số ngày nhắc tối đa sau hạn', 3, ''],
  ['Giờ gửi nhắc nhở hằng ngày', 19, '0-23'],
  ['Giờ gửi báo cáo cho giáo viên', 7, '0-23'],
  ['Tên giáo viên', '', 'Hiển thị trong email gửi học sinh'],
  ['Email nhận báo cáo', '', 'Để trống = email của bạn'],
  ['Thư mục lưu nhận xét (ID)', '', 'Tự tạo nếu để trống'],
  ['Tự điền file phạt', false, 'Sau hạn nộp: điền Done / Late / Missed 10k vào file phạt của lớp (link ở cột "Link file phạt", sheet Lớp học)'],
  ['Điền file phạt cho bài hết hạn trong (ngày)', 14, 'Chỉ điền bài có hạn nộp trong N ngày gần nhất'],
  ['Tạo tab tháng sau trong file phạt từ ngày', 25, 'Từ ngày này hằng tháng, tự nhân bản tab tháng hiện tại thành tab tháng sau (0 = tắt)'],
  ['Gửi email ôn tập cuối tuần', true, 'Chủ nhật (cùng giờ báo cáo): gửi mỗi HS các câu R/L làm sai trong 7 ngày qua kèm giải thích'],
];

const MAX_RUN_MS = 5 * 60 * 1000; // Apps Script giới hạn 6 phút / lần chạy
const RUN_START = Date.now();
function timeUp_() { return Date.now() - RUN_START > MAX_RUN_MS; }

class PermanentError extends Error {}
class QuotaError extends Error {}
/** Gemini quá tải (503/500) sau khi đã thử model dự phòng: chờ lần chạy sau, không dừng cả lượt chấm. */
class OverloadError extends Error {}
class TransientError extends Error {}

// ---------------------------------------------------------------------------
// MENU
// ---------------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('IELTS Checker')
    .addItem('1. Cài đặt lần đầu', 'setup')
    .addItem('2. Nhập Gemini API key', 'setApiKey')
    .addItem('3. Kết nối web chấm Writing', 'connectWritingSite')
    .addSeparator()
    .addItem('Giao bài: kiểm tra trước (không đăng)', 'menuCheckAssign')
    .addItem('Giao bài: tạo Form & đăng lên Classroom', 'menuAssign')
    .addSeparator()
    .addItem('Đồng bộ lớp & bài nộp', 'menuSync')
    .addItem('Chấm bài (Reading/Listening + AI)', 'menuGrade')
    .addItem('Gửi nhận xét đã duyệt', 'menuSendFeedback')
    .addItem('Gửi kết quả R/L + phân tích (bài đã hết hạn)', 'menuAfterDeadline')
    .addItem('Phân tích câu hỏi ngay (chưa cần hết hạn)', 'menuAnalyzeNow')
    .addItem('File phạt: xem trước (không ghi)', 'menuPenaltyPreview')
    .addItem('File phạt: điền ngay', 'menuPenaltyFill')
    .addItem('File phạt: tạo tab tháng mới ngay', 'menuPenaltyTabs')
    .addItem('Gửi nhắc nhở ngay', 'menuRemind')
    .addItem('Gửi báo cáo cho tôi ngay', 'menuReport')
    .addSeparator()
    .addItem('Bật chạy tự động', 'installTriggers')
    .addItem('Tắt chạy tự động', 'removeTriggers')
    .addToUi();
}

function menuSync() { runMenu_('Đồng bộ', () => { refreshCourses_(); return syncAll_(); }); }
function menuGrade() { runMenu_('Chấm bài', () => [gradeAll_(), syncWritingScores_()].filter(String).join('\n')); }
function menuSendFeedback() { runMenu_('Gửi nhận xét', () => sendApprovedFeedback_()); }
function menuRemind() { runMenu_('Nhắc nhở', () => { syncAll_(); return sendReminders_(); }); }
function menuReport() { runMenu_('Báo cáo', () => sendTeacherReport_()); }
function menuAfterDeadline() { runMenu_('Kết quả R/L sau hạn', () => { syncAll_(); gradeAll_(); return rlAfterDeadline_({}); }); }
function menuPenaltyPreview() { runMenu_('Xem trước file phạt', () => fillPenaltySheets_(true).report); }
function menuPenaltyFill() { runMenu_('Điền file phạt', () => { syncAll_(); gradeAll_(); return fillPenaltySheets_(false).report; }); }
function menuPenaltyTabs() { runMenu_('Tạo tab tháng mới', () => ensurePenaltyMonthTabs_() || 'Các file phạt đã có đủ tab tháng.'); }
function menuAnalyzeNow() { runMenu_('Phân tích câu hỏi', () => rlAfterDeadline_({ analyzeNow: true })); }

function runMenu_(label, fn) {
  const ui = SpreadsheetApp.getUi();
  requireScopes_();
  try {
    const msg = withLock_(fn);
    ui.alert(label + ' xong', msg || 'Hoàn tất.', ui.ButtonSet.OK);
  } catch (e) {
    log_('LỖI ' + label, e.stack || e.message);
    ui.alert(label + ' gặp lỗi', e.message, ui.ButtonSet.OK);
  }
}

// ---------------------------------------------------------------------------
// CÁC JOB CHẠY TỰ ĐỘNG
// ---------------------------------------------------------------------------
// ---- Thời gian chạy tự động trong ngày (Gmail: ~90 phút/ngày cho mọi trình kích hoạt) ----
const RUNTIME_LIMIT_MIN = 90;
const RUNTIME_WARN_MIN = 70; // từ mức này: báo thầy + tạm dừng lượt cập nhật nhanh (lượt mỗi giờ vẫn chạy)

function runtimeKey_(d) { return 'RT_' + Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'); }
function runtimeTodayMs_() { return Number(PropertiesService.getScriptProperties().getProperty(runtimeKey_()) || 0); }

/** Chạy 1 lượt tự động và cộng thời gian chạy vào tổng của ngày. */
function trackRun_(fn) {
  const t0 = Date.now();
  try { return fn(); } finally { try { addRuntime_(Date.now() - t0); } catch (e) { /* bỏ qua */ } }
}

function addRuntime_(ms) {
  const p = PropertiesService.getScriptProperties();
  const k = runtimeKey_();
  const total = Number(p.getProperty(k) || 0) + ms;
  p.setProperty(k, String(total));
  if (total >= RUNTIME_WARN_MIN * 60000 && !p.getProperty(k + '_WARNED')) {
    p.setProperty(k + '_WARNED', '1');
    const msg = 'Hôm nay hệ thống đã chạy tự động khoảng ' + Math.round(total / 60000) + ' phút (giới hạn của Google cho tài khoản Gmail khoảng ' + RUNTIME_LIMIT_MIN +
      ' phút/ngày). Hệ thống tạm dừng lượt cập nhật nhanh tới hết ngày; lượt đồng bộ mỗi giờ vẫn chạy. Nếu tình trạng này lặp lại, có thể bớt lớp theo dõi hoặc giảm số bài chấm AI mỗi giờ.';
    log_('Sắp hết thời gian chạy', msg);
    try { MailApp.sendEmail({ to: getConfig_().reportEmail, subject: '⚠ Hệ thống lớp học sắp hết thời gian chạy tự động hôm nay', body: msg }); } catch (e) { /* bỏ qua */ }
  }
}

/** Xoá số liệu thời gian chạy cũ hơn 7 ngày. */
function pruneRuntime_() {
  const p = PropertiesService.getScriptProperties();
  const keep = {};
  for (let i = 0; i < 7; i++) keep[runtimeKey_(new Date(Date.now() - i * 86400000))] = true;
  Object.keys(p.getProperties()).forEach(k => {
    if (/^RT_\d{8}/.test(k) && !keep[k.slice(0, 11)]) p.deleteProperty(k);
  });
}

// ---- Sao lưu hằng tuần: chép sheet Lớp học + sheet dữ liệu web Writing vào thư mục Drive, giữ 8 bản gần nhất ----
const BACKUP_FOLDER_NAME = 'Sao lưu IELTS Classroom';
const BACKUP_KEEP = 8;

function backupFolder_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('BACKUP_FOLDER_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* tạo lại */ } }
  const it = DriveApp.getRootFolder().getFoldersByName(BACKUP_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(BACKUP_FOLDER_NAME);
  p.setProperty('BACKUP_FOLDER_ID', folder.getId());
  return folder;
}

/** Mỗi giờ gọi: chỉ sao lưu ban đêm (1–5h) và khi bản gần nhất đã cũ hơn 7 ngày. */
function backupJob_(force) {
  const p = PropertiesService.getScriptProperties();
  const last = Number(p.getProperty('LAST_BACKUP_MS') || 0);
  const hour = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
  if (!force && (Date.now() - last < 7 * 86400000 - 3600000 || hour < 1 || hour > 5)) return '';
  const folder = backupFolder_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH.mm');
  const ss = SpreadsheetApp.getActive();
  const done = [];
  DriveApp.getFileById(ss.getId()).makeCopy('Sao lưu ' + stamp + ' · Lớp học · ' + ss.getName(), folder);
  done.push('sheet Lớp học');
  const conn = writingConn_();
  if (conn && conn.sheetId) {
    DriveApp.getFileById(conn.sheetId).makeCopy('Sao lưu ' + stamp + ' · Dữ liệu web Writing', folder);
    done.push('dữ liệu web Writing');
  }
  const removed = pruneBackups_(folder);
  p.setProperty('LAST_BACKUP_MS', String(Date.now()));
  return 'Sao lưu ' + done.join(' + ') + ' vào thư mục "' + BACKUP_FOLDER_NAME + '"' + (removed ? ' (chuyển ' + removed + ' bản cũ vào thùng rác)' : '');
}

/** Giữ BACKUP_KEEP bản mới nhất của mỗi loại; bản cũ hơn vào thùng rác (khôi phục được trong 30 ngày). */
function pruneBackups_(folder) {
  const groups = { 'Lớp học': [], 'Dữ liệu web Writing': [] };
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const n = f.getName();
    if (n.indexOf('Sao lưu ') !== 0) continue;
    const k = n.indexOf('· Dữ liệu web Writing') >= 0 ? 'Dữ liệu web Writing' : n.indexOf('· Lớp học') >= 0 ? 'Lớp học' : '';
    if (k) groups[k].push(f);
  }
  let removed = 0;
  Object.keys(groups).forEach(k => {
    groups[k].sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(BACKUP_KEEP).forEach(f => { f.setTrashed(true); removed++; });
  });
  return removed;
}

/** Chạy từ trình chỉnh sửa: sao lưu ngay (không chờ tới đêm Chủ nhật). */
function saoLuuNgay() {
  const r = backupJob_(true);
  log_('Sao lưu', r);
  return r;
}

// Mỗi lượt nhanh ~10 giây (chỉ bài tập đang mở, danh sách HS lưu tạm 6 giờ) nên 10 phút/lần vẫn trong giới hạn.
const QUICK_SYNC_MINUTES = 10;

/** Bật lượt cập nhật nhanh nếu chưa có (bản cũ chỉ có lượt mỗi giờ). */
function ensureQuickSyncTrigger_() {
  const props = PropertiesService.getScriptProperties();
  const mine = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'quickSyncJob');
  if (mine.length === 1 && props.getProperty('QUICK_SYNC_EVERY') === String(QUICK_SYNC_MINUTES)) return '';
  mine.forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('quickSyncJob').timeBased().everyMinutes(QUICK_SYNC_MINUTES).create();
  props.setProperty('QUICK_SYNC_EVERY', String(QUICK_SYNC_MINUTES));
  return 'Đã bật cập nhật nhanh mỗi ' + QUICK_SYNC_MINUTES + ' phút';
}

/** Mỗi 15 phút: lấy bài HS vừa nộp trên Classroom (chỉ bài tập đang mở) rồi chấm phần chấm được ngay. */
function quickSyncJob() { return trackRun_(quickSyncJob_); }
function quickSyncJob_() {
  const hour = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
  if (hour < 6) return; // đêm khuya: để lượt mỗi giờ lo, tiết kiệm thời gian chạy trong ngày
  if (runtimeTodayMs_() >= RUNTIME_WARN_MIN * 60000) return; // sắp hết thời gian chạy trong ngày: chỉ còn lượt mỗi giờ
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return; // lượt khác đang chạy: lần sau
  try {
    const a = syncAll_({ activeOnly: true });
    const b = gradeAll_({ quick: true });
    const changed = /\((?!0 mới\))/.test(a) || /\d+ đổi trạng thái/.test(a);
    const graded = /[1-9]\d* bài R\/L|[1-9]\d* lượt AI|bài Writing gửi lên web|lỗi/.test(b);
    if (changed || graded) log_('Cập nhật nhanh', a + ' | ' + b);
  } catch (e) {
    log_('Lỗi cập nhật nhanh', e.stack || e.message);
  } finally {
    lock.releaseLock();
  }
}

/** Nút "Cập nhật ngay" trên web giáo viên. */
function syncNow_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { message: 'Hệ thống đang cập nhật — thử lại sau 1 phút.', busy: true };
  try {
    const a = syncAll_({ activeOnly: true });
    const b = gradeAll_({ quick: true });
    log_('Cập nhật ngay', a + ' | ' + b);
    return { message: a + ' ' + b };
  } finally {
    lock.releaseLock();
  }
}

function hourlyJob() { return trackRun_(hourlyJob_); }
function hourlyJob_() {
  safeStep_('Cập nhật nhanh', ensureQuickSyncTrigger_);
  withLock_(() => {
    const n = safeStep_('Lớp mới', detectNewCourses_);
    const a = syncAll_();
    const h = safeStep_('HS mới', syncNewStudents_);
    safeStep_('Mẫu Speaking', backfillSpeakingSamples_);
    const bk = safeStep_('Sao lưu', () => backupJob_(false));
    if (bk) log_('Sao lưu', bk);
    const b = gradeAll_();
    const w = syncWritingScores_();
    const c = getConfig_().autoSend ? sendApprovedFeedback_() : '';
    const d = rlAfterDeadline_({});
    const p = getConfig_().penaltyOn ? fillPenaltySheets_(false).summary : '';
    log_('Chạy tự động', [n, a, h, b, w, c, d, p].filter(String).join(' | '));
  });
}

function dailyReminderJob() { return trackRun_(dailyReminderJob_); }
function dailyReminderJob_() {
  withLock_(() => { syncAll_(); log_('Nhắc nhở', sendReminders_()); });
}

function dailyReportJob() { return trackRun_(dailyReportJob_); }
function dailyReportJob_() {
  withLock_(() => {
    const cfg = getConfig_();
    if (cfg.penaltyOn && cfg.penaltyTabDay > 0) { try { ensurePenaltyMonthTabs_(); } catch (e) { log_('Lỗi tạo tab tháng mới', e.message); } }
    log_('Báo cáo', sendTeacherReport_());
    try { pruneRuntime_(); } catch (e) { /* bỏ qua */ }
    try { const r = sendWeeklyReview_(cfg); if (r) log_('Ôn tập cuối tuần', r); } catch (e) { log_('Lỗi email ôn tập', e.message); }
  });
}

function installTriggers() {
  removeTriggers(true);
  const cfg = getConfig_();
  const tz = Session.getScriptTimeZone();
  ScriptApp.newTrigger('hourlyJob').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('quickSyncJob').timeBased().everyMinutes(QUICK_SYNC_MINUTES).create();
  PropertiesService.getScriptProperties().setProperty('QUICK_SYNC_EVERY', String(QUICK_SYNC_MINUTES));
  ScriptApp.newTrigger('dailyReminderJob').timeBased().atHour(cfg.remindHour).everyDays(1).inTimezone(tz).create();
  ScriptApp.newTrigger('dailyReportJob').timeBased().atHour(cfg.reportHour).everyDays(1).inTimezone(tz).create();
  SpreadsheetApp.getUi().alert('Đã bật chạy tự động:\n• Mỗi ' + QUICK_SYNC_MINUTES + ' phút (6h–24h): cập nhật bài HS vừa nộp + chấm R/L, gửi bài Writing lên web\n• Mỗi giờ: đồng bộ + chấm bài + gửi nhận xét đã duyệt + gửi kết quả R/L và phân tích câu hỏi khi hết hạn\n' +
    '• ' + cfg.remindHour + 'h hằng ngày: nhắc HS chưa nộp\n• ' + cfg.reportHour + 'h hằng ngày: báo cáo cho bạn');
}

function removeTriggers(silent) {
  const names = ['hourlyJob', 'quickSyncJob', 'dailyReminderJob', 'dailyReportJob'];
  ScriptApp.getProjectTriggers()
    .filter(t => names.indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (silent !== true) SpreadsheetApp.getUi().alert('Đã tắt chạy tự động.');
}

/** Nếu lúc cấp quyền chưa tick đủ, Google sẽ hỏi lại các quyền còn thiếu. */
function requireScopes_() {
  if (typeof ScriptApp.requireAllScopes === 'function') ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
}

/** Chạy từ trình chỉnh sửa Apps Script để cấp lại quyền còn thiếu. */
function capLaiQuyen() {
  requireScopes_();
  return 'Đã đủ quyền';
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Script đang chạy ở tiến trình khác, thử lại sau ít phút.');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------------------
// CÀI ĐẶT
// ---------------------------------------------------------------------------
function setup() {
  requireScopes_();
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());

  // Cấu hình
  const cfg = sheet_(SH.CFG);
  if (cfg.getLastRow() === 0) {
    const rows = [['Thiết lập', 'Giá trị', 'Ghi chú']].concat(CONFIG_DEFAULTS);
    cfg.getRange(1, 1, rows.length, 3).setValues(rows);
    styleHeader_(cfg, 3);
    cfg.setColumnWidth(1, 280).setColumnWidth(2, 200).setColumnWidth(3, 420);
  }
  ensureConfigRows_();

  initTable_(SH.COURSES, COURSE_HEADERS);
  initTable_(SH.CW, CW_HEADERS);
  ensureHeaders_(SH.CW, CW_HEADERS);
  initTable_(SH.SUB, SUB_HEADERS);
  initTable_(SH.KEY, KEY_HEADERS);
  ensureHeaders_(SH.KEY, KEY_HEADERS);
  initItemSheet_();
  initTable_(SH.BAND, ['Kỹ năng', 'Số câu đúng từ', 'Đến', 'Band']);
  initTable_(SH.OVERVIEW, ['Lớp', 'Học sinh', 'Email', 'Bài đã đến hạn', 'Đã nộp', 'Nộp muộn', 'Thiếu',
    'Tỉ lệ nộp', 'Band TB Reading', 'Band TB Listening', 'Band TB Writing', 'Band TB Speaking']);
  initTable_(SH.LOG, ['Thời gian', 'Sự kiện', 'Chi tiết']);
  initAssignSheet_();

  // Đáp án mẫu
  const key = sheet_(SH.KEY);
  if (key.getLastRow() === 1) {
    key.getRange(2, 1, 6, 4).setValues([
      ['MAU-R1', 1, 'TRUE', 'Chấp nhận T/True'],
      ['MAU-R1', 2, 'NOT GIVEN', 'Chấp nhận NG'],
      ['MAU-R1', 3, '(the) river', 'Từ trong ngoặc là không bắt buộc'],
      ['MAU-R1', 4, 'colour|color', 'Dấu | = nhiều đáp án đúng'],
      ['MAU-R1', 5, 'B,D', 'Chọn 2 đáp án, không phân biệt thứ tự'],
      ['MAU-R1', 6, '2,000', 'Chấp nhận 2000'],
    ]);
  }

  // Bảng quy đổi band chuẩn (thang 40 câu)
  const band = sheet_(SH.BAND);
  if (band.getLastRow() === 1) {
    const rows = [];
    DEFAULT_BANDS.forEach(([skill, table]) => table.forEach(([a, b, bd]) => rows.push([skill, a, b, bd])));
    band.getRange(2, 1, rows.length, 4).setValues(rows);
  }

  // Định dạng sheet Nộp bài
  const sub = sheet_(SH.SUB);
  sub.getRange('G:H').setNumberFormat('dd/MM/yyyy HH:mm');
  sub.getRange('O:O').setNumberFormat('dd/MM/yyyy HH:mm');
  sub.getRange('Q:R').setNumberFormat('dd/MM/yyyy HH:mm');
  sub.hideColumns(S['Submission ID'] + 1, 5);
  sub.setColumnWidth(S['Nhận xét tóm tắt'] + 1, 380);
  const statusCol = sub.getRange(2, S['Trạng thái'] + 1, sub.getMaxRows() - 1, 1);
  const colorRule = (text, color) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(text).setBackground(color).setRanges([statusCol]).build();
  sub.setConditionalFormatRules([
    colorRule(STATUS.ON_TIME, '#d9ead3'), colorRule(STATUS.RETURNED, '#d0e0e3'),
    colorRule(STATUS.LATE, '#fce5cd'), colorRule(STATUS.MISSING, '#f4cccc'),
  ]);

  // Định dạng sheet Bài tập
  const cw = sheet_(SH.CW);
  cw.getRange('G:G').setNumberFormat('dd/MM/yyyy HH:mm');
  cw.getRange('Q:Q').setNumberFormat('dd/MM/yyyy HH:mm');
  cw.hideColumns(C['Course ID'] + 1, 2);
  cw.hideColumns(C['File đề (ID)'] + 1, 2);
  cw.hideColumns(C['Dữ liệu bài (JSON)'] + 1);
  cw.setColumnWidth(C['Đề bài cho AI'] + 1, 320);

  ss.getSheets().forEach(s => { if (s.getName() === 'Sheet1' || s.getName() === 'Trang tính1') { if (s.getLastRow() === 0) ss.deleteSheet(s); } });

  const n = refreshCourses_().total;
  initAssignSheet_(); // cập nhật danh sách lớp cho cột "Lớp"
  SpreadsheetApp.getUi().alert('Cài đặt xong!',
    'Tìm thấy ' + n + ' lớp trên Google Classroom (sheet "Lớp học").\n\n' +
    'Tiếp theo:\n1. Bỏ tick các lớp không muốn theo dõi\n2. Menu IELTS Checker > 2. Nhập Gemini API key (để chấm Speaking)\n' +
    '3. Menu IELTS Checker > Đồng bộ lớp & bài nộp\n4. Kiểm tra cột "Kỹ năng" / "Mã đáp án" trong sheet "Bài tập"\n' +
    '5. Menu IELTS Checker > Bật chạy tự động', SpreadsheetApp.getUi().ButtonSet.OK);
}

function setApiKey() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Gemini API key', 'Lấy key miễn phí tại https://aistudio.google.com/apikey rồi dán vào đây:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const key = r.getResponseText().trim();
  if (!key) return;
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  ui.alert('Đã lưu API key (lưu trong Script Properties, không hiện trên Sheet).');
}

function getConfig_() {
  const vals = sheet_(SH.CFG).getDataRange().getValues();
  const m = {};
  vals.slice(1).forEach(r => { m[String(r[0]).trim()] = r[1]; });
  const num = (k, d) => (m[k] === '' || m[k] === undefined || isNaN(Number(m[k]))) ? d : Number(m[k]);
  const bool = (k, d) => (m[k] === '' || m[k] === undefined) ? d : (m[k] === true || String(m[k]).toUpperCase() === 'TRUE');
  return {
    days: num('Số ngày theo dõi bài tập', 45),
    model: String(m['Model Gemini'] || 'gemini-flash-latest').trim(),
    maxAi: num('Số bài AI chấm tối đa mỗi lần chạy', 15),
    aiSleep: num('Nghỉ giữa các lần gọi AI (giây)', 5),
    lang: String(m['Ngôn ngữ nhận xét'] || 'Tiếng Việt'),
    autoSend: bool('Tự gửi nhận xét khi đã tick "Duyệt gửi"', true),
    autoSendRL: bool('Tự gửi kết quả R/L sau hạn nộp', true),
    rlDelayH: num('Gửi kết quả R/L sau hạn (giờ)', 0),
    itemAnalysis: bool('Tự phân tích câu hỏi sau hạn nộp', true),
    remindBeforeH: num('Nhắc trước hạn (giờ)', 24),
    remindOverdue: bool('Nhắc khi quá hạn', true),
    remindMaxDays: num('Số ngày nhắc tối đa sau hạn', 3),
    remindHour: num('Giờ gửi nhắc nhở hằng ngày', 19),
    reportHour: num('Giờ gửi báo cáo cho giáo viên', 7),
    teacherName: String(m['Tên giáo viên'] || ''),
    reportEmail: String(m['Email nhận báo cáo'] || '') || Session.getEffectiveUser().getEmail(),
    folderId: String(m['Thư mục lưu nhận xét (ID)'] || ''),
    writingViaWeb: String(m['Chấm Writing bằng'] === undefined ? WRITING_ENGINE_WEB : m['Chấm Writing bằng']).toLowerCase().indexOf('web') >= 0,
    writingAppUrl: String(m['Link web chấm Writing'] || DEFAULT_WRITING_APP).replace(/#.*$/, '').replace(/\/?$/, '/'),
    ocrHandwriting: bool('Dùng Gemini chép bài viết tay', true),
    penaltyOn: bool('Tự điền file phạt', false),
    penaltyDays: num('Điền file phạt cho bài hết hạn trong (ngày)', 14),
    penaltyTabDay: num('Tạo tab tháng sau trong file phạt từ ngày', 25),
    weeklyReview: bool('Gửi email ôn tập cuối tuần', true),
  };
}

/** Thêm các dòng cấu hình mới (khi cập nhật code) mà không đụng giá trị cũ. */
function ensureConfigRows_() {
  const sh = sheet_(SH.CFG);
  const have = sh.getDataRange().getValues().map(r => String(r[0]).trim());
  const missing = CONFIG_DEFAULTS.filter(r => have.indexOf(r[0]) < 0);
  if (missing.length) sh.getRange(sh.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
}

/** Bổ sung tiêu đề cột mới vào cuối bảng (khi cập nhật code). */
function ensureHeaders_(name, headers) {
  const sh = sheet_(name);
  const cur = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  if (cur.some((v, i) => v !== headers[i])) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader_(sh, headers.length);
  }
}

function setConfigValue_(key, value) {
  const sh = sheet_(SH.CFG);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
}

// ---------------------------------------------------------------------------
// ĐỒNG BỘ GOOGLE CLASSROOM
// ---------------------------------------------------------------------------
/**
 * Cập nhật sheet Lớp học từ Google Classroom. Lần cài đặt đầu (sheet trống): theo dõi mọi lớp.
 * Sau đó lớp mới được thêm với Theo dõi = FALSE, Trạng thái "Mới — chờ xác nhận" để giáo viên xác nhận trên web.
 * Trả về { total, added: [tên lớp mới] }.
 */
function refreshCourses_() {
  ensureHeaders_(SH.COURSES, COURSE_HEADERS);
  const t = readTable_(SH.COURSES, COURSE_HEADERS);
  const first = !t.rows.length;
  const idx = indexBy_(t.rows, COURSE_HEADERS.indexOf('Course ID'));
  const courses = listAll_(tok => Classroom.Courses.list({ teacherId: 'me', courseStates: ['ACTIVE'], pageSize: 100, pageToken: tok }), 'courses');
  const newRows = [];
  courses.forEach(c => {
    const i = idx[c.id];
    if (i === undefined) {
      let n = '';
      if (!first) try { n = listAll_(tok => Classroom.Courses.Students.list(c.id, { pageSize: 100, pageToken: tok }), 'students').length; } catch (e) { /* để trống */ }
      newRows.push([first, c.name, c.section || '', n, c.id, c.alternateLink, '', first ? COURSE_STATE.ON : COURSE_STATE.NEW]);
    } else { t.rows[i][1] = c.name; t.rows[i][2] = c.section || ''; t.rows[i][5] = c.alternateLink; }
  });
  if (t.rows.length) t.sh.getRange(2, 2, t.rows.length, 5).setValues(t.rows.map(r => r.slice(1, 6)));
  if (newRows.length) {
    const start = t.sh.getLastRow() + 1;
    t.sh.getRange(start, 1, newRows.length, COURSE_HEADERS.length).setValues(newRows);
    t.sh.getRange(start, 1, newRows.length, 1).insertCheckboxes();
    t.sh.getRange(start, 1, newRows.length, 1).setValues(newRows.map(r => [r[0]]));
  }
  return { total: courses.length, added: first ? [] : newRows.map(r => String(r[1])) };
}

/** Chạy 1 bước của job tự động; lỗi chỉ ghi Nhật ký, không làm hỏng các bước khác. */
function safeStep_(label, fn) {
  try { return fn() || ''; } catch (e) { log_('Lỗi ' + label, e.stack || e.message); return label + ': lỗi ' + e.message; }
}

/** Mỗi giờ: tìm lớp mới trên Classroom; có lớp mới thì báo giáo viên (email + thẻ trên trang Tổng quan). */
function detectNewCourses_() {
  const r = refreshCourses_();
  if (!r.added.length) return '';
  const cfg = getConfig_();
  const msg = 'Lớp mới trên Classroom: ' + r.added.join(', ');
  log_('Lớp mới', msg + ' — chờ xác nhận trên trang Tổng quan');
  try {
    const body = emHeader_('IELTS Classroom Portal', 'Có lớp mới trên Google Classroom', '') +
      emRow_('<b>' + r.added.map(esc_).join('</b>, <b>') + '</b>') +
      emRow_('Hệ thống chưa theo dõi lớp này. Mở trang <b>Tổng quan</b> và bấm <b>Bắt đầu theo dõi</b> để tự động hoá giống các lớp khác ' +
        '(đồng bộ bài nộp, chấm bài, tạo file phạt, thêm lớp vào web Writing), hoặc <b>Bỏ qua</b> nếu không phải lớp của bạn.') +
      emRow_(emButton_(cfg.writingAppUrl + '#/lop', 'Mở IELTS Classroom Portal'), '18px 28px 26px');
    MailApp.sendEmail({ to: cfg.reportEmail, subject: 'Lớp mới trên Google Classroom: ' + r.added.join(', '), htmlBody: emShell_(body, msg) });
  } catch (e) { /* hết hạn mức email: vẫn có thẻ trên web */ }
  return msg;
}

/** Mốc "bắt đầu theo dõi" của lớp (ms); 0 = tự chấm mọi bài (giáo viên bỏ chọn "chỉ tính bài từ hôm nay"). */
function trackFromMs_(sprops, courseId) {
  const v = sprops['TRACK_FROM_' + courseId];
  if (!v || v === '0') return 0;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * Mỗi lớp 1 lần: đặt mốc theo dõi cho lớp chưa có (lấy giờ "Lớp mới" trong Nhật ký, nếu không có thì
 * ngày hệ thống bắt đầu chạy) rồi tắt "Chấm tự động" cho bài giao trước mốc đó.
 * Giáo viên tick lại tay một bài cũ thì hệ thống không tắt lại.
 */
function oldWorkOff_(courses, cwT, sprops) {
  const p = PropertiesService.getScriptProperties();
  let logRows = null;
  courses.forEach(course => {
    if (sprops['OLD_OFF_' + course.id]) return;
    if (!sprops['TRACK_FROM_' + course.id]) {
      if (!logRows) {
        try { logRows = sheet_(SH.LOG).getDataRange().getValues().slice(1); } catch (e) { logRows = []; }
      }
      const added = logRows.filter(r => r[1] === 'Lớp mới' && String(r[2]).indexOf('"' + course.name + '"') >= 0)[0];
      const first = logRows.filter(r => r[0] instanceof Date)[0];
      const at = added && added[0] instanceof Date ? added[0] : first ? first[0] : new Date();
      sprops['TRACK_FROM_' + course.id] = at.toISOString();
      p.setProperty('TRACK_FROM_' + course.id, at.toISOString());
    }
    const from = trackFromMs_(sprops, course.id);
    let n = 0;
    if (from) {
      cwT.rows.forEach((r, i) => {
        if (String(r[C['Course ID']]) !== course.id || r[C['Chấm tự động']] !== true) return;
        const created = r[C['Tạo lúc']] instanceof Date ? r[C['Tạo lúc']].getTime() : NaN;
        if (!(created < from)) return;
        r[C['Chấm tự động']] = false;
        cwT.sh.getRange(i + 2, C['Chấm tự động'] + 1).setValue(false);
        n++;
      });
    }
    sprops['OLD_OFF_' + course.id] = '1';
    p.setProperty('OLD_OFF_' + course.id, '1');
    if (n) log_('Bài cũ', 'Lớp "' + course.name + '": tắt "Chấm tự động" cho ' + n + ' bài giao trước ' +
      Utilities.formatDate(new Date(from), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') +
      ' (chỉ theo dõi nộp bài). Muốn chấm lại bài nào thì tick lại ô "Chấm tự động" của bài đó.');
  });
}

/** opts.activeOnly: chỉ bài tập đang mở (hạn nộp từ 3 ngày trước trở đi, hoặc giao trong 14 ngày nếu không có hạn) — dùng cho cập nhật nhanh 10 phút/lần. */
function syncAll_(opts) {
  opts = opts || {};
  ensureConfigRows_();
  ensureHeaders_(SH.CW, CW_HEADERS);
  const cfg = getConfig_();
  const courseT = readTable_(SH.COURSES, COURSE_HEADERS);
  if (!courseT.rows.length) refreshCourses_();
  const courses = readTable_(SH.COURSES, COURSE_HEADERS).rows
    .map((r, i) => ({ track: r[0] === true, name: r[1], id: String(r[4]), row: i }))
    .filter(c => c.track && c.id);

  const cwT = readTable_(SH.CW, CW_HEADERS);
  const subT = readTable_(SH.SUB, SUB_HEADERS);
  const cwIdx = indexBy_(cwT.rows, C['CourseWork ID']);
  const subIdx = indexBy_(subT.rows, S['Submission ID']);
  const newCw = [], newSub = [];
  const since = Date.now() - cfg.days * 86400000;
  const now = new Date();
  let nWork = 0, nSub = 0, nChanged = 0;

  const courseSh = sheet_(SH.COURSES);
  const allCourseRows = readTable_(SH.COURSES, COURSE_HEADERS).rows;
  const sprops = PropertiesService.getScriptProperties().getProperties();
  if (!opts.activeOnly) oldWorkOff_(courses, cwT, sprops);
  const cache = CacheService.getScriptCache();

  courses.forEach(course => {
    // Danh sách HS: lượt cập nhật nhanh dùng bản lưu tạm (6 giờ); lượt mỗi giờ luôn lấy mới
    let students = null;
    const stKey = 'st_' + course.id;
    if (opts.activeOnly) { try { students = JSON.parse(cache.get(stKey) || 'null'); } catch (e) { students = null; } }
    if (!students) {
      students = {};
      listAll_(tok => Classroom.Courses.Students.list(course.id, { pageSize: 100, pageToken: tok }), 'students')
        .forEach(st => {
          students[st.userId] = {
            name: (st.profile && st.profile.name && st.profile.name.fullName) || st.userId,
            email: (st.profile && st.profile.emailAddress) || '',
          };
        });
      try { cache.put(stKey, JSON.stringify(students), 21600); } catch (e) { /* lớp quá lớn: không lưu tạm */ }
    }
    const rowIdx = allCourseRows.findIndex(r => String(r[4]) === course.id);
    if (rowIdx >= 0 && !opts.activeOnly) courseSh.getRange(rowIdx + 2, 4).setValue(Object.keys(students).length);

    const works = listAll_(tok => Classroom.Courses.CourseWork.list(course.id, { pageSize: 100, pageToken: tok }), 'courseWork')
      .filter(w => {
        const due = dueDate_(w);
        const created = new Date(w.creationTime).getTime();
        if (opts.activeOnly && !(due ? due.getTime() >= Date.now() - 3 * 86400000 : created >= Date.now() - 14 * 86400000)) return false;
        return created >= since || (due && due.getTime() >= since);
      });

    works.forEach(w => {
      nWork++;
      const due = dueDate_(w);
      const mats = parseMaterials_(w.materials);
      let cwRow;
      if (cwIdx[w.id] !== undefined) {
        cwRow = cwT.rows[cwIdx[w.id]];
      } else {
        const skill = detectSkill_(w.title + ' ' + (w.description || ''));
        cwRow = new Array(CW_HEADERS.length).fill('');
        cwRow[C['Kỹ năng']] = skill;
        cwRow[C['Đề bài cho AI']] = (w.description || '').slice(0, 4000);
        // Chỉ tự chấm bài giao từ ngày lớp được thêm vào hệ thống; bài cũ hơn chỉ theo dõi nộp bài
        const from = trackFromMs_(sprops, course.id);
        const old = from && new Date(w.creationTime).getTime() < from;
        cwRow[C['Chấm tự động']] = skill !== SKILL_OTHER && !old;
        newCw.push(cwRow);
        cwIdx[w.id] = -1; // đánh dấu đã thêm
      }
      cwRow[C['Lớp']] = course.name;
      cwRow[C['Tiêu đề']] = w.title;
      cwRow[C['Hạn nộp']] = due || '';
      cwRow[C['Link']] = w.alternateLink;
      cwRow[C['Course ID']] = course.id;
      cwRow[C['CourseWork ID']] = w.id;
      if (!cwRow[C['Form URL']] && mats.formUrl) cwRow[C['Form URL']] = mats.formUrl;
      cwRow[C['File đề (ID)']] = mats.fileIds.join(',');
      cwRow[C['Tạo lúc']] = new Date(w.creationTime);
      const wType = writingTaskType_(cwRow[C['Kỹ năng']]);
      if (wType && !cwRow[C['Dạng bài Writing']]) {
        cwRow[C['Dạng bài Writing']] = writingTypeLabel_(wType, detectWritingType_(wType, cwRow[C['Đề bài cho AI']] || w.title));
      }
      const comps = componentsOf_(cwRow);
      if (comps.indexOf('Writing Task 2') >= 0 && !cwRow[C['Chủ đề Writing']]) cwRow[C['Chủ đề Writing']] = 'Other';

      let cOn = 0, cLate = 0, cMiss = 0;
      const subs = listAll_(tok => Classroom.Courses.CourseWork.StudentSubmissions.list(course.id, w.id, { pageSize: 100, pageToken: tok }), 'studentSubmissions');
      subs.forEach(s => {
        const st = students[s.userId];
        if (!st) return; // không còn trong lớp
        nSub++;
        const turnedAt = turnedInAt_(s);
        const status = statusOf_(s, turnedAt, due, now);
        if (status === STATUS.ON_TIME || (status === STATUS.RETURNED && turnedAt && !(due && turnedAt > due))) cOn++;
        else if (status === STATUS.LATE || (status === STATUS.RETURNED && turnedAt)) cLate++;
        else cMiss++;
        const work = submissionWork_(s);

        // Bài gộp (VD Reading + Writing): mỗi phần 1 dòng, ID = submissionId#phần
        comps.forEach(comp => {
          const rowId = comps.length > 1 ? s.id + '#' + comp : s.id;
          let r;
          if (subIdx[rowId] !== undefined && subIdx[rowId] >= 0) r = subT.rows[subIdx[rowId]];
          else if (subIdx[rowId] === undefined) {
            r = new Array(SUB_HEADERS.length).fill('');
            r[S['Duyệt gửi']] = false;
            newSub.push(r);
            subIdx[rowId] = -1 - newSub.length; // đánh dấu đã thêm
          } else return;
          r[S['Lớp']] = course.name;
          r[S['Bài tập']] = w.title;
          r[S['Kỹ năng']] = comp;
          r[S['Học sinh']] = st.name;
          r[S['Email']] = st.email;
          if (r[S['Trạng thái']] && r[S['Trạng thái']] !== status) nChanged++;
          r[S['Trạng thái']] = status;
          r[S['Nộp lúc']] = turnedAt || '';
          r[S['Hạn nộp']] = due || '';
          r[S['Bài làm']] = work.display;
          r[S['Submission ID']] = rowId;
          r[S['Course ID']] = course.id;
          r[S['CourseWork ID']] = w.id;
          r[S['User ID']] = s.userId;
          r[S['File IDs']] = work.fileIds.join(',');
        });
      });
      cwRow[C['Tổng HS']] = cOn + cLate + cMiss;
      cwRow[C['Đã nộp']] = cOn;
      cwRow[C['Nộp muộn']] = cLate;
      cwRow[C['Chưa nộp']] = cMiss;
    });
  });

  // Ghi bài tập: chỉ ghi cột hệ thống, giữ nguyên cột giáo viên đã sửa
  writeCols_(cwT, 0, 1);
  writeCols_(cwT, C['Hạn nộp'], CW_HEADERS.length - 1);
  if (newCw.length) {
    const start = cwT.sh.getLastRow() + 1;
    cwT.sh.getRange(start, 1, newCw.length, CW_HEADERS.length).setValues(newCw);
    cwT.sh.getRange(start, C['Chấm tự động'] + 1, newCw.length, 1).insertCheckboxes();
    cwT.sh.getRange(start, C['Chấm tự động'] + 1, newCw.length, 1).setValues(newCw.map(r => [r[C['Chấm tự động']]]));
  }
  const skillRule = SpreadsheetApp.newDataValidation().requireValueInList(SKILLS, true).build();
  if (cwT.sh.getLastRow() > 1 && (!opts.activeOnly || newCw.length)) {
    cwT.sh.getRange(2, C['Kỹ năng'] + 1, cwT.sh.getLastRow() - 1, 1).setDataValidation(skillRule);
    const typeLabels = Object.keys(WRITING_TYPES.task1_academic).concat(Object.keys(WRITING_TYPES.task2));
    cwT.sh.getRange(2, C['Dạng bài Writing'] + 1, cwT.sh.getLastRow() - 1, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(typeLabels, true).setAllowInvalid(true).build());
  }

  // Ghi bài nộp: cột 0-8 và 18-22
  writeCols_(subT, 0, 8);
  writeCols_(subT, S['Submission ID'], SUB_HEADERS.length - 1);
  if (newSub.length) {
    const start = subT.sh.getLastRow() + 1;
    subT.sh.getRange(start, 1, newSub.length, SUB_HEADERS.length).setValues(newSub);
    subT.sh.getRange(start, S['Duyệt gửi'] + 1, newSub.length, 1).insertCheckboxes();
  }

  if (!opts.activeOnly || newSub.length || newCw.length || nChanged) buildOverview_();
  return (opts.activeOnly ? 'Cập nhật nhanh ' : 'Đồng bộ ') + courses.length + ' lớp, ' + nWork + ' bài tập, ' + nSub + ' lượt nộp (' + newSub.length + ' mới' +
    (nChanged ? ', ' + nChanged + ' đổi trạng thái' : '') + ').';
}

function statusOf_(s, turnedAt, due, now) {
  if (s.state === 'TURNED_IN') return (due && turnedAt && turnedAt > due) || s.late ? STATUS.LATE : STATUS.ON_TIME;
  if (s.state === 'RETURNED') return STATUS.RETURNED;
  if (due && now > due) return STATUS.MISSING;
  return STATUS.NOT_YET;
}

function turnedInAt_(s) {
  let t = null;
  (s.submissionHistory || []).forEach(h => {
    if (h.stateHistory && h.stateHistory.state === 'TURNED_IN') t = h.stateHistory.stateTimestamp;
  });
  return t ? new Date(t) : null;
}

function dueDate_(w) {
  if (!w.dueDate || !w.dueDate.year) return null;
  const t = w.dueTime || {};
  // Classroom lưu giờ theo UTC; nếu không có giờ -> 23:59 giờ Việt Nam (16:59 UTC)
  const hasTime = t.hours !== undefined || t.minutes !== undefined;
  return new Date(Date.UTC(w.dueDate.year, w.dueDate.month - 1, w.dueDate.day,
    hasTime ? (t.hours || 0) : 16, hasTime ? (t.minutes || 0) : 59));
}

function parseMaterials_(materials) {
  const out = { formUrl: '', fileIds: [] };
  (materials || []).forEach(m => {
    if (m.form && m.form.formUrl && !out.formUrl) out.formUrl = m.form.formUrl;
    if (m.driveFile && m.driveFile.driveFile) out.fileIds.push(m.driveFile.driveFile.id);
  });
  return out;
}

/** Link bài làm không phải Google (OneDrive, Dropbox, Canva…): hệ thống không mở được, trả về tên miền. */
function externalLinks_(r) {
  const out = [];
  String(r[S['Bài làm']] || '').split('\n').forEach(l => {
    const m = String(l).trim().match(/^https?:\/\/([^/\s]+)/i);
    if (!m) return;
    const host = m[1].toLowerCase();
    if (/(^|\.)(google\.com|youtube\.com|youtu\.be|forms\.gle)$/.test(host)) return;
    if (out.indexOf(host) < 0) out.push(host);
  });
  return out;
}

/**
 * Nhắc HS nộp lại (1 lần cho mỗi bài nộp) khi file trống hoặc là link ngoài Google Drive.
 * Không nhắc khi đã quá hạn nộp hơn 3 ngày.
 */
function notifyResubmit_(r, cw, kind, cfg) {
  try {
    const email = String(r[S['Email']] || '').trim();
    if (!email) return;
    const due = r[S['Hạn nộp']];
    if (due instanceof Date && Date.now() - due.getTime() > 3 * 86400e3) return;
    const props = PropertiesService.getScriptProperties();
    const key = 'RESUBMIT_' + String(r[S['Submission ID']]).slice(0, 80);
    if (props.getProperty(key)) return;
    const title = String(r[S['Bài tập']] || '').trim();
    const why = kind === 'empty'
      ? 'File bài làm em nộp đang <b>trống</b> (chưa có nội dung), nên thầy/cô chưa chấm được.'
      : 'Em nộp <b>link ngoài Google Drive</b> (VD OneDrive), hệ thống không mở được nên chưa chấm được.';
    const how = kind === 'empty'
      ? 'Em mở lại bài trên Google Classroom, bấm <b>Huỷ nộp</b>, đính kèm đúng file đã làm (Google Docs/Word, ảnh hoặc PDF; ghi âm mp3/m4a cho Speaking) rồi bấm <b>Nộp</b> lại nhé.'
      : 'Em mở lại bài trên Google Classroom, bấm <b>Huỷ nộp</b>, tải file lên trực tiếp bằng nút <b>Thêm hoặc tạo → Tệp</b> (hoặc chọn từ Google Drive) rồi bấm <b>Nộp</b> lại nhé.';
    const body = emHeader_('Nhắc nộp lại bài', esc_(title), esc_(String(r[S['Lớp']] || ''))) +
      emRow_('Chào ' + esc_(String(r[S['Học sinh']] || 'em')) + ',') +
      emRow_(why) + emRow_(how) +
      emRow_(emButton_(String(cw[C['Link']] || 'https://classroom.google.com'), 'Mở bài trên Classroom'), '18px 28px 0') +
      emSign_(cfg.teacherName || 'Thầy/cô', 'Cảm ơn em!');
    MailApp.sendEmail({ to: email, subject: 'Nhắc nộp lại bài: ' + title, htmlBody: emShell_(body, 'Bài ' + title + ' cần nộp lại') });
    props.setProperty(key, new Date().toISOString());
  } catch (e) { log_('Lỗi nhắc nộp lại', e.message); }
}

function submissionWork_(s) {
  const links = [], fileIds = [];
  if (s.shortAnswerSubmission && s.shortAnswerSubmission.answer) links.push('Trả lời: ' + s.shortAnswerSubmission.answer);
  if (s.multipleChoiceSubmission && s.multipleChoiceSubmission.answer) links.push('Trả lời: ' + s.multipleChoiceSubmission.answer);
  const atts = (s.assignmentSubmission && s.assignmentSubmission.attachments) || [];
  atts.forEach(a => {
    if (a.driveFile) { fileIds.push(a.driveFile.id); links.push(a.driveFile.alternateLink); }
    else if (a.link) {
      links.push(a.link.url);
      // HS dán link Google Drive thay vì đính kèm: vẫn lấy file (nếu thầy/cô có quyền xem)
      const m = /(?:drive|docs)\.google\.com/.test(a.link.url) && String(a.link.url).match(/(?:\/d\/|[?&]id=)([\w-]{25,})/);
      if (m) fileIds.push(m[1]);
    }
    else if (a.youTubeVideo) links.push(a.youTubeVideo.alternateLink);
    else if (a.form) links.push(a.form.formUrl);
  });
  return { display: links.join('\n').slice(0, 2000), fileIds };
}

function detectSkill_(text) {
  const t = String(text).toLowerCase();
  if (/listening|\bnghe\b/.test(t)) return 'Listening';
  if (/reading|\bđọc\b/.test(t)) return /general|\bgt\b/.test(t) ? 'Reading (General)' : 'Reading (Academic)';
  if (/speaking|\bnói\b/.test(t)) return 'Speaking';
  if (/task\s*1/.test(t) && /writing|task|viết/.test(t)) return 'Writing Task 1';
  if (/writing|task\s*2|essay|\bviết\b/.test(t)) return 'Writing Task 2';
  return SKILL_OTHER;
}

// ---------------------------------------------------------------------------
// CHẤM BÀI
// ---------------------------------------------------------------------------
/** opts.quick: bỏ qua bài AI đang "Chờ" (để lượt thử lại 20 phút / mỗi giờ lo), tránh gọi AI dồn dập. */
function gradeAll_(opts) {
  opts = opts || {};
  const cfg = getConfig_();
  const cwT = readTable_(SH.CW, CW_HEADERS);
  const subT = readTable_(SH.SUB, SUB_HEADERS);
  const cwById = {};
  cwT.rows.forEach(r => { cwById[String(r[C['CourseWork ID']])] = r; });
  const keys = loadAnswerKeys_();
  const bands = loadBands_();
  const formCache = {}, taskCache = {}, webCtx = {};
  let nRL = 0, nAI = 0, nWeb = 0, nErr = 0, stoppedByQuota = false, aiDown = false, nWait = 0;

  for (let i = 0; i < subT.rows.length; i++) {
    if (timeUp_()) break;
    const r = subT.rows[i];
    const cw = cwById[String(r[S['CourseWork ID']])];
    if (!cw || cw[C['Chấm tự động']] !== true) continue;

    const skill = String(r[S['Kỹ năng']] || cw[C['Kỹ năng']]); // phần (component) của dòng này
    const isRL = /^Reading|^Listening/.test(skill);
    if (isRL && r[S['Đã gửi lúc']]) continue; // đã gửi kết quả (kèm đáp án) cho HS: không chấm lại
    const isWeb = /^Writing/.test(skill) && cfg.writingViaWeb;
    const isAI = !isWeb && /^Writing|^Speaking/.test(skill);
    if (!isRL && !isAI && !isWeb) continue;
    // R/L làm trên Form: chấm ngay khi có câu trả lời, kể cả khi HS chưa bấm "Nộp" trên Classroom
    const rlForm = isRL && rlSource_(cw, skill).formUrl;
    if (!needsGrading_(r) && !(rlForm && notGradedYet_(r))) continue;
    if ((isAI || isWeb) && nAI >= cfg.maxAi) continue;
    if (opts.quick && (isAI || isWeb) && String(r[S['Trạng thái chấm']] || '').indexOf('Chờ') === 0) continue;
    if ((stoppedByQuota || aiDown) && (isAI || (isRL && !rlForm))) { if (aiDown && isAI) nWait++; continue; } // phần cần AI để lần sau, phần khác chấm tiếp

    let result;
    try {
      if (isRL) {
        result = gradeRL_(r, cw, skill, keys, bands, formCache, cfg);
        if (result.usedAI) { nAI++; Utilities.sleep(cfg.aiSleep * 1000); }
        if (!result.skip) nRL++; // không đếm bài không có đáp án/Form (chỉ theo dõi nộp bài)
      } else if (isWeb) {
        result = sendToWritingSite_(r, cw, skill, cfg, webCtx);
        if (/^Đã gửi lên web/.test(result.status)) nWeb++;
        if (result.usedAI) { nAI++; Utilities.sleep(cfg.aiSleep * 1000); }
      } else {
        result = gradeAI_(r, cw, skill, cfg, taskCache);
        if (!result.noAI) { nAI++; Utilities.sleep(cfg.aiSleep * 1000); }
      }
    } catch (e) {
      if (e instanceof QuotaError) { if (!stoppedByQuota) log_('Hết hạn mức AI', e.message); stoppedByQuota = true; continue; }
      if (e instanceof OverloadError) {
        if (!aiDown) log_('AI quá tải', e.message);
        aiDown = true; nWait++;
        writeGrade_(subT, i, { status: 'Chờ: Gemini quá tải, sẽ chấm lại lần sau' });
        continue;
      }
      if (e instanceof TransientError) { writeGrade_(subT, i, { status: 'Chờ: ' + String(e.message).slice(0, 200) }); continue; }
      nErr++;
      result = { status: 'Lỗi: ' + String(e.message).slice(0, 200), stamp: true };
      if (!(e instanceof PermanentError)) log_('Lỗi chấm ' + r[S['Học sinh']] + ' - ' + r[S['Bài tập']], e.stack || e.message);
    }
    if (result.skip) continue; // chưa có gì để chấm (không ghi gì)
    writeGrade_(subT, i, result);
    if (result.resubmit) notifyResubmit_(r, cw, result.resubmit, cfg);
  }
  const retryAt = aiDown ? scheduleAiRetry_() : '';
  return 'Chấm: ' + nRL + ' bài R/L, ' + nAI + ' lượt AI' + (nWeb ? ', ' + nWeb + ' bài Writing gửi lên web' : '') + (nErr ? ', ' + nErr + ' lỗi (xem cột Trạng thái chấm)' : '') +
    (stoppedByQuota ? ' — phần cần AI tạm dừng vì hết hạn mức Gemini, sẽ tiếp tục lần sau' : '') +
    (aiDown ? ' — Gemini quá tải: ' + nWait + ' bài chờ, ' + (retryAt ? 'thử lại lúc ' + retryAt : 'thử lại lần sau') + ', các bài khác vẫn chấm' : '');
}

/** Bài cần chấm: đã nộp, và (chưa chấm | đang "Chờ" | nộp lại sau lần chấm trước). Xoá ô "Trạng thái chấm" để chấm lại. */
function needsGrading_(r) {
  const st = r[S['Trạng thái']];
  const turned = r[S['Nộp lúc']];
  if (!turned || [STATUS.ON_TIME, STATUS.LATE, STATUS.RETURNED].indexOf(st) < 0) return false;
  const gs = String(r[S['Trạng thái chấm']] || '');
  if (!gs || gs.indexOf('Chờ') === 0) return true;
  const at = r[S['Chấm lúc']];
  return at instanceof Date && new Date(turned) > at && st !== STATUS.RETURNED;
}

function notGradedYet_(r) {
  const gs = String(r[S['Trạng thái chấm']] || '');
  return !gs || gs.indexOf('Chờ') === 0;
}

/** Dữ liệu do "Giao bài" lưu cho bài tập (đáp án, Form, đề Writing/Speaking, các phần). */
function cwData_(cw) {
  try { return JSON.parse(String(cw[C['Dữ liệu bài (JSON)']] || '') || '{}'); } catch (e) { return {}; }
}

/** Các phần được chấm riêng của 1 bài tập. */
function componentsOf_(cw) {
  const d = cwData_(cw);
  if (d.components && d.components.length) return d.components;
  const skill = String(cw[C['Kỹ năng']] || '');
  return SKILL_COMPONENTS[skill] || [skill || SKILL_OTHER];
}

/** Mã đáp án + Form của phần Reading hoặc Listening. */
function rlSource_(cw, skill) {
  const d = cwData_(cw);
  const k = /^Listening/.test(skill) ? 'L' : 'R';
  return {
    keyCode: String((d.keys && d.keys[k]) || cw[C['Mã đáp án']] || '').trim(),
    formUrl: String((d.forms && d.forms[k]) || cw[C['Form URL']] || '').trim(),
  };
}

function writeGrade_(t, i, res) {
  const r = t.rows[i];
  const set = (k, v) => { if (v !== undefined) r[S[k]] = v; };
  set('Điểm', res.score);
  set('Band', res.band);
  set('Nhận xét tóm tắt', res.summary);
  set('File nhận xét', res.docUrl);
  set('Trạng thái chấm', res.status);
  if (res.stamp) r[S['Chấm lúc']] = new Date();
  t.sh.getRange(i + 2, S['Điểm'] + 1, 1, 6).setValues([r.slice(S['Điểm'], S['Chấm lúc'] + 1)]);
}

// ---- Reading / Listening ---------------------------------------------------
function gradeRL_(r, cw, skill, keys, bands, formCache, cfg) {
  const src = rlSource_(cw, skill);
  const code = src.keyCode;
  const key = code ? keys[code] : null;
  if (code && !key) throw new PermanentError('Không thấy mã đáp án "' + code + '" trong sheet Đáp án');
  const email = String(r[S['Email']]).toLowerCase();
  let answers = null, usedAI = false;

  const formUrl = src.formUrl;
  if (formUrl) {
    const fr = getFormResponses_(formUrl, formCache);
    const resp = fr[email];
    if (!resp) {
      // HS chưa nộp bài: im lặng chờ. Đã nộp mà chưa có câu trả lời Form: báo để giáo viên biết
      return r[S['Nộp lúc']] ? { status: 'Chờ: chưa thấy câu trả lời trên Form của HS này' } : { skip: true };
    }
    if (!key) {
      if (!resp.max) throw new PermanentError('Form không phải dạng Quiz và chưa có Mã đáp án');
      const b = toBand_(bands, skill, resp.score, resp.max);
      return {
        score: resp.score + '/' + resp.max, band: b.band,
        summary: 'Điểm theo đáp án trên Google Form' + (b.scaled ? ' (band quy đổi theo tỉ lệ /40)' : ''),
        status: 'Đã chấm', stamp: true,
      };
    }
    answers = resp.answers;
  } else {
    if (!key) return { skip: true }; // không có đáp án và không có Form: chỉ theo dõi nộp bài
    answers = extractAnswersAI_(r, Object.keys(key), cfg);
    usedAI = true;
  }

  const res = scoreAnswers_(answers, key);
  return rlGradeResult_(res, toBand_(bands, skill, res.correct, res.total), usedAI);
}

function getFormResponses_(formUrl, cache) {
  const id = formUrl;
  if (cache[id]) return cache[id];
  let form;
  try { form = FormApp.openByUrl(formUrl); }
  catch (e) { throw new PermanentError('Không mở được Form. Dán link chỉnh sửa (…/edit) của Form vào cột "Form URL" trong sheet Bài tập'); }
  const QTYPES = [FormApp.ItemType.MULTIPLE_CHOICE, FormApp.ItemType.CHECKBOX, FormApp.ItemType.LIST,
    FormApp.ItemType.TEXT, FormApp.ItemType.PARAGRAPH_TEXT];
  const items = form.getItems().filter(it => QTYPES.indexOf(it.getType()) >= 0);
  const nums = numberItems_(items.map(it => it.getTitle()));
  const isQuiz = form.isQuiz();
  let max = 0;
  if (isQuiz) items.forEach(it => { max += itemPoints_(it); });

  const out = {};
  form.getResponses().forEach(resp => {
    const email = String(resp.getRespondentEmail() || '').toLowerCase();
    if (!email) return;
    const answers = {};
    items.forEach((it, k) => {
      if (nums[k] === null) return;
      const ir = resp.getResponseForItem(it);
      let a = ir ? ir.getResponse() : '';
      if (Array.isArray(a)) a = a.join(',');
      answers[nums[k]] = a;
    });
    let score = 0;
    if (isQuiz) resp.getGradableItemResponses().forEach(g => { score += Number(g.getScore()) || 0; });
    const ts = typeof resp.getTimestamp === 'function' ? resp.getTimestamp() : null;
    out[email] = { answers, score, max, ts }; // phản hồi sau ghi đè phản hồi trước
  });
  cache[id] = out;
  return out;
}

function itemPoints_(it) {
  try {
    switch (it.getType()) {
      case FormApp.ItemType.MULTIPLE_CHOICE: return it.asMultipleChoiceItem().getPoints();
      case FormApp.ItemType.CHECKBOX: return it.asCheckboxItem().getPoints();
      case FormApp.ItemType.LIST: return it.asListItem().getPoints();
      case FormApp.ItemType.TEXT: return it.asTextItem().getPoints();
      case FormApp.ItemType.PARAGRAPH_TEXT: return it.asParagraphTextItem().getPoints();
    }
  } catch (e) { /* ignore */ }
  return 0;
}

/**
 * Đánh số câu hỏi trên Form. Nếu tiêu đề có số ở đầu ("1.", "Q12", "Question 3") thì dùng số đó,
 * câu không có số (Họ tên, Lớp…) bị bỏ qua. Nếu không, đánh số tuần tự, bỏ qua câu hỏi thông tin cá nhân.
 */
function numberItems_(titles) {
  const re = /^\s*(?:q(?:uestion)?\.?\s*|câu\s*)?(\d{1,3})\b/i;
  const parsed = titles.map(t => { const m = String(t).match(re); return m ? Number(m[1]) : null; });
  const withNum = parsed.filter(n => n !== null).length;
  if (withNum && withNum >= titles.length / 2) return parsed.map(n => (n === null ? null : String(n)));
  const info = /(họ.*tên|tên|name|email|lớp|class|mã\s*số|student\s*id|sđt|phone)/i;
  let k = 0;
  return titles.map(t => (info.test(String(t)) ? null : String(++k)));
}

function extractAnswersAI_(r, qnums, cfg) {
  const content = collectFileParts_(String(r[S['File IDs']] || ''), r[S['Bài làm']]);
  if (!content.parts.length) throw new PermanentError('Không có file/đáp án để chấm. ' + content.notes.join(' '));
  const prompt = 'You are reading a student\'s answer sheet for an IELTS Reading/Listening exercise. ' +
    'Extract exactly what the student wrote for each of these question numbers: ' + qnums.join(', ') + '. ' +
    'Do NOT correct spelling. If a question is unanswered or illegible, use "". ' +
    'Return JSON only: {"answers": {"1": "...", "2": "..."}}';
  const json = callGemini_([{ text: prompt }].concat(content.parts), cfg);
  return (json && json.answers) || {};
}

// ---- So khớp đáp án --------------------------------------------------------
function loadAnswerKeys_() {
  const vals = sheet_(SH.KEY).getDataRange().getValues().slice(1);
  const keys = {};
  vals.forEach(r => {
    const code = String(r[0]).trim(), q = String(r[1]).trim();
    if (!code || !q || r[2] === '') return;
    (keys[code] = keys[code] || {})[q] = String(r[2]);
    const m = String(r[3] || '').match(/Cặp:\s*([\d,\s-]+)/);
    if (m && !keys[code]._pairs) Object.defineProperty(keys[code], '_pairs', { value: parsePairs_(m[1]), enumerable: false });
  });
  return keys;
}

/** "1-2,3-4" -> [[1,2],[3,4]] */
function parsePairs_(s) {
  return String(s).split(',').map(x => x.split('-').map(Number)).filter(x => x.length === 2 && x[0] && x[1] >= x[0])
    .map(x => { const out = []; for (let q = x[0]; q <= x[1]; q++) out.push(q); return out; });
}

/**
 * Câu "Choose TWO letters" theo cặp: HS ghi đúng chữ nhưng khác thứ tự vẫn được điểm.
 * Sắp lại câu trả lời trong mỗi cặp cho khớp đáp án (VD đáp án 1=C, 2=D; HS ghi 1=D, 2=C -> 1=C, 2=D).
 * HS ghi cả 2 chữ vào 1 ô ("C,D") và bỏ trống ô kia cũng được tách ra.
 */
function alignPairs_(answers, key) {
  const pairs = key && key._pairs;
  if (!pairs || !pairs.length) return answers;
  const out = Object.assign({}, answers);
  const letters = v => String(v === undefined || v === null ? '' : v).toUpperCase().split(/[\s,;&\/]+|\bAND\b/).filter(x => /^[A-L]$/.test(x));
  pairs.forEach(qs => {
    let given = [];
    qs.forEach(q => { given = given.concat(letters(out[q])); });
    given = given.filter((x, i) => given.indexOf(x) === i).slice(0, qs.length);
    if (!given.length) return;
    const rest = given.slice();
    const res = {};
    qs.forEach(q => {
      const i = rest.findIndex(x => matchAnswer_(x, key[q]));
      if (i >= 0) { res[q] = rest[i]; rest.splice(i, 1); }
    });
    qs.forEach(q => { if (res[q] === undefined) res[q] = rest.length ? rest.shift() : ''; out[q] = res[q]; });
  });
  return out;
}

function scoreAnswers_(answers, key) {
  answers = alignPairs_(answers || {}, key);
  const wrong = [];
  let correct = 0;
  const qs = Object.keys(key).sort((a, b) => Number(a) - Number(b));
  qs.forEach(q => {
    const given = answers[q] !== undefined ? String(answers[q]) : '';
    if (matchAnswer_(given, key[q])) correct++;
    else wrong.push({ q, given, expected: key[q] });
  });
  return { correct, total: qs.length, wrong };
}

const ANSWER_SYNONYMS = {
  't': 'true', 'true': 'true', 'đúng': 'true',
  'f': 'false', 'false': 'false', 'sai': 'false',
  'ng': 'not given', 'not given': 'not given', 'notgiven': 'not given', 'not-given': 'not given',
  'y': 'yes', 'yes': 'yes', 'n': 'no', 'no': 'no',
};

function normAnswer_(s) {
  let x = String(s === null || s === undefined ? '' : s).toLowerCase()
    .replace(/[‘’\u0060]/g, "'").replace(/[“”]/g, '"')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')        // 2,000 -> 2000
    .replace(/\s+/g, ' ').trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/[.;:!]+$/, '').trim();
  if (ANSWER_SYNONYMS[x]) x = ANSWER_SYNONYMS[x];
  return x;
}

function letterSet_(s) {
  const x = normAnswer_(s);
  if (!/^[a-z](\s*(,|&|and|\s)\s*[a-z])+$/.test(x)) return null;
  return x.replace(/and/g, ',').split(/[\s,&]+/).filter(String).sort().join(',');
}

function expandVariants_(expected) {
  const out = [];
  String(expected).split('|').forEach(alt => {
    const withOpt = alt.replace(/[()]/g, '');
    const withoutOpt = alt.replace(/\([^)]*\)/g, ' ');
    [withOpt, withoutOpt].forEach(v => {
      const n = normAnswer_(v);
      if (n && out.indexOf(n) < 0) out.push(n);
    });
  });
  return out;
}

// Từ/đơn vị thường in sẵn trong đề (p.m., £, weeks, Building…): HS viết thêm vẫn được chấp nhận
const PRINTED_WORDS = /(^|\s)(a|an|the|p\.?\s?m\.?|a\.?\s?m\.?|pounds?|dollars?|euros?|pence|weeks?|days?|months?|years?|minutes?|mins?|hours?|building|street|road|room|per cent|percent)(?=\s|$)/g;
function stripPrinted_(s) {
  return String(s).replace(/[£$€%]/g, ' ').replace(PRINTED_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

function matchAnswer_(given, expected) {
  const g = normAnswer_(given);
  if (!g) return false;
  const gSet = letterSet_(given);
  const gDigits = g.replace(/\D/g, '');
  const variants = expandVariants_(expected);
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (g === v) return true;
    if (g.replace(/-/g, ' ') === v.replace(/-/g, ' ')) return true;
    const vSet = letterSet_(v);
    if (gSet && vSet && gSet === vSet) return true;
    // Số điện thoại / mã số: chỉ so chữ số (0161 4960 738 = 0161 496 0738)
    if (/^[\d\s().+-]{5,}$/.test(v) && gDigits.length >= 5 && /^[\d\s().+-]+$/.test(g) && gDigits === v.replace(/\D/g, '')) return true;
    // Viết thêm từ/đơn vị đã in sẵn: "7.15 pm" = 7.15, "10 weeks" = 10, "Science Building" = Science, "a colleague" = colleague
    const gs = stripPrinted_(g), vs = stripPrinted_(v);
    // (chỉ khi HS viết NHIỀU hơn đáp án, không chấp nhận viết thiếu: "two" ≠ "two hours")
    if (vs && gs === vs && g.split(' ').length >= v.split(' ').length) return true;
  }
  return false;
}

// ---- Quy đổi band ----------------------------------------------------------
const DEFAULT_BANDS = [
  ['Listening', [[39, 40, 9], [37, 38, 8.5], [35, 36, 8], [32, 34, 7.5], [30, 31, 7], [26, 29, 6.5], [23, 25, 6],
    [18, 22, 5.5], [16, 17, 5], [13, 15, 4.5], [10, 12, 4], [8, 9, 3.5], [6, 7, 3], [4, 5, 2.5], [0, 3, 0]]],
  ['Reading (Academic)', [[39, 40, 9], [37, 38, 8.5], [35, 36, 8], [33, 34, 7.5], [30, 32, 7], [27, 29, 6.5], [23, 26, 6],
    [19, 22, 5.5], [15, 18, 5], [13, 14, 4.5], [10, 12, 4], [8, 9, 3.5], [6, 7, 3], [4, 5, 2.5], [0, 3, 0]]],
  ['Reading (General)', [[40, 40, 9], [39, 39, 8.5], [37, 38, 8], [36, 36, 7.5], [34, 35, 7], [32, 33, 6.5], [30, 31, 6],
    [27, 29, 5.5], [23, 26, 5], [19, 22, 4.5], [15, 18, 4], [12, 14, 3.5], [9, 11, 3], [6, 8, 2.5], [0, 5, 0]]],
];

function loadBands_() {
  const vals = sheet_(SH.BAND).getDataRange().getValues().slice(1);
  const t = {};
  vals.forEach(r => { if (r[0] !== '') (t[r[0]] = t[r[0]] || []).push([Number(r[1]), Number(r[2]), r[3]]); });
  return t;
}

function toBand_(bands, skill, correct, total) {
  if (!total) return { band: '', scaled: false };
  const scaled = total !== 40;
  const raw = scaled ? Math.round(correct * 40 / total) : correct;
  const table = bands[skill] || [];
  for (let i = 0; i < table.length; i++) {
    if (raw >= table[i][0] && raw <= table[i][1]) return { band: table[i][2], scaled };
  }
  return { band: '', scaled };
}

// ---- Writing / Speaking bằng AI --------------------------------------------
function gradeAI_(r, cw, skill, cfg, taskCache) {
  const isSpeaking = skill === 'Speaking';
  let content;
  if (isSpeaking) {
    content = collectFileParts_(String(r[S['File IDs']] || ''), '', { audioOnly: true });
    if (!content.parts.length) {
      // Có file nhưng không đọc được (định dạng lạ, quá lớn, không có quyền): để thầy/cô xem tay, không tính là không làm
      if (content.notes.length) return { status: 'Lỗi — cần kiểm tra tay: ' + content.notes.join(' ') + ' Nhờ HS đổi sang mp3/m4a và nộp lại.', stamp: true, noAI: true };
      const ext = externalLinks_(r);
      if (ext.length) return { status: 'Lỗi — cần kiểm tra tay: HS nộp link ngoài Google Drive (' + ext.join(', ') + '), hệ thống không nghe được. Đã nhắc HS nộp lại file ghi âm.', stamp: true, noAI: true, resubmit: 'external' };
      return { status: 'Bỏ qua: chưa có file ghi âm (mp3/m4a/wav…).', stamp: true, noAI: true };
    }
  } else {
    const essay = writingEssay_(r, cw, skill, cfg, false);
    if (essay.text) content = { parts: [{ text: essay.text }], notes: [] };
    else if (essay.stop) return { status: essay.stop, stamp: true, noAI: true, resubmit: essay.resubmit };
    else content = collectFileParts_(String(r[S['File IDs']] || ''), r[S['Bài làm']]);
  }
  if (!content.parts.length) {
    const ext = externalLinks_(r);
    if (ext.length) return { status: 'Lỗi — cần kiểm tra tay: HS nộp link ngoài Google Drive (' + ext.join(', ') + '), hệ thống không mở được. Đã nhắc HS nộp lại.', stamp: true, noAI: true, resubmit: 'external' };
    return { status: 'Bỏ qua: không có file bài làm đọc được. ' + content.notes.join(' '), stamp: true, noAI: true };
  }
  const task = getTaskParts_(cw, skill, taskCache);
  const crit = isSpeaking ? ['FC', 'LR', 'GRA', 'P'] : [skill === 'Writing Task 1' ? 'TA' : 'TR', 'CC', 'LR', 'GRA'];

  const prompt = [
    'You are a senior, certified IELTS examiner. Assess the student\'s IELTS ' + skill + ' response strictly according to the official IELTS public band descriptors.',
    isSpeaking
      ? 'The response is an audio/video recording (or transcript). Transcribe it first, then assess Fluency & Coherence (FC), Lexical Resource (LR), Grammatical Range & Accuracy (GRA), Pronunciation (P). Pronunciation judged from audio only; if there is no audio, estimate P conservatively and say so.'
      : 'If the response is handwritten (image/PDF), transcribe it exactly first. Count the words. Assess ' +
        (skill === 'Writing Task 1' ? 'Task Achievement (TA)' : 'Task Response (TR)') +
        ', Coherence & Cohesion (CC), Lexical Resource (LR), Grammatical Range & Accuracy (GRA). Apply the under-length guidance (' +
        (skill === 'Writing Task 1' ? '150' : '250') + ' words).',
    'Be calibrated like a real examiner: do not inflate scores. Bands are 0-9 in 0.5 steps.',
    isSpeaking ? SPEAKING_SPREAD_ + speakingCalibration_(r) : '',
    'Write all comments, explanations, strengths, improvements and summary in ' + cfg.lang + '. Keep "original", "correction" and "transcript" in English.',
    'Return JSON only, with this exact shape:',
    JSON.stringify({
      transcript: 'full text of the student response',
      word_count: 0,
      criteria: crit.reduce((o, c) => { o[c] = { band: 6.0, comment: '...' }; return o; }, {}),
      overall_band: 6.0,
      strengths: ['...'],
      errors: [{ original: '...', correction: '...', type: 'Grammar|Vocabulary|Coherence|Task|Pronunciation', explanation: '...' }],
      improvements: ['...'],
      model_answer_paragraph: 'a short improved version of one weak paragraph/answer (English)',
      summary: '2-3 sentences overall feedback',
    }),
    'List at most 15 of the most important errors.',
    '--- TASK / QUESTION ---',
  ].join('\n');

  const parts = [{ text: prompt }].concat(task.parts.length ? task.parts : [{ text: '(Không có đề bài — hãy suy luận đề từ bài làm.)' }])
    .concat([{ text: '--- STUDENT RESPONSE ---' }]).concat(content.parts);

  AI_PROVIDER_ = 'gemini';
  let res = callGemini_(parts, cfg);
  let provider = AI_PROVIDER_;
  // Nhận xét phải đúng ngôn ngữ trong Cấu hình (model dự phòng đôi khi viết tiếng Anh): hỏi lại 1 lần
  if (/Việt/i.test(String(cfg.lang)) && !looksVietnamese_(res)) {
    try {
      const again = callGemini_([{ text: 'QUAN TRỌNG: viết toàn bộ "comment", "strengths", "explanation", "improvements" và "summary" bằng TIẾNG VIỆT (giữ "original", "correction", "transcript" bằng tiếng Anh).' }].concat(parts), cfg);
      if (looksVietnamese_(again)) { res = again; provider = AI_PROVIDER_; }
    } catch (e) { /* giữ bản đầu */ }
  }
  const critBands = crit.map(c => res.criteria && res.criteria[c] ? Number(res.criteria[c].band) : NaN);
  const overall = critBands.every(b => !isNaN(b)) ? roundIelts_(critBands.reduce((a, b) => a + b, 0) / 4) : Number(res.overall_band) || '';
  const critStr = crit.map((c, k) => c + ' ' + (isNaN(critBands[k]) ? '?' : critBands[k])).join(', ');
  const docUrl = writeFeedbackDoc_(r, skill, crit, res, overall, cfg);
  if (isSpeaking) { try { recordSpeakingAi_(r, critBands, overall, res.transcript); } catch (e) { /* bỏ qua */ } }

  return {
    score: isSpeaking ? '' : (res.word_count ? res.word_count + ' từ' : ''),
    band: overall,
    summary: 'Band ' + overall + ' (' + critStr + '). ' + (res.summary || ''),
    docUrl,
    status: provider === 'mistral' ? 'Đã chấm (AI · Mistral) — chờ duyệt' : provider === 'groq' ? 'Đã chấm (AI · Groq) — chờ duyệt' : 'Đã chấm (AI) — chờ duyệt',
    stamp: true,
  };
}

function roundIelts_(x) { return Math.floor(x * 2 + 0.5) / 2; }

// ---- Hiệu chỉnh chấm Speaking: bài thầy đã duyệt làm mẫu + độ lệch AI so với thầy ----
const SPK_HEADERS = ['Submission ID', 'Lớp', 'Bài tập', 'Học sinh', 'Chấm lúc', 'AI FC', 'AI LR', 'AI GRA', 'AI P', 'AI Band', 'Band thầy', 'Bản chép lời', 'Dùng làm mẫu', 'Duyệt lúc'];
const K_ = indexMap_(SPK_HEADERS);
const SPEAKING_SPREAD_ =
  'Differentiate between candidates: use the whole band range that the evidence supports (e.g. 4.0, 4.5, 5.5, 6.5), not a default Band 5. ' +
  'Score each criterion separately; the four bands do not have to be equal. Base Pronunciation on what you hear (stress, intonation, individual sounds, intelligibility). ' +
  'In every criterion comment quote at least one short piece of evidence from the transcript.';

function spkTable_() {
  initTable_(SH.SPK, SPK_HEADERS);
  return readTable_(SH.SPK, SPK_HEADERS);
}

/** Lưu kết quả AI của 1 bài Speaking (bản chép lời + điểm từng tiêu chí). */
function recordSpeakingAi_(r, bands, overall, transcript) {
  const t = spkTable_();
  const id = String(r[S['Submission ID']]);
  const row = [id, r[S['Lớp']], r[S['Bài tập']], r[S['Học sinh']], new Date(),
    bands[0], bands[1], bands[2], bands[3], overall, '', String(transcript || '').slice(0, 3000), true, ''];
  const i = t.rows.findIndex(x => String(x[K_['Submission ID']]) === id);
  if (i >= 0) {
    row[K_['Dùng làm mẫu']] = t.rows[i][K_['Dùng làm mẫu']] === false ? false : true;
    t.sh.getRange(i + 2, 1, 1, SPK_HEADERS.length).setValues([row]);
  } else {
    t.sh.appendRow(row);
    t.sh.getRange(t.sh.getLastRow(), K_['Dùng làm mẫu'] + 1).insertCheckboxes().setValue(true);
  }
}

/** Thầy duyệt gửi bài Speaking: band cuối cùng của thầy thành bài mẫu cho các lần chấm sau. */
function recordSpeakingFinal_(r) {
  const band = Number(r[S['Band']]);
  if (r[S['Band']] === '' || isNaN(band)) return;
  const t = spkTable_();
  const id = String(r[S['Submission ID']]);
  const i = t.rows.findIndex(x => String(x[K_['Submission ID']]) === id);
  if (i < 0) return;
  t.sh.getRange(i + 2, K_['Band thầy'] + 1).setValue(band);
  t.sh.getRange(i + 2, K_['Duyệt lúc'] + 1).setValue(new Date());
}

/** Bài mẫu (band thầy đã duyệt, nhiều mức band khác nhau) + độ lệch trung bình AI so với thầy. */
function speakingCalibration_(r) {
  let t;
  try { t = spkTable_(); } catch (e) { return ''; }
  const id = String(r[S['Submission ID']]);
  const done = t.rows.filter(x => x[K_['Dùng làm mẫu']] !== false && x[K_['Band thầy']] !== '' && !isNaN(Number(x[K_['Band thầy']])) &&
    String(x[K_['Submission ID']]) !== id && String(x[K_['Bản chép lời']]).length > 80)
    .sort((a, b) => (b[K_['Duyệt lúc']] || 0) - (a[K_['Duyệt lúc']] || 0));
  if (!done.length) return '';
  // Chọn tối đa 4 bài, ưu tiên các mức band khác nhau
  const picked = [], bands = {};
  done.forEach(x => { const b = Number(x[K_['Band thầy']]); if (picked.length < 4 && !bands[b]) { bands[b] = true; picked.push(x); } });
  done.forEach(x => { if (picked.length < 4 && picked.indexOf(x) < 0) picked.push(x); });
  const diffs = done.slice(0, 30).filter(x => !isNaN(Number(x[K_['AI Band']])) && x[K_['AI Band']] !== '')
    .map(x => Number(x[K_['Band thầy']]) - Number(x[K_['AI Band']]));
  const bias = diffs.length >= 3 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
  const lines = ['', 'CALIBRATION — responses from this class whose final band was confirmed by the teacher (use them to anchor your scale):'];
  picked.forEach((x, k) => {
    lines.push('Sample ' + (k + 1) + ' — teacher band ' + Number(x[K_['Band thầy']]) +
      (x[K_['AI Band']] !== '' ? ' (AI first estimate ' + Number(x[K_['AI Band']]) + ')' : '') + ':');
    lines.push('"' + String(x[K_['Bản chép lời']]).slice(0, 700) + '"');
  });
  if (Math.abs(bias) >= 0.25) {
    lines.push('On the last ' + diffs.length + ' responses the teacher\'s final band was on average ' + (bias > 0 ? '+' : '') +
      (Math.round(bias * 10) / 10) + ' compared with the AI estimate: correct for this tendency.');
  }
  return lines.join('\n');
}

/**
 * 1 lần: đưa các bài Speaking AI đã chấm trước bản cập nhật vào sheet "Mẫu Speaking"
 * (bản chép lời lấy từ file nhận xét; band thầy = band đã gửi cho HS).
 */
function backfillSpeakingSamples_() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('SPK_BACKFILL_DONE')) return '';
  const t = spkTable_();
  const have = {};
  t.rows.forEach(x => { have[String(x[K_['Submission ID']])] = true; });
  const subs = readTable_(SH.SUB, SUB_HEADERS).rows;
  const out = [];
  subs.forEach(r => {
    if (timeUp_()) return;
    if (String(r[S['Kỹ năng']]) !== 'Speaking' || have[String(r[S['Submission ID']])]) return;
    const sum = String(r[S['Nhận xét tóm tắt']] || '');
    const m = sum.match(/^Band ([\d.]+) \(FC ([\d.?]+), LR ([\d.?]+), GRA ([\d.?]+), P ([\d.?]+)\)/);
    const d = String(r[S['File nhận xét']] || '').match(/[?&]id=([\w-]+)|\/d\/([\w-]+)/);
    if (!m || !d) return;
    let transcript = '';
    try {
      const text = DocumentApp.openById(d[1] || d[2]).getBody().getText();
      const k = text.search(/Bài làm \(bản chép lại\)|Your response \(transcript\)/);
      if (k >= 0) transcript = text.slice(k).split('\n').slice(1).join(' ').trim();
    } catch (e) { return; }
    if (transcript.length < 80) return;
    const num = v => (v === '?' ? '' : Number(v));
    const sent = r[S['Đã gửi lúc']] instanceof Date;
    out.push([String(r[S['Submission ID']]), r[S['Lớp']], r[S['Bài tập']], r[S['Học sinh']], r[S['Chấm lúc']] || '',
      num(m[2]), num(m[3]), num(m[4]), num(m[5]), Number(m[1]),
      sent && r[S['Band']] !== '' ? Number(r[S['Band']]) : '', transcript.slice(0, 3000), true, sent ? r[S['Đã gửi lúc']] : '']);
  });
  if (timeUp_()) return 'Mẫu Speaking: đang nạp bài cũ, chạy tiếp lần sau';
  if (out.length) {
    const start = t.sh.getLastRow() + 1;
    t.sh.getRange(start, 1, out.length, SPK_HEADERS.length).setValues(out);
    t.sh.getRange(start, K_['Dùng làm mẫu'] + 1, out.length, 1).insertCheckboxes().setValues(out.map(() => [true]));
  }
  p.setProperty('SPK_BACKFILL_DONE', new Date().toISOString());
  return out.length ? 'Mẫu Speaking: nạp ' + out.length + ' bài đã chấm trước đây' : '';
}

/** Nhận xét có phải tiếng Việt không (đếm chữ có dấu tiếng Việt). */
function looksVietnamese_(res) {
  if (!res || typeof res !== 'object') return true;
  const crit = res.criteria && typeof res.criteria === 'object' ? Object.keys(res.criteria).map(k => (res.criteria[k] || {}).comment || '') : [];
  const text = [res.summary || ''].concat(crit).join(' ');
  const letters = (text.match(/[a-zà-ỹ]/gi) || []).length;
  if (letters < 40) return true;
  const vi = (text.match(/[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/gi) || []).length;
  return vi / letters >= 0.04;
}

// ---- AI dự phòng 2: Mistral (Voxtral nghe được ghi âm) khi mọi model Gemini quá tải / hết lượt ----
let AI_PROVIDER_ = 'gemini';
let MISTRAL_DOWN_ = false;

/** undefined: không dùng được Mistral (chưa có khoá, có ảnh/PDF, lỗi…). */
function callMistral_(parts) {
  const key = PropertiesService.getScriptProperties().getProperty('MISTRAL_API_KEY');
  if (!key || MISTRAL_DOWN_) return undefined;
  const content = [];
  let audio = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.text !== undefined) content.push({ type: 'text', text: String(p.text) });
    else if (p.inline_data && /^audio\//.test(p.inline_data.mime_type)) { content.push({ type: 'input_audio', input_audio: p.inline_data.data }); audio = true; }
    else return undefined; // ảnh, PDF, video: Mistral không đọc được ở đây
  }
  const model = audio ? 'voxtral-small-latest' : 'mistral-small-latest';
  try {
    const resp = UrlFetchApp.fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + key },
      payload: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'user', content }] }),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    if (code !== 200) {
      console.log('Mistral ' + code + ' (' + model + '): ' + body.slice(0, 300));
      if (code === 401 || code === 403 || code === 429 || code >= 500) MISTRAL_DOWN_ = true;
      return undefined;
    }
    const data = JSON.parse(body);
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    const text = msg ? (typeof msg.content === 'string' ? msg.content : (msg.content || []).map(c => c.text || '').join('')) : '';
    const parsed = tryParseJson_(text);
    if (parsed !== undefined) AI_PROVIDER_ = 'mistral';
    return parsed;
  } catch (e) {
    console.log('Mistral lỗi: ' + e.message);
    return undefined;
  }
}

// ---- AI dự phòng 1: Groq (miễn phí) — Whisper chép lời ghi âm + model chữ chấm theo bản chép lời ----
let GROQ_DOWN_ = false;
const GROQ_MODELS_ = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];
const GROQ_AUDIO_EXT_ = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/flac': 'flac', 'audio/x-flac': 'flac' };

/** Chép lời 1 file ghi âm bằng Whisper của Groq. undefined nếu lỗi. */
function groqTranscribe_(key, part) {
  const mime = String(part.inline_data.mime_type).toLowerCase();
  const ext = GROQ_AUDIO_EXT_[mime] || 'mp3';
  const blob = Utilities.newBlob(Utilities.base64Decode(part.inline_data.data), mime, 'recording.' + ext);
  const resp = UrlFetchApp.fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'post', headers: { Authorization: 'Bearer ' + key },
    payload: { file: blob, model: 'whisper-large-v3', language: 'en', response_format: 'text', temperature: '0' },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code !== 200) {
    console.log('Groq Whisper ' + code + ': ' + resp.getContentText().slice(0, 300));
    if (code === 401 || code === 403) GROQ_DOWN_ = true;
    return undefined;
  }
  return resp.getContentText().trim();
}

/** undefined: không dùng được Groq (chưa có khoá, có ảnh/PDF, lỗi…). */
function callGroq_(parts) {
  const key = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
  if (!key || GROQ_DOWN_) return undefined;
  const texts = [];
  let audio = false;
  try {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.text !== undefined) { texts.push(String(p.text)); continue; }
      if (p.inline_data && /^audio\//.test(p.inline_data.mime_type)) {
        const t = groqTranscribe_(key, p);
        if (t === undefined) return undefined;
        texts.push('[TRANSCRIPT of the student\'s recording, made automatically by Whisper]\n' + (t || '(empty — no speech detected)'));
        audio = true;
        continue;
      }
      return undefined; // ảnh, PDF, video: Groq không đọc được ở đây
    }
    if (audio) texts.unshift('NOTE: You cannot hear the recording; you only have an automatic transcript. Copy it into "transcript". Judge Pronunciation cautiously from the transcript (unclear or garbled words suggest pronunciation problems) and say in the Pronunciation comment that it was judged from the transcript.');
    for (let mi = 0; mi < GROQ_MODELS_.length; mi++) {
      const model = GROQ_MODELS_[mi];
      const resp = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + key },
        payload: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: texts.join('\n\n') }] }),
        muteHttpExceptions: true,
      });
      const code = resp.getResponseCode();
      const body = resp.getContentText();
      if (code !== 200) {
        console.log('Groq ' + code + ' (' + model + '): ' + body.slice(0, 300));
        if (code === 401 || code === 403) { GROQ_DOWN_ = true; return undefined; }
        continue; // 429 / 5xx / model không có: thử model sau
      }
      const data = JSON.parse(body);
      const msg = data.choices && data.choices[0] && data.choices[0].message;
      const parsed = tryParseJson_(msg && typeof msg.content === 'string' ? msg.content : '');
      if (parsed !== undefined) { AI_PROVIDER_ = 'groq'; return parsed; }
      console.log('Groq (' + model + ') trả lời sai định dạng JSON');
    }
    return undefined;
  } catch (e) {
    console.log('Groq lỗi: ' + e.message);
    return undefined;
  }
}

/** Khi Gemini không chấm được: thử Groq rồi Mistral. */
function callBackupAi_(parts) {
  const g = callGroq_(parts);
  if (g !== undefined) return g;
  return callMistral_(parts);
}

/** Chạy từ trình chỉnh sửa: thử khoá Groq bằng 1 lượt gọi nhỏ. */
function kiemTraGroq() {
  GROQ_DOWN_ = false;
  const res = callGroq_([{ text: 'Return JSON {"ok": true}.' }]);
  const msg = res === undefined ? 'Groq chưa dùng được (chưa có khoá GROQ_API_KEY, khoá sai hoặc hết lượt) — xem Nhật ký thực thi.' : 'Groq dùng được: ' + JSON.stringify(res);
  console.log(msg);
  return msg;
}

/** Chạy từ trình chỉnh sửa (hoặc menu): lưu khoá Mistral API. */
function setMistralKey() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Mistral API key', 'Tạo khoá miễn phí tại https://console.mistral.ai (API Keys) rồi dán vào đây:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const key = r.getResponseText().trim();
  if (!key) return;
  PropertiesService.getScriptProperties().setProperty('MISTRAL_API_KEY', key);
  ui.alert('Đã lưu khoá Mistral (trong Script Properties). Chạy hàm kiemTraMistral để thử.');
}

/** Chạy từ trình chỉnh sửa: thử khoá Mistral bằng 1 lượt gọi nhỏ. */
function kiemTraMistral() {
  MISTRAL_DOWN_ = false;
  const res = callMistral_([{ text: 'Return JSON {"ok": true}.' }]);
  const msg = res === undefined ? 'Mistral chưa dùng được (chưa có khoá, khoá sai hoặc hết lượt) — xem Nhật ký thực thi.' : 'Mistral dùng được: ' + JSON.stringify(res);
  console.log(msg);
  return msg;
}

function getTaskParts_(cw, skill, cache) {
  const id = String(cw[C['CourseWork ID']]) + '|' + skill;
  if (cache[id]) return cache[id];
  const parts = [];
  // Bài do "Giao bài" tạo: đề đã đọc sẵn từ file Word
  const d = cwData_(cw);
  if (/^Writing/.test(skill) && d.writing) {
    const p = writingPromptFor_(cw, skill);
    if (p) parts.push({ text: p });
    if (skill === 'Writing Task 1' && d.writing.task1ImageId) {
      try {
        const img = DriveApp.getFileById(d.writing.task1ImageId);
        parts.push({ inline_data: { mime_type: img.getMimeType(), data: Utilities.base64Encode(img.getBlob().getBytes()) } });
      } catch (e) { /* bỏ qua */ }
    }
    cache[id] = { parts };
    return cache[id];
  }
  if (skill === 'Speaking' && d.speakingPrompt) {
    cache[id] = { parts: [{ text: d.speakingPrompt }] };
    return cache[id];
  }
  const desc = String(cw[C['Đề bài cho AI']] || '').trim();
  if (desc) parts.push({ text: desc });
  const ids = String(cw[C['File đề (ID)']] || '').split(',').filter(String);
  ids.slice(0, 3).forEach(fid => {
    try {
      const f = DriveApp.getFileById(fid);
      const mime = f.getMimeType();
      if (mime === MimeType.GOOGLE_DOCS) parts.push({ text: DocumentApp.openById(fid).getBody().getText().slice(0, 8000) });
      else if (/^image\/|application\/pdf/.test(mime) && f.getSize() < 8e6) {
        parts.push({ inline_data: { mime_type: mime, data: Utilities.base64Encode(f.getBlob().getBytes()) } });
      }
    } catch (e) { /* bỏ qua tài liệu không mở được */ }
  });
  cache[id] = { parts };
  return cache[id];
}

/** Đọc bài làm của HS: Google Docs -> text; ảnh/PDF/audio/video -> gửi trực tiếp cho Gemini. */
function collectFileParts_(fileIdsCsv, displayText, opts) {
  opts = opts || {};
  const parts = [], notes = [];
  const short = String(displayText || '').split('\n').filter(l => l.indexOf('Trả lời: ') === 0).map(l => l.slice(9));
  if (short.length) parts.push({ text: short.join('\n') });
  let total = 0;
  fileIdsCsv.split(',').filter(String).forEach(id => {
    let f;
    try { f = DriveApp.getFileById(id); } catch (e) { notes.push('Không mở được 1 file (thiếu quyền?).'); return; }
    const mime = f.getMimeType();
    const name = f.getName();
    if (opts.audioOnly) {
      const gm = geminiMime_(mime, name);
      if (!gm || !/^(audio|video)\//.test(gm)) { // Speaking: bỏ qua ảnh chụp điểm, file Word…
        const ext = String(name).split('.').pop().toLowerCase();
        if (/^(audio|video)\//.test(mime) || /^(amr|3ga|wma|caf|m4b|mpga|mkv|avi|wmv)$/.test(ext))
          notes.push('File "' + name + '" là ghi âm/video nhưng định dạng chưa đọc được.');
        return;
      }
    }
    if (mime === MimeType.GOOGLE_DOCS) {
      parts.push({ text: '[File: ' + name + ']\n' + DocumentApp.openById(id).getBody().getText() });
      return;
    }
    if (mime === 'text/plain') { parts.push({ text: f.getBlob().getDataAsString() }); return; }
    const gm = geminiMime_(mime, name);
    if (!gm) { notes.push('File "' + name + '" (' + mime + ') chưa hỗ trợ — yêu cầu HS nộp Google Docs/ảnh/PDF/mp3.'); return; }
    const size = f.getSize();
    if (total + size > 14e6) { notes.push('File "' + name + '" quá lớn (>14MB) để chấm tự động.'); return; }
    total += size;
    parts.push({ text: '[File: ' + name + ']' });
    parts.push({ inline_data: { mime_type: gm, data: Utilities.base64Encode(f.getBlob().getBytes()) } });
  });
  return { parts, notes };
}

function geminiMime_(mime, name) {
  const ext = String(name).split('.').pop().toLowerCase();
  if (/^image\/(png|jpeg|jpg|webp|heic|heif)$/.test(mime)) return mime === 'image/jpg' ? 'image/jpeg' : mime;
  if (mime === 'application/pdf') return mime;
  if (mime === 'audio/mpeg' || ext === 'mp3') return 'audio/mp3';
  if (/wav/.test(mime) || ext === 'wav') return 'audio/wav';
  if (/m4a|mp4a/.test(mime) || ext === 'm4a') return 'audio/mp4';
  if (/aac/.test(mime) || ext === 'aac') return 'audio/aac';
  if (/ogg|opus/.test(mime) || ext === 'ogg' || ext === 'opus') return 'audio/ogg';
  if (/flac/.test(mime) || ext === 'flac') return 'audio/flac';
  if (/aiff/.test(mime) || ext === 'aif' || ext === 'aiff') return 'audio/aiff';
  if (mime === 'audio/3gpp' || ext === '3gp') return 'video/3gpp'; // máy Android cũ ghi âm ra .3gp
  if (/webm/.test(mime) || ext === 'webm') return 'video/webm';
  if (/^video\/(mp4|quicktime|mpeg|3gpp)/.test(mime)) return mime;
  return null;
}

/** Model dự phòng khi model chính quá tải / không có. */
/**
 * Thứ tự model thử khi gọi Gemini: model trong Cấu hình rồi các model miễn phí khác.
 * Quá tải (503) là theo từng model, nên thử nhiều model thì ít khi phải chờ.
 */
const GEMINI_MODELS_ = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-flash-lite-latest'];
function geminiModels_(model) {
  const out = [];
  [model].concat(GEMINI_MODELS_).forEach(m => { if (m && out.indexOf(m) < 0) out.push(m); });
  return out;
}
function geminiFallback_(model) { return geminiModels_(model)[1]; }
let GEMINI_DOWN_ = false; // trong 1 lượt chạy: mọi model đều quá tải thì không gọi tiếp (đỡ chờ)
let GEMINI_QUOTA_ = false;
const GEMINI_SKIP_ = {};  // trong 1 lượt chạy: model hết lượt (429) hoặc không có (404) thì bỏ qua

function callGemini_(parts, cfg) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new PermanentError('Chưa nhập Gemini API key (menu IELTS Checker > 2)');
  if (GEMINI_DOWN_ || GEMINI_QUOTA_) {
    const m = callBackupAi_(parts);
    if (m !== undefined) return m;
  }
  if (GEMINI_DOWN_) throw new OverloadError('Gemini đang quá tải — chờ lần thử lại');
  if (GEMINI_QUOTA_) throw new QuotaError('Gemini hết hạn mức — chờ lần chạy sau');
  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };
  const models = geminiModels_(cfg.model);
  let last = '', overloaded = false, badJson = false;
  for (let mi = 0; mi < models.length; mi++) {
    if (GEMINI_SKIP_[models[mi]]) continue;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(models[mi]) + ':generateContent';
    for (let attempt = 0; attempt < 2; attempt++) {
      const resp = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
        payload: JSON.stringify(payload), muteHttpExceptions: true,
      });
      const code = resp.getResponseCode();
      const body = resp.getContentText();
      if (code === 200) {
        const data = JSON.parse(body);
        const cand = data.candidates && data.candidates[0];
        const text = cand && cand.content && cand.content.parts
          ? cand.content.parts.filter(p => p.text && !p.thought).map(p => p.text).join('') : '';
        if (!text) throw new PermanentError('AI không trả kết quả' + (data.promptFeedback ? ' (' + JSON.stringify(data.promptFeedback) + ')' : ''));
        try { PropertiesService.getScriptProperties().deleteProperty('AI_DOWN_SINCE'); } catch (e) { /* bỏ qua */ }
        const parsed = tryParseJson_(text);
        if (parsed !== undefined) return parsed;
        badJson = true;
        last = 'Gemini (' + models[mi] + ') trả lời sai định dạng JSON';
        console.log(last + ': ' + text.slice(0, 500));
        break; // thử model khác
      }
      last = 'Gemini ' + code + ' (' + models[mi] + '): ' + body.slice(0, 300);
      if (code === 429 || code === 404) { GEMINI_SKIP_[models[mi]] = code; break; } // hết lượt / không có: thử model khác
      if (code >= 500) {
        if (attempt === 0) { Utilities.sleep(5000); continue; }
        overloaded = true;
        break; // thử model khác
      }
      let msg = body;
      try { msg = JSON.parse(body).error.message; } catch (e) { /* giữ nguyên */ }
      throw new PermanentError('Gemini ' + code + ': ' + String(msg).slice(0, 300));
    }
  }
  const viaMistral = callBackupAi_(parts);
  if (viaMistral !== undefined) return viaMistral;
  if (badJson && !overloaded) throw new TransientError('AI trả lời sai định dạng, sẽ chấm lại lần sau');
  if (!overloaded) {
    GEMINI_QUOTA_ = true;
    throw new QuotaError('Các model Gemini đều hết lượt miễn phí hoặc không dùng được (' + models.join(', ') + '). ' + last.slice(0, 200));
  }
  GEMINI_DOWN_ = true;
  try {
    const p = PropertiesService.getScriptProperties();
    if (!p.getProperty('AI_DOWN_SINCE')) p.setProperty('AI_DOWN_SINCE', new Date().toISOString());
  } catch (e) { /* bỏ qua */ }
  throw new OverloadError('Gemini quá tải (đã thử ' + models.filter(m => GEMINI_SKIP_[m] !== 404).join(', ') + ') — sẽ thử lại sau 20 phút. ' + last.slice(0, 200));
}

/** Gemini quá tải: hẹn 1 lượt chấm lại sau 20 phút (không đợi lượt chạy mỗi giờ). */
function scheduleAiRetry_() {
  try {
    const p = PropertiesService.getScriptProperties();
    if (ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'aiRetryJob')) return p.getProperty('AI_RETRY_AT') || '';
    ScriptApp.newTrigger('aiRetryJob').timeBased().after(20 * 60 * 1000).create();
    const at = Utilities.formatDate(new Date(Date.now() + 20 * 60 * 1000), Session.getScriptTimeZone(), 'HH:mm');
    p.setProperty('AI_RETRY_AT', at);
    return at;
  } catch (e) { return ''; }
}

/** Lượt chấm lại khi Gemini quá tải (chỉ chấm, không đồng bộ lại lớp). */
function aiRetryJob() { return trackRun_(aiRetryJob_); }
function aiRetryJob_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'aiRetryJob').forEach(t => ScriptApp.deleteTrigger(t));
  try {
    withLock_(() => {
      const b = gradeAll_();
      const w = syncWritingScores_();
      log_('Chấm lại (AI quá tải)', [b, w].filter(String).join(' | '));
    });
  } catch (e) {
    scheduleAiRetry_(); // đang có lượt chạy khác: hẹn lại
  }
}

/** JSON trong câu trả lời của AI; undefined nếu không đọc được. */
function tryParseJson_(text) {
  const t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const cands = [t];
  const first = firstJsonValue_(t);
  if (first) cands.push(first);
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) cands.push(t.slice(a, b + 1));
  for (let i = 0; i < cands.length; i++) {
    const forms = [cands[i], repairJson_(cands[i])];
    for (let j = 0; j < forms.length; j++) {
      try {
        let v = JSON.parse(forms[j]);
        if (Array.isArray(v) && v.length && typeof v[0] === 'object') v = v[0];
        if (v && typeof v === 'object') return v;
      } catch (e) { /* thử dạng khác */ }
    }
  }
  return undefined;
}

/** Khối {...} hoàn chỉnh đầu tiên (AI đôi khi viết thêm chữ hoặc khối thứ hai phía sau). */
function firstJsonValue_(t) {
  const start = t.indexOf('{');
  if (start < 0) return '';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return t.slice(start, i + 1); }
  }
  return '';
}

/** Sửa lỗi hay gặp: xuống dòng/tab nằm trong chuỗi, dấu phẩy thừa trước } hoặc ]. */
function repairJson_(t) {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      else if (ch === '\n') { out += '\\n'; continue; }
      else if (ch === '\r') continue;
      else if (ch === '\t') { out += '\\t'; continue; }
    } else if (ch === '"') inStr = true;
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function parseJsonLoose_(text) {
  const v = tryParseJson_(text);
  if (v === undefined) throw new PermanentError('AI trả về dữ liệu không hợp lệ');
  return v;
}

// ---- File nhận xét (Google Docs) -------------------------------------------
function feedbackFolder_(cfg) {
  if (cfg.folderId) { try { return DriveApp.getFolderById(cfg.folderId); } catch (e) { /* tạo mới */ } }
  const folder = DriveApp.createFolder('IELTS Checker - Nhận xét bài làm');
  setConfigValue_('Thư mục lưu nhận xét (ID)', folder.getId());
  cfg.folderId = folder.getId();
  return folder;
}

function writeFeedbackDoc_(r, skill, crit, res, overall, cfg) {
  const title = '[' + r[S['Lớp']] + '] ' + r[S['Bài tập']] + ' - ' + r[S['Học sinh']];
  let doc;
  const oldUrl = String(r[S['File nhận xét']] || '');
  const m = oldUrl.match(/\/d\/([\w-]+)/);
  if (m) { try { doc = DocumentApp.openById(m[1]); doc.getBody().clear(); } catch (e) { doc = null; } }
  if (!doc) {
    doc = DocumentApp.create(title);
    DriveApp.getFileById(doc.getId()).moveTo(feedbackFolder_(cfg));
  }
  const vi = /việt/i.test(cfg.lang);
  const L = vi
    ? { overall: 'Band tổng', crit: 'Tiêu chí', cmt: 'Nhận xét', str: 'Điểm mạnh', err: 'Lỗi cần sửa', orig: 'Bài viết', fix: 'Sửa thành', why: 'Giải thích', imp: 'Cách cải thiện', model: 'Đoạn mẫu tham khảo', tr: 'Bài làm (bản chép lại)', wc: 'Số từ', note: 'Nhận xét được hỗ trợ bởi AI và đã được giáo viên xem lại.' }
    : { overall: 'Overall band', crit: 'Criterion', cmt: 'Comment', str: 'Strengths', err: 'Errors to fix', orig: 'Original', fix: 'Correction', why: 'Explanation', imp: 'How to improve', model: 'Model paragraph', tr: 'Your response (transcript)', wc: 'Word count', note: 'AI-assisted feedback, reviewed by your teacher.' };
  const NAMES = { TR: 'Task Response', TA: 'Task Achievement', CC: 'Coherence & Cohesion', LR: 'Lexical Resource', GRA: 'Grammatical Range & Accuracy', FC: 'Fluency & Coherence', P: 'Pronunciation' };

  const body = doc.getBody();
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(skill + ' — ' + L.overall + ': ' + overall + (res.word_count ? '   |   ' + L.wc + ': ' + res.word_count : ''))
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (res.summary) body.appendParagraph(res.summary);

  const critRows = [[L.crit, 'Band', L.cmt]];
  crit.forEach(c => { const x = (res.criteria || {})[c] || {}; critRows.push([NAMES[c] || c, String(x.band === undefined ? '' : x.band), String(x.comment || '')]); });
  styleDocTable_(body.appendTable(critRows));

  if ((res.strengths || []).length) {
    body.appendParagraph(L.str).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    res.strengths.forEach(s => body.appendListItem(String(s)));
  }
  if ((res.errors || []).length) {
    body.appendParagraph(L.err).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    const rows = [[L.orig, L.fix, L.why]];
    res.errors.forEach(e => rows.push([String(e.original || ''), String(e.correction || ''), (e.type ? '[' + e.type + '] ' : '') + String(e.explanation || '')]));
    styleDocTable_(body.appendTable(rows));
  }
  if ((res.improvements || []).length) {
    body.appendParagraph(L.imp).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    res.improvements.forEach(s => body.appendListItem(String(s)));
  }
  if (res.model_answer_paragraph) {
    body.appendParagraph(L.model).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(String(res.model_answer_paragraph)).setItalic(true);
  }
  if (res.transcript) {
    body.appendParagraph(L.tr).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(String(res.transcript)).setItalic(false);
  }
  body.appendParagraph(L.note).setItalic(true).setFontSize(9);
  doc.saveAndClose();
  return doc.getUrl();
}

function styleDocTable_(table) {
  const head = table.getRow(0);
  for (let i = 0; i < head.getNumCells(); i++) head.getCell(i).setBackgroundColor('#e8eaf6').editAsText().setBold(true);
}

// ---------------------------------------------------------------------------
// TÍCH HỢP WEB "IELTS WRITING CHECKER" (nguyenducanh1910.github.io/ielts-writing-checker)
//  - Bài Writing nộp trên Classroom -> gửi vào hàng chờ chấm của web (action portal.essays.import)
//  - Giáo viên chấm trên web như bình thường, web tự gửi email kết quả cho học sinh
//  - Script đọc điểm từ Sheet dữ liệu của web về sheet "Nộp bài"
// ---------------------------------------------------------------------------
function connectWritingSite() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const p = props.getProperties();

  let r = ui.prompt('Kết nối web chấm Writing (1/2)',
    'Link Web app (Apps Script) của web chấm Writing, kết thúc bằng /exec.\nĐể trống để dùng:\n' + (p.WRITING_API_URL || DEFAULT_WRITING_API),
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const url = r.getResponseText().trim() || p.WRITING_API_URL || DEFAULT_WRITING_API;
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    ui.alert('Link không đúng dạng https://script.google.com/macros/s/…/exec'); return;
  }

  r = ui.prompt('Kết nối web chấm Writing (2/2)',
    'Link hoặc ID của Google Sheet dữ liệu web Writing (Script Property SHEET_ID trong project Apps Script của web).' +
    (p.WRITING_SHEET_ID ? '\nĐể trống để giữ: ' + p.WRITING_SHEET_ID : ''), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  let sheetId = r.getResponseText().trim() || p.WRITING_SHEET_ID || '';
  const m = sheetId.match(/\/d\/([\w-]+)/);
  if (m) sheetId = m[1];

  const secret = p.WRITING_SECRET || (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperties({ WRITING_API_URL: url, WRITING_SHEET_ID: sheetId, WRITING_SECRET: secret });
  ensureConfigRows_();

  // Kiểm tra kết nối
  let sheetMsg;
  try {
    sheetMsg = SpreadsheetApp.openById(sheetId).getSheetByName('Essays') ? '✔ Đọc được Sheet dữ liệu web Writing'
      : '✘ Sheet này không có tab "Essays" — kiểm tra lại SHEET_ID';
  } catch (e) { sheetMsg = '✘ Không mở được Sheet dữ liệu (sai ID hoặc khác tài khoản Google)'; }
  let secretOk = false, apiMsg;
  try {
    const res = rawWritingCall_(url, { action: 'portal.essays.import', payload: { secret } });
    if (res.ok === false && res.error && res.error.code === 'bad_request') { secretOk = true; apiMsg = '✔ Web Writing đã chấp nhận mã kết nối'; }
    else if (res.ok === false && res.error && res.error.code === 'forbidden') apiMsg = '✘ Web Writing CHƯA có mã kết nối — làm theo hướng dẫn bên dưới';
    else apiMsg = '? Web trả lời bất thường: ' + JSON.stringify(res).slice(0, 200);
  } catch (e) { apiMsg = '✘ Không gọi được web Writing: ' + e.message; }

  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;font-size:14px;line-height:1.5">' +
    '<p>' + esc_(sheetMsg) + '<br>' + esc_(apiMsg) + '</p>' +
    (secretOk ? '<p>Hoàn tất! Bài Writing trên Classroom sẽ tự vào hàng chờ chấm của web.</p>' :
      '<p><b>Việc cần làm 1 lần</b> trong project Apps Script của <b>web chấm Writing</b>:</p><ol>' +
      '<li>Mở project → <b>Cài đặt dự án</b> (bánh răng) → <b>Thuộc tính tập lệnh</b> → Thêm thuộc tính</li>' +
      '<li>Tên: <code>PORTAL_SECRET</code> &nbsp; Giá trị: mã bên dưới → Lưu</li>' +
      '<li>Quay lại đây chạy lại menu <b>3. Kết nối web chấm Writing</b> (bấm OK 2 lần) để kiểm tra</li></ol>') +
    '<p>Mã kết nối (giữ bí mật):</p><input style="width:100%;font-family:monospace;padding:6px" readonly onclick="this.select()" value="' + esc_(secret) + '">' +
    '</div>').setWidth(560).setHeight(secretOk ? 260 : 380);
  ui.showModalDialog(html, 'Kết nối web chấm Writing');
}

function writingConn_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  if (!p.WRITING_SECRET) return null;
  return { url: p.WRITING_API_URL || DEFAULT_WRITING_API, secret: p.WRITING_SECRET, sheetId: p.WRITING_SHEET_ID || '' };
}

function rawWritingCall_(url, body) {
  let resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(body),
      muteHttpExceptions: true, followRedirects: true,
    });
  } catch (e) { throw new TransientError('không kết nối được web Writing (' + e.message + ')'); }
  const text = resp.getContentText();
  try { return JSON.parse(text); } catch (e) {
    throw new TransientError('web Writing trả về HTTP ' + resp.getResponseCode() + ' (kiểm tra bản triển khai Web app)');
  }
}

function callWritingApi_(conn, action, payload) {
  payload.secret = conn.secret;
  const res = rawWritingCall_(conn.url, { action, payload });
  if (res.ok) return res.data;
  const err = res.error || {};
  if (err.code === 'forbidden') throw new PermanentError('Web Writing từ chối mã kết nối — chạy menu "3. Kết nối web chấm Writing"');
  if (err.code === 'bad_request') {
    const fields = err.fields ? ' ' + Object.keys(err.fields).map(k => k + ': ' + err.fields[k]).join('; ') : '';
    throw new PermanentError('Web Writing báo lỗi: ' + err.message + fields);
  }
  throw new TransientError('web Writing: ' + (err.message || 'lỗi không rõ'));
}

function sendToWritingSite_(r, cw, skill, cfg, webCtx) {
  const conn = writingConn_();
  if (!conn) throw new PermanentError('Chưa kết nối web chấm Writing (menu IELTS Checker > 3)');
  const taskType = writingTaskType_(skill);
  const email = String(r[S['Email']] || '').trim().toLowerCase();
  if (!email) throw new PermanentError('Học sinh không có email trên Classroom');
  const prompt = writingPromptFor_(cw, skill);
  if (prompt.length < 10) throw new PermanentError('Thiếu đề bài: dán đề vào cột "Đề bài cho AI" trong sheet Bài tập');

  const essay = writingEssay_(r, cw, skill, cfg, true);
  if (!essay.text) return { status: essay.stop || ('Bỏ qua: ' + essay.note), stamp: true, resubmit: essay.resubmit };

  const turned = new Date(r[S['Nộp lúc']]);
  const payload = {
    // Mỗi lần nộp (kể cả nộp lại) là 1 bài trên web; gửi lại cùng lần nộp sẽ không bị trùng
    submissionId: ('cr-' + r[S['Submission ID']] + '-' + Math.floor(turned.getTime() / 1000)).slice(0, 64),
    studentEmail: email,
    studentName: String(r[S['Học sinh']] || email).slice(0, 80),
    taskType,
    prompt: prompt.slice(0, 4000),
    body: essay.text.slice(0, 20000),
    mode: 'practice',
    submittedAt: turned.toISOString(),
  };
  if (taskType === 'task1_academic') {
    payload.diagramType = writingTypeId_(taskType, cw[C['Dạng bài Writing']]) || detectWritingType_(taskType, prompt);
    payload.image = taskImageForWeb_(cw, webCtx);
    if (!payload.image) throw new PermanentError('Writing Task 1 cần ảnh biểu đồ PNG/JPG (≤ 5 MB) đính kèm trong bài tập trên Classroom');
  } else {
    payload.topicId = topicIdForWeb_(conn, webCtx, cw[C['Chủ đề Writing']]);
    payload.essayType = writingTypeId_(taskType, cw[C['Dạng bài Writing']]) || detectWritingType_(taskType, prompt);
  }
  const data = callWritingApi_(conn, 'portal.essays.import', payload);
  return {
    score: '', band: '',
    summary: essay.usedAI ? 'Bài viết tay — AI đã chép lại thành văn bản, nên đối chiếu bản gốc khi chấm.' : '',
    docUrl: cfg.writingAppUrl + '#/admin/score/' + data.essayId,
    status: 'Đã gửi lên web — chờ chấm',
    stamp: true,
    usedAI: essay.usedAI,
  };
}

/** Đề Writing của 1 phần: từ file Word (Giao bài) hoặc cột "Đề bài cho AI". */
function writingPromptFor_(cw, skill) {
  const w = cwData_(cw).writing || {};
  const p = skill === 'Writing Task 1' ? w.task1Prompt : skill === 'Writing Task 2' ? w.task2Prompt : '';
  return String(p || cw[C['Đề bài cho AI']] || '').trim();
}

/**
 * Lấy bài viết của 1 Task từ bài nộp.
 *  - File Word / Google Docs theo mẫu (có dòng "TASK 1 – Answer"/"TASK 2 – Answer"): lấy đúng phần của Task đó
 *  - Bài cũ không theo mẫu: lấy toàn bộ văn bản; ảnh/PDF viết tay -> Gemini chép lại (nếu cho phép)
 * Trả về {text} hoặc {stop: 'trạng thái'} (dừng, không chấm) hoặc {text:'', note}.
 */
function writingEssay_(r, cw, skill, cfg, allowOcr) {
  const task = skill === 'Writing Task 1' ? 1 : 2;
  const templated = !!cwData_(cw).writing || componentsOf_(cw).length > 1;
  const texts = String(r[S['Bài làm']] || '').split('\n').filter(l => l.indexOf('Trả lời: ') === 0).map(l => l.slice(9));
  const media = [];
  let sawMarkers = false, sawDoc = false;
  const others = []; // file Word/Docs không theo mẫu (HS tự tạo file mới)
  const emptyDocs = []; // file Word/Docs HS nộp nhưng trống
  const ids = String(r[S['File IDs']] || '').split(',').filter(String);
  for (let k = 0; k < ids.length; k++) {
    let f;
    try { f = DriveApp.getFileById(ids[k]); } catch (e) { continue; }
    const mime = f.getMimeType();
    if (mime === MimeType.GOOGLE_DOCS || mime === DOCX_MIME) {
      sawDoc = true;
      const paras = readDocx_(f).paras;
      const w = parseWriting_(paras);
      if (w.hasMarkers) {
        sawMarkers = true;
        const ans = task === 1 ? w.task1Answer : w.task2Answer;
        if (ans && countWords_(ans) >= 20) return { text: ans };
        continue;
      }
      texts.push(paras.join('\n'));
      if (paras.join(' ').trim()) others.push({ name: f.getName(), text: paras.join('\n').trim() });
      else emptyDocs.push(f.getName());
    } else if (mime === 'text/plain') texts.push(f.getBlob().getDataAsString());
    else if (/^image\/(png|jpeg|webp|heic|heif)$|application\/pdf/.test(mime) && f.getSize() < 14e6) {
      media.push({ inline_data: { mime_type: mime, data: Utilities.base64Encode(f.getBlob().getBytes()) } });
    }
  }
  if (sawMarkers) {
    // File mẫu còn trống ở Task này nhưng HS nộp bài ở chỗ khác
    const otherText = others.map(o => o.text).join('\n\n');
    const names = others.map(o => '"' + o.name + '"').join(', ');
    if (countWords_(otherText) >= 50) {
      if (componentsOf_(cw).filter(c => /^Writing/.test(c)).length <= 1) return { text: otherText, note: 'HS viết ở file khác: ' + names };
      return { text: '', stop: 'Lỗi — cần kiểm tra tay: file Writing mẫu còn trống ở Task ' + task + ', HS nộp bài ở file khác (' + names + ')' };
    }
    if (media.length) return { text: '', stop: 'Lỗi — cần kiểm tra tay: file Writing mẫu còn trống ở Task ' + task + ', HS nộp kèm ảnh/PDF (có thể là bài viết tay)' };
    return { text: '', stop: 'Bỏ qua: HS chưa viết Task ' + task + ' (phần dưới dòng "TASK ' + task + ' – Answer" trống)' };
  }
  if (templated && sawDoc) {
    return { text: '', stop: 'Lỗi: không thấy dòng "TASK ' + task + ' – Answer" trong file Word của HS (có thể đã bị xoá) — cần kiểm tra tay' };
  }
  if (templated && !sawDoc && !media.length) return { text: '', stop: 'Bỏ qua: HS chưa nộp file Writing' };
  const text = texts.join('\n\n').replace(/\r/g, '').trim();
  if (text) return { text, usedAI: false };
  if (!allowOcr) return { text: '', note: '' };
  if (!media.length) {
    const ext = externalLinks_(r);
    if (ext.length) return { text: '', stop: 'Lỗi — cần kiểm tra tay: HS nộp link ngoài Google Drive (' + ext.join(', ') + '), hệ thống không mở được. Đã nhắc HS nộp lại.', resubmit: 'external' };
    if (emptyDocs.length) return { text: '', stop: 'Bỏ qua: file bài làm trống (' + emptyDocs.join(', ') + '). Đã nhắc HS nộp lại.', resubmit: 'empty' };
    return { text: '', note: 'không có bài làm đọc được (cần Google Docs, ảnh hoặc PDF)' };
  }
  if (!cfg.ocrHandwriting) return { text: '', note: 'bài nộp dạng ảnh/PDF — bật "Dùng Gemini chép bài viết tay" trong Cấu hình hoặc yêu cầu HS nộp Google Docs' };
  const json = callGemini_([{
    text: 'Transcribe the student\'s handwritten/printed IELTS essay in these files exactly as written, ' +
      'keeping paragraph breaks and the student\'s own spelling and grammar mistakes (do NOT correct anything). ' +
      'Do not include the task question. Return JSON only: {"text": "..."}',
  }].concat(media), cfg);
  return { text: String((json && json.text) || '').trim(), usedAI: true, note: 'AI không đọc được chữ trong ảnh' };
}

function taskImageForWeb_(cw, webCtx) {
  const id = String(cw[C['CourseWork ID']]);
  webCtx.images = webCtx.images || {};
  if (webCtx.images[id] !== undefined) return webCtx.images[id];
  let img = null;
  const fromDoc = (cwData_(cw).writing || {}).task1ImageId; // ảnh biểu đồ lấy từ file Word đề Writing
  [fromDoc].concat(String(cw[C['File đề (ID)']] || '').split(',')).filter(String).some(fid => {
    try {
      const f = DriveApp.getFileById(fid);
      const mime = f.getMimeType();
      if ((mime === 'image/png' || mime === 'image/jpeg') && f.getSize() <= 5 * 1024 * 1024) {
        img = { base64: Utilities.base64Encode(f.getBlob().getBytes()), mimeType: mime, name: f.getName().slice(0, 120) };
        return true;
      }
    } catch (e) { /* bỏ qua */ }
    return false;
  });
  webCtx.images[id] = img;
  return img;
}

function topicIdForWeb_(conn, webCtx, label) {
  if (!webCtx.topics) {
    if (!conn.sheetId) throw new PermanentError('Cần ID Sheet dữ liệu web Writing để lấy danh sách chủ đề (menu 3)');
    webCtx.topics = {};
    readDbTab_(SpreadsheetApp.openById(conn.sheetId), 'Topics').forEach(t => {
      if (t.id) webCtx.topics[String(t.label).trim().toLowerCase()] = t.id;
    });
  }
  const want = String(label || 'Other').trim().toLowerCase();
  const id = webCtx.topics[want] || webCtx.topics['other'];
  if (!id) throw new PermanentError('Không thấy chủ đề "' + label + '" trên web Writing (trang Lists)');
  return id;
}

function writingTaskType_(skill) {
  if (skill === 'Writing Task 1') return 'task1_academic';
  if (skill === 'Writing Task 2') return 'task2';
  return '';
}

/** Nhận cả dạng gộp "Static; Pros & Cons" (bài có cả Task 1 và Task 2): lấy nhãn hợp với Task. */
function writingTypeId_(taskType, label) {
  const map = WRITING_TYPES[taskType] || {};
  const ids = Object.keys(map).map(k => map[k]);
  const parts = String(label || '').split(';').map(x => x.trim()).filter(String);
  for (let i = 0; i < parts.length; i++) {
    if (map[parts[i]]) return map[parts[i]];
    if (ids.indexOf(parts[i]) >= 0) return parts[i];
  }
  return '';
}

function writingTypeLabel_(taskType, id) {
  const map = WRITING_TYPES[taskType] || {};
  return Object.keys(map).filter(k => map[k] === id)[0] || '';
}

/** Đoán dạng bài từ đề (giáo viên sửa lại ở cột "Dạng bài Writing" nếu cần). */
function detectWritingType_(taskType, prompt) {
  const t = String(prompt || '').toLowerCase();
  if (taskType === 'task1_academic') {
    if (/process|stages?|how .* (is|are) (made|produced|manufactured)|life ?cycle/.test(t)) return 'process';
    if (/\bmaps?\b|\bplans?\b|layout|floor plan/.test(t)) return 'map';
    if (/(chart|graph|table|diagram)s?\b.*\band\b.*\b(chart|graph|table|diagram)s?\b/.test(t)) return 'mixed';
    if (/(19|20)\d\d\D+(19|20)\d\d|over (a|the) period|changes?\b|trend/.test(t)) return 'dynamic';
    return 'static';
  }
  if (/discuss both|both (these )?views|both sides/.test(t)) return 'discussion';
  if (/advantages?.*disadvantages?|benefits?.*drawbacks?|outweigh/.test(t)) return 'pros_cons';
  if (/agree or disagree|to what extent|do you agree/.test(t)) return 'agree_disagree';
  if (/(causes?|reasons?|problems?|effects?|why)\b.*\b(solutions?|solve|measures|tackle|done|address)/.test(t)) return 'res';
  if ((t.match(/\?/g) || []).length >= 2) return 'two_part';
  return 'agree_disagree';
}

/** Đọc điểm đã chấm trên web Writing về sheet "Nộp bài". */
/**
 * Web Writing vừa gửi điểm: lấy điểm về ngay (không đợi lượt chạy mỗi giờ).
 * Hệ thống đang bận (lượt chạy khác giữ khoá) thì hẹn lấy lại sau 1 phút.
 */
function writingScoresNow_() {
  const lock = LockService.getScriptLock();
  if (lock.tryLock(5000)) {
    try { return { message: syncWritingScores_() || 'Không có điểm mới.' }; }
    finally { lock.releaseLock(); }
  }
  scheduleWritingSync_();
  return { message: 'Hệ thống đang bận — sẽ lấy điểm sau khoảng 1 phút.', scheduled: true };
}

function scheduleWritingSync_() {
  try {
    if (ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'writingSyncJob')) return;
    ScriptApp.newTrigger('writingSyncJob').timeBased().after(60 * 1000).create();
  } catch (e) { /* lượt chạy mỗi giờ vẫn lấy điểm */ }
}

/** Lượt lấy điểm Writing được hẹn khi hệ thống đang bận. */
function writingSyncJob() { return trackRun_(writingSyncJob_); }
function writingSyncJob_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'writingSyncJob').forEach(t => ScriptApp.deleteTrigger(t));
  try {
    withLock_(() => { const w = syncWritingScores_(); if (w) log_('Lấy điểm Writing', w); });
  } catch (e) { scheduleWritingSync_(); }
}

function syncWritingScores_() {
  const conn = writingConn_();
  if (!conn || !conn.sheetId) return '';
  const t = readTable_(SH.SUB, SUB_HEADERS);
  const pending = [];
  t.rows.forEach((r, i) => {
    const gs = String(r[S['Trạng thái chấm']]);
    // Bài đã gỡ khỏi hàng chờ vẫn theo dõi: thầy đưa lại vào hàng chờ thì dòng trở về "chờ chấm"
    if (gs.indexOf('Đã gửi lên web') === 0 || gs.indexOf('email chưa gửi') >= 0 || gs.indexOf('Bỏ qua: đã gỡ khỏi hàng chờ web Writing') === 0) pending.push(i);
  });
  if (!pending.length) return '';
  let db;
  try { db = SpreadsheetApp.openById(conn.sheetId); }
  catch (e) { log_('Lỗi đọc web Writing', e.message); return 'Không mở được Sheet dữ liệu web Writing'; }
  const essays = {}, scores = {}, sentAt = {};
  readDbTab_(db, 'Essays').forEach(e => { essays[e.id] = e; });
  readDbTab_(db, 'Scores').forEach(s => { scores[s.essay_id] = s; });
  readDbTab_(db, 'EmailEvents').forEach(ev => {
    if ((ev.type === 'result' || ev.type === 'result_resent') && ev.status === 'sent') sentAt[ev.essay_id] = ev.created_at;
  });

  let n = 0;
  pending.forEach(i => {
    const r = t.rows[i];
    const m = String(r[S['File nhận xét']] || '').match(/score\/([\w-]+)/);
    const e = m && essays[m[1]];
    if (!e) return;
    const id = m[1];
    if (e.withdrawn_at && e.status !== 'scored') {
      const st = 'Bỏ qua: đã gỡ khỏi hàng chờ web Writing (không chấm)';
      if (r[S['Trạng thái chấm']] !== st) t.sh.getRange(i + 2, S['Trạng thái chấm'] + 1).setValue(st);
      return;
    }
    if (e.status !== 'scored' || !scores[id]) {
      const st = e.status === 'in_review' ? 'Đã gửi lên web — đang chấm' : 'Đã gửi lên web — chờ chấm';
      if (r[S['Trạng thái chấm']] !== st) t.sh.getRange(i + 2, S['Trạng thái chấm'] + 1).setValue(st);
      return;
    }
    const s = scores[id];
    const sent = sentAt[id];
    r[S['Điểm']] = (e.task_type === 'task1_academic' ? 'TA ' : 'TR ') + s.criterion_1 + ' · CC ' + s.criterion_2 +
      ' · LR ' + s.criterion_3 + ' · GRA ' + s.criterion_4;
    r[S['Band']] = isNaN(Number(s.overall)) ? s.overall : Number(s.overall);
    r[S['Nhận xét tóm tắt']] = String(s.general_comment || '').slice(0, 1500);
    r[S['Trạng thái chấm']] = sent ? 'Đã chấm trên web — web đã gửi email' : 'Đã chấm trên web — email chưa gửi';
    t.sh.getRange(i + 2, S['Điểm'] + 1, 1, 5).setValues([r.slice(S['Điểm'], S['Trạng thái chấm'] + 1)]);
    if (sent && !r[S['Đã gửi lúc']]) t.sh.getRange(i + 2, S['Đã gửi lúc'] + 1).setValue(new Date(sent));
    n++;
  });
  return n ? 'Cập nhật ' + n + ' điểm Writing từ web.' : '';
}

function readDbTab_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getDisplayValues();
  const h = v[0];
  return v.slice(1).map(row => { const o = {}; h.forEach((k, i) => { o[k] = row[i]; }); return o; });
}

// ---------------------------------------------------------------------------
// GIAO BÀI TỰ ĐỘNG TỪ THƯ MỤC DRIVE
//  Mỗi dòng sheet "Giao bài" = 1 bài tập. Thư mục Drive chứa:
//   - Đề Reading/Listening (Word hoặc Google Docs; nên kèm bản PDF cho HS), file nghe mp3
//   - Teacher's Book (tên có "Teacher" hoặc "ĐÁP ÁN"): có "BẢNG ĐÁP ÁN" — KHÔNG bao giờ đăng cho HS
//   - Đề Writing (Word, có dòng "TASK 1 – Answer"/"TASK 2 – Answer"), đề Speaking
//  Hệ thống: đọc đề -> tạo Google Form điền đáp án -> lưu đáp án -> đăng bài lên Classroom.
// ---------------------------------------------------------------------------
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SKILL_NAMES = { R: 'Reading', L: 'Listening', W: 'Writing', S: 'Speaking' };

function menuCheckAssign() { runMenu_('Kiểm tra giao bài', () => processAssignRows_(true)); }
function menuAssign() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('Tạo & giao bài',
    'Tạo Google Form và đăng bài lên Classroom cho các dòng CHƯA GIAO trong sheet "Giao bài"?', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  runMenu_('Giao bài', () => processAssignRows_(false));
}

function initAssignSheet_() {
  const sh = initTable_(SH.ASSIGN, ASSIGN_HEADERS);
  ensureHeaders_(SH.ASSIGN, ASSIGN_HEADERS);
  const n = Math.min(300, sh.getMaxRows() - 1);
  const list = vals => SpreadsheetApp.newDataValidation().requireValueInList(vals, true).build();
  const classNames = readTable_(SH.COURSES, COURSE_HEADERS).rows.filter(r => r[0] === true).map(r => String(r[1])).filter(String);
  if (classNames.length) sh.getRange(2, A['Lớp'] + 1, n, 1).setDataValidation(list(classNames));
  sh.getRange(2, A['Loại bài'] + 1, n, 1).setDataValidation(list(Object.keys(ASSIGN_TYPES)));
  sh.getRange(2, A['Hạn nộp'] + 1, n, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  const pub = sh.getRange(2, A['Đăng ngay'] + 1, n, 1);
  if (!pub.getDataValidation()) pub.insertCheckboxes();
  sh.setColumnWidth(A['Link thư mục Drive'] + 1, 260).setColumnWidth(A['Trạng thái'] + 1, 260).setColumnWidth(A['Chi tiết'] + 1, 420);
  sh.getRange(1, A['Buổi'] + 1).setNote('Tên buổi, VD: L19. Tiêu đề bài trên Classroom = Buổi + loại (VD "L19 RW").');
  sh.getRange(1, A['Link thư mục Drive'] + 1).setNote('Thư mục chứa đề Word/PDF, file nghe, Teacher\'s Book (đáp án). Tên file cần có chữ Reading / Listening / Writing / Speaking.');
  sh.getRange(1, A['Đăng ngay'] + 1).setNote('Tick: đăng ngay cho HS. Bỏ tick: tạo bản nháp trên Classroom để bạn xem lại rồi tự bấm Giao.');
  sh.getRange(1, A['Trạng thái'] + 1).setNote('Xoá ô này để giao lại dòng đó (VD sau khi sửa lỗi).');
  return sh;
}

function processAssignRows_(dryRun, onlyRow) {
  initAssignSheet_();
  const t = readTable_(SH.ASSIGN, ASSIGN_HEADERS);
  const courses = {};
  readTable_(SH.COURSES, COURSE_HEADERS).rows.forEach(r => { if (r[4]) courses[String(r[1]).trim()] = String(r[4]); });
  const out = [];
  t.rows.forEach((row, i) => {
    if (timeUp_()) return;
    if (onlyRow && i + 2 !== onlyRow) return; // web portal: chỉ xử lý dòng vừa thêm
    if (!row[A['Lớp']] && !row[A['Link thư mục Drive']]) return;
    if (/^Đã giao/.test(String(row[A['Trạng thái']] || ''))) return;
    const write = (status, detail, link, cwId) => t.sh.getRange(i + 2, A['Trạng thái'] + 1, 1, 4)
      .setValues([[status, link || '', String(detail || '').slice(0, 5000), cwId || '']]);
    const label = (row[A['Buổi']] || 'Dòng ' + (i + 2)) + ' – ' + row[A['Lớp']];
    try {
      const plan = buildAssignPlan_(row, courses);
      if (dryRun) {
        write('Kiểm tra OK — chưa giao', plan.summary);
        out.push('✔ ' + label + ': ' + plan.summary);
        return;
      }
      const res = createAssignment_(plan);
      write(plan.publish ? 'Đã giao' : 'Đã giao (bản nháp — vào Classroom bấm Giao)', plan.summary, res.link, res.courseWorkId);
      out.push('✔ ' + label + ': đã giao');
    } catch (e) {
      write('Lỗi: ' + e.message, '');
      out.push('✘ ' + label + ': ' + e.message);
      if (!(e instanceof PermanentError)) log_('Lỗi giao bài ' + label, e.stack || e.message);
    }
  });
  return out.length ? out.join('\n') : 'Không có dòng nào cần xử lý trong sheet "Giao bài".';
}

// ---- Lập kế hoạch: đọc thư mục, phân tích đề, kiểm tra đáp án (chưa tạo gì) --------
function buildAssignPlan_(row, courses) {
  const className = String(row[A['Lớp']] || '').trim();
  const courseId = courses[className];
  if (!courseId) throw new PermanentError('Không thấy lớp "' + className + '" trong sheet Lớp học');
  const session = String(row[A['Buổi']] || '').trim();
  if (!session) throw new PermanentError('Thiếu tên buổi (VD: L19)');
  const type = String(row[A['Loại bài']] || '').trim();
  const skills = ASSIGN_TYPES[type];
  if (!skills) throw new PermanentError('Chọn "Loại bài" trong danh sách');
  const folderId = driveIdFromUrl_(row[A['Link thư mục Drive']]);
  if (!folderId) throw new PermanentError('Thiếu link thư mục Drive');
  let folder;
  try { folder = DriveApp.getFolderById(folderId); } catch (e) { throw new PermanentError('Không mở được thư mục Drive (link sai hoặc không có quyền)'); }
  const due = row[A['Hạn nộp']] instanceof Date ? row[A['Hạn nộp']] : null;
  if (due && due.getTime() < Date.now()) throw new PermanentError('Hạn nộp đã qua');

  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    const name = String(f.getName()).normalize('NFC');
    if (/^_/.test(name)) continue; // file hệ thống tự tạo
    const mime = f.getMimeType();
    if (mime === MimeType.GOOGLE_FORMS) continue; // Form tạo từ lần trước
    files.push({ file: f, name, mime, skill: fileSkill_(name, mime), teacher: isTeacherFile_(name) });
  }
  if (!files.length) throw new PermanentError('Thư mục trống');

  const plan = {
    className, courseId, session, type, skills, folder, due,
    publish: row[A['Đăng ngay']] === true,
    note: String(row[A['Ghi chú thêm cho HS']] || '').trim(),
    rl: [], writing: null, speakingPrompt: '', components: [], attach: [], warnings: [], summaryParts: [],
  };
  const rlSkills = skills.filter(k => k === 'R' || k === 'L');
  // Teacher's Book không ghi kỹ năng trong tên (VD "teacher.docx"): đọc tiêu đề trong file
  files.filter(x => x.teacher && !x.skill && isDocLike_(x.mime)).forEach(x => {
    try { x.skill = skillFromText_(readDocx_(x.file).paras.slice(0, 25).join('\n')); } catch (e) { /* đọc lỗi: để trống */ }
  });
  // Vẫn không rõ: gán cho kỹ năng R/L duy nhất của bài
  files.filter(x => x.teacher && !x.skill).forEach(x => { if (rlSkills.length === 1) x.skill = rlSkills[0]; });

  skills.forEach(k => {
    if (k === 'R' || k === 'L') planRL_(plan, k, files);
    else if (k === 'W') planWriting_(plan, files);
    else planSpeaking_(plan, files);
  });
  // File chung không ghi kỹ năng (hướng dẫn, ảnh…) -> đính kèm xem
  files.filter(x => !x.skill && !x.teacher).forEach(x => plan.attach.push({ id: x.file.getId(), name: x.name, mode: 'VIEW' }));
  files.filter(x => x.skill && skills.indexOf(x.skill) < 0 && !x.teacher)
    .forEach(x => plan.warnings.push('Bỏ qua "' + x.name + '" (không thuộc loại bài ' + type + ')'));
  if (plan.attach.length > 18) throw new PermanentError('Quá nhiều file đính kèm (' + plan.attach.length + ', Classroom tối đa 20)');

  plan.summary = plan.summaryParts.join(' | ') + (plan.warnings.length ? ' | Lưu ý: ' + plan.warnings.join('; ') : '');
  return plan;
}

function planRL_(plan, k, files) {
  const name = SKILL_NAMES[k];
  const mine = files.filter(x => x.skill === k);
  const teacher = mine.filter(x => x.teacher && isDocLike_(x.mime));
  const exams = mine.filter(x => !x.teacher && isDocLike_(x.mime));
  const pdfs = mine.filter(x => !x.teacher && x.mime === MimeType.PDF);
  if (!exams.length && !teacher.length) throw new PermanentError('Thiếu file đề ' + name + ' (Word/Google Docs, tên có chữ "' + name + '")');

  // Đề: file Word của HS; nếu không có thì lấy phần "ĐỀ THI" trong Teacher's Book
  let parsed, examFrom;
  if (exams.length) { parsed = parseRLExam_(readDocx_(exams[0].file).paras); examFrom = exams[0].name; }
  const teacherParas = teacher.length ? readDocx_(teacher[0].file).paras : null;
  if (!parsed || !parsed.total) {
    if (!teacherParas) throw new PermanentError('Không đọc được số câu ' + name + ' (đề cần có dòng kiểu "Questions 1–10")');
    const st = teacherParas.findIndex(p => /ĐỀ THI|QUESTION PAPER/i.test(p));
    parsed = parseRLExam_(teacherParas.slice(Math.max(0, st)));
    examFrom = teacher[0].name;
  }
  if (!parsed.total) throw new PermanentError('Không đọc được số câu ' + name + ' (đề cần có dòng kiểu "Questions 1–10")');

  // Đáp án: "BẢNG ĐÁP ÁN" trong Teacher's Book, hoặc phần "ĐÁP ÁN" cuối file đề
  let key = teacherParas ? parseKeyTable_(teacherParas) : {};
  if (!Object.keys(key).length) key = parsed.key;
  if (!Object.keys(key).length) {
    throw new PermanentError('Chưa có đáp án ' + name + ': thêm Teacher\'s Book (có "BẢNG ĐÁP ÁN") hoặc file "' + name + ' - ĐÁP ÁN" vào thư mục');
  }
  const missing = [], extra = [];
  for (let q = 1; q <= parsed.total; q++) if (!key[q]) missing.push(q);
  Object.keys(key).forEach(q => { if (Number(q) > parsed.total) extra.push(q); });
  if (missing.length) throw new PermanentError(name + ': đề có ' + parsed.total + ' câu nhưng thiếu đáp án câu ' + missing.join(', '));
  if (extra.length) throw new PermanentError(name + ': có đáp án câu ' + extra.join(', ') + ' nhưng đề chỉ có ' + parsed.total + ' câu');
  if (parsed.declared && parsed.declared !== parsed.total) plan.warnings.push(name + ': đề ghi ' + parsed.declared + ' câu nhưng đọc được ' + parsed.total);
  // Đáp án dạng chọn phải nằm trong các lựa chọn của Form
  parsed.questions.forEach(q => {
    if (q.type !== 'choice') return;
    const ok = String(key[q.n]).split('|').some(a => q.options.some(o => matchAnswer_(a, o)));
    if (!ok) plan.warnings.push(name + ' câu ' + q.n + ': đáp án "' + key[q.n] + '" không có trong lựa chọn ' + q.options.join('/'));
  });

  // Tài liệu cho HS: ưu tiên PDF; đề Word chỉ đính kèm khi không có PDF và không chứa đáp án
  if (pdfs.length) pdfs.forEach(x => plan.attach.push({ id: x.file.getId(), name: x.name, mode: 'VIEW' }));
  else if (exams.length) {
    if (parsed.hasKey) throw new PermanentError('File đề ' + name + ' có phần ĐÁP ÁN — tách đáp án ra file riêng hoặc thêm bản PDF đề cho HS');
    exams.forEach(x => plan.attach.push({ id: x.file.getId(), name: x.name, mode: 'VIEW', toPdf: true }));
    plan.summaryParts.push(name + ': sẽ tự tạo bản PDF đề cho HS từ "' + exams[0].name + '"');
  } else throw new PermanentError('Thiếu file đề ' + name + ' cho HS (Word hoặc PDF, không phải Teacher\'s Book)');
  mine.filter(x => !x.teacher && !isDocLike_(x.mime) && x.mime !== MimeType.PDF)
    .forEach(x => plan.attach.push({ id: x.file.getId(), name: x.name, mode: 'VIEW' })); // audio, ảnh…
  if (k === 'L' && !mine.some(x => /^audio\/|^video\//.test(x.mime))) plan.warnings.push('Listening: chưa có file nghe (mp3) trong thư mục');

  // Giải thích từng câu + thang đánh giá trong Teacher's Book (để gửi kết quả cho HS sau hạn nộp)
  const info = teacherParas ? parseExplanations_(teacherParas) : {};
  const scale = teacherParas ? parseScale_(teacherParas) : [];
  const nExpl = Object.keys(info).filter(q => info[q].text && Number(q) <= parsed.total).length;
  if (teacherParas && nExpl < parsed.total) {
    plan.warnings.push(name + ': có giải thích ' + nExpl + '/' + parsed.total + ' câu' + (nExpl ? '' : ' (không thấy mục "Giải thích chi tiết")'));
  }

  plan.rl.push({ k, name, total: parsed.total, groups: parsed.groups, questions: parsed.questions, key, info, scale });
  plan.components.push(k === 'R' ? 'Reading (Academic)' : 'Listening');
  plan.summaryParts.push(name + ': ' + parsed.total + ' câu, đủ đáp án (' +
    parsed.groups.map(g => g.a + '–' + g.b + ' ' + g.label).join('; ') + ')' +
    (nExpl ? ', giải thích ' + nExpl + '/' + parsed.total + ' câu' : '') +
    (scale.length ? ', thang đánh giá ' + scale.map(x => x[2]).join('/') : '') + ' — đề đọc từ "' + examFrom + '"');
}

function planWriting_(plan, files) {
  const mine = files.filter(x => x.skill === 'W' && !x.teacher);
  const docs = mine.filter(x => isDocLike_(x.mime));
  if (!docs.length) throw new PermanentError('Thiếu file Word đề Writing (tên có chữ "Writing")');
  const doc = readDocx_(docs[0].file);
  const w = parseWriting_(doc.paras);
  if (!w.hasMarkers) throw new PermanentError('File Writing cần có dòng "TASK 1 – Answer" / "TASK 2 – Answer" để HS viết bài bên dưới');
  const data = { task1Prompt: '', task2Prompt: '', task1ImageId: '' };
  const types = [];
  if (w.has1) {
    if (w.task1Prompt.length < 10) throw new PermanentError('Không đọc được đề Writing Task 1 (cần dòng "WRITING TASK 1" trước đề)');
    data.task1Prompt = w.task1Prompt;
    const img = doc.media.filter(b => b.getBytes().length <= 5 * 1024 * 1024)[0];
    if (img) {
      const ext = /png$/i.test(img.getName()) ? 'png' : 'jpg';
      img.setContentType(ext === 'png' ? 'image/png' : 'image/jpeg').setName('_' + plan.session + ' Task 1 chart.' + ext);
      data.task1ImageId = assetsFolder_(plan.folder).createFile(img).getId();
    } else plan.warnings.push('Writing Task 1: không thấy ảnh biểu đồ trong file Word');
    types.push(writingTypeLabel_('task1_academic', detectWritingType_('task1_academic', w.task1Prompt)));
    plan.components.push('Writing Task 1');
  }
  if (w.has2) {
    if (w.task2Prompt.length < 10) throw new PermanentError('Không đọc được đề Writing Task 2 (cần dòng "WRITING TASK 2" trước đề)');
    data.task2Prompt = w.task2Prompt;
    types.push(writingTypeLabel_('task2', detectWritingType_('task2', w.task2Prompt)));
    plan.components.push('Writing Task 2');
  }
  plan.writing = data;
  plan.writingTypes = types.join('; ');
  plan.writingFile = docs[0].name;
  plan.attach.push({ id: docs[0].file.getId(), name: docs[0].name, mode: 'STUDENT_COPY' });
  mine.filter(x => x !== docs[0]).forEach(x => plan.attach.push({ id: x.file.getId(), name: x.name, mode: 'VIEW' }));
  plan.summaryParts.push('Writing: ' + [w.has1 ? 'Task 1' + (data.task1ImageId ? ' (có ảnh)' : '') : '', w.has2 ? 'Task 2' : ''].filter(String).join(' + ') +
    ' — dạng: ' + plan.writingTypes + ' — mỗi HS 1 bản file Word riêng');
}

function planSpeaking_(plan, files) {
  const mine = files.filter(x => x.skill === 'S' && !x.teacher);
  const doc = mine.filter(x => isDocLike_(x.mime))[0];
  if (doc) plan.speakingPrompt = readDocx_(doc.file).paras.join('\n').slice(0, 6000);
  if (!plan.speakingPrompt) plan.warnings.push('Speaking: không có file Word đề — AI sẽ tự suy ra câu hỏi từ bài ghi âm');
  mine.forEach(x => plan.attach.push({ id: x.file.getId(), name: x.name, mode: 'VIEW' }));
  plan.components.push('Speaking');
  plan.summaryParts.push('Speaking: chấm từ file ghi âm' + (doc ? ' — đề: "' + doc.name + '"' : ''));
}

// ---- Tạo thật: Form, đáp án, bài tập Classroom ---------------------------------
function createAssignment_(plan) {
  const created = [];
  try {
    const keys = {}, forms = {}, scales = {}, info = {};
    const links = [];
    plan.rl.forEach(item => {
      const f = createRLForm_(plan, item);
      created.push(f.id);
      const code = plan.className + '|' + plan.session + '|' + item.k;
      const pairs = item.groups.filter(g => g.pair).map(g => g.a + '-' + g.b);
      saveAnswerKey_(code, item.key, 'Giao bài ' + plan.session + (pairs.length ? ' | Cặp: ' + pairs.join(',') : ''), item.info);
      keys[item.k] = code;
      if (item.scale && item.scale.length) scales[item.k] = item.scale;
      info[item.k] = 'ok';
      forms[item.k] = f.editUrl;
      links.push({ link: { url: f.publishedUrl, title: f.title } });
    });

    // Đề Word không có bản PDF: tự chuyển sang PDF (lỗi thì đính kèm file Word như cũ)
    plan.attach.forEach(a => {
      if (!a.toPdf) return;
      try { const pdf = docToPdf_(DriveApp.getFileById(a.id), assetsFolder_(plan.folder)); created.push(pdf.getId()); a.id = pdf.getId(); }
      catch (e) { console.warn('Không tạo được PDF từ ' + a.name + ': ' + e); }
    });

    const short = { 'Reading + Writing': 'RW', 'Listening + Speaking': 'LS' }[plan.type] || plan.type;
    const body = {
      title: plan.session + ' ' + short,
      description: assignDescription_(plan),
      workType: 'ASSIGNMENT',
      state: plan.publish ? 'PUBLISHED' : 'DRAFT',
      materials: plan.attach.map(a => ({ driveFile: { driveFile: { id: a.id }, shareMode: a.mode } })).concat(links),
    };
    if (plan.due) {
      body.dueDate = { year: plan.due.getUTCFullYear(), month: plan.due.getUTCMonth() + 1, day: plan.due.getUTCDate() };
      body.dueTime = { hours: plan.due.getUTCHours(), minutes: plan.due.getUTCMinutes() };
    }
    const cw = Classroom.Courses.CourseWork.create(body, plan.courseId);

    // Ghi bài vào sheet "Bài tập" kèm dữ liệu chấm
    const comps = plan.components;
    const skillLabel = plan.type === 'Reading' ? 'Reading (Academic)' : plan.type === 'Writing'
      ? (comps.length > 1 ? 'Writing Task 1 + 2' : comps[0]) : plan.type;
    const data = { components: comps, keys, forms, scales, info, writing: plan.writing, speakingPrompt: plan.speakingPrompt, session: plan.session };
    const row = new Array(CW_HEADERS.length).fill('');
    row[C['Lớp']] = plan.className;
    row[C['Tiêu đề']] = cw.title;
    row[C['Kỹ năng']] = skillLabel;
    row[C['Chấm tự động']] = true;
    row[C['Hạn nộp']] = plan.due || '';
    row[C['Link']] = cw.alternateLink || '';
    row[C['Course ID']] = plan.courseId;
    row[C['CourseWork ID']] = cw.id;
    row[C['Tạo lúc']] = new Date();
    row[C['Dạng bài Writing']] = plan.writingTypes || '';
    row[C['Chủ đề Writing']] = comps.indexOf('Writing Task 2') >= 0 ? 'Other' : '';
    row[C['Đề bài cho AI']] = [plan.writing && plan.writing.task1Prompt, plan.writing && plan.writing.task2Prompt, plan.speakingPrompt]
      .filter(Boolean).join('\n\n').slice(0, 4000);
    row[C['Dữ liệu bài (JSON)']] = JSON.stringify(data);
    ensureHeaders_(SH.CW, CW_HEADERS);
    const sh = sheet_(SH.CW);
    const at = sh.getLastRow() + 1;
    sh.getRange(at, 1, 1, CW_HEADERS.length).setValues([row]);
    sh.getRange(at, C['Chấm tự động'] + 1).insertCheckboxes().setValue(true);
    return { link: cw.alternateLink || '', courseWorkId: cw.id };
  } catch (e) {
    created.forEach(id => { try { DriveApp.getFileById(id).setTrashed(true); } catch (x) { /* bỏ qua */ } });
    throw e;
  }
}

function createRLForm_(plan, item) {
  const title = plan.session + ' ' + item.name + ' – ' + plan.className;
  const form = FormApp.create(title);
  form.setDescription('Điền đáp án cho từng câu (không phân biệt chữ hoa/thường). ' +
    'Đăng nhập đúng tài khoản Google đang dùng trên Classroom. Có thể sửa câu trả lời trước hạn nộp.');
  try { form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED); } catch (e) { form.setCollectEmail(true); }
  try { form.setLimitOneResponsePerUser(true); } catch (e) { /* tài khoản không hỗ trợ */ }
  form.setAllowResponseEdits(true);
  form.setShowLinkToRespondAgain(false);
  form.setConfirmationMessage('Đã nhận đáp án! Nhớ quay lại Google Classroom bấm "Nộp bài" khi làm xong tất cả các phần.');
  let lastGroup = null;
  item.questions.forEach(q => {
    const g = item.groups.filter(x => q.n >= x.a && q.n <= x.b)[0];
    if (g && g !== lastGroup) {
      form.addSectionHeaderItem().setTitle('Questions ' + g.a + '–' + g.b)
        .setHelpText(g.pair ? g.label + ': mỗi câu chọn 1 chữ, 2 câu không chọn trùng nhau. Đúng chữ là được điểm, không cần đúng thứ tự.' : g.label);
      lastGroup = g;
    }
    const t = 'Câu ' + q.n;
    if (q.type === 'choice' && q.options.length <= 4) form.addMultipleChoiceItem().setTitle(t).setChoiceValues(q.options);
    else if (q.type === 'choice') form.addListItem().setTitle(t).setChoiceValues(q.options);
    else form.addTextItem().setTitle(t);
  });
  try { if (typeof form.setPublished === 'function') form.setPublished(true); } catch (e) { /* bản Forms cũ */ }
  DriveApp.getFileById(form.getId()).moveTo(assetsFolder_(plan.folder));
  return { id: form.getId(), editUrl: form.getEditUrl(), publishedUrl: form.getPublishedUrl(), title };
}

function assignDescription_(plan) {
  const tz = Session.getScriptTimeZone();
  const lines = [];
  if (plan.due) lines.push('Hạn nộp: ' + Utilities.formatDate(plan.due, tz, 'HH:mm dd/MM/yyyy'), '');
  let n = 0;
  plan.skills.forEach(k => {
    n++;
    if (k === 'R' || k === 'L') {
      const item = plan.rl.filter(x => x.k === k)[0];
      lines.push(n + '. ' + item.name.toUpperCase() + ' (' + item.total + ' câu)');
      lines.push(k === 'L' ? '- Nghe file audio đính kèm (nên nghe 1 lần như thi thật), làm bài trên đề.' : '- Đọc đề trong file đính kèm và làm bài.');
      lines.push('- Điền đáp án vào Google Form "' + plan.session + ' ' + item.name + ' – ' + plan.className + '" (link đính kèm bên dưới).');
    } else if (k === 'W') {
      lines.push(n + '. WRITING');
      lines.push('- Mở file "' + plan.writingFile + '" (mỗi bạn có 1 bản riêng, có tên của em) và viết bài NGAY TRONG FILE ĐÓ. Không tạo file mới, không nộp file khác.');
      lines.push('- Viết bài NGAY DƯỚI dòng ' + plan.components.filter(c => /^Writing/.test(c)).map(c => '"TASK ' + c.slice(-1) + ' – Answer"').join(' và ') + '. KHÔNG xoá các dòng tiêu đề này.');
    } else {
      lines.push(n + '. SPEAKING');
      lines.push('- Ghi âm câu trả lời bằng app ghi âm của điện thoại, lưu dạng mp3 hoặc m4a (tối đa khoảng 10 phút). Chỉ ghi âm, không quay video.');
      lines.push('- Bấm "Thêm" > "Tệp" để ĐÍNH KÈM file ghi âm vào bài tập này. Không dán link Google Drive. Tên file đặt thế nào cũng được.');
    }
    lines.push('');
  });
  lines.push('Làm xong tất cả các phần thì bấm "NỘP BÀI" (Turn in).');
  if (plan.note) lines.push('', plan.note);
  return lines.join('\n');
}

function saveAnswerKey_(code, key, note, info) {
  ensureHeaders_(SH.KEY, KEY_HEADERS);
  const sh = sheet_(SH.KEY);
  sh.getRange('C:C').setNumberFormat('@'); // giữ nguyên đáp án dạng chữ (VD 7.15, 1/2)
  const vals = sh.getDataRange().getValues();
  for (let i = vals.length - 1; i >= 1; i--) if (String(vals[i][0]) === code) sh.deleteRow(i + 1);
  const rows = Object.keys(key).sort((a, b) => Number(a) - Number(b))
    .map(q => [code, Number(q), String(key[q]), note || ''].concat(infoCells_(info && info[q])));
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, KEY_HEADERS.length).setValues(rows);
}

/** 5 cột "Giải thích … Lỗi dự kiến" của sheet Đáp án. */
function infoCells_(x) {
  if (!x) return ['', '', '', '', ''];
  const num = v => { const n = Number(String(v || '').replace(',', '.')); return v === '' || v === undefined || isNaN(n) ? '' : n; };
  return [x.text || '', x.level || '', num(x.p), num(x.d), x.err || ''];
}

/** Đọc phần giải thích trong sheet Đáp án: { mã: { câu: {text, level, p, d, err} } }. */
function loadKeyInfo_() {
  const sh = sheet_(SH.KEY);
  const last = sh.getLastRow();
  const out = {};
  if (last < 2 || sh.getLastColumn() < 5) return out;
  sh.getRange(2, 1, last - 1, KEY_HEADERS.length).getValues().forEach(r => {
    const code = String(r[0]).trim(), q = String(r[1]).trim();
    if (!code || !q) return;
    (out[code] = out[code] || {})[q] = { text: String(r[4] || ''), level: String(r[5] || ''), p: r[6], d: r[7], err: String(r[8] || '') };
  });
  return out;
}

/** Thư mục con "_IELTS Checker" trong thư mục bài: chứa Form, ảnh biểu đồ (không đăng cho HS). */
function assetsFolder_(folder) {
  const it = folder.getFoldersByName('_IELTS Checker');
  return it.hasNext() ? it.next() : folder.createFolder('_IELTS Checker');
}

function driveIdFromUrl_(s) {
  const v = String(s || '').trim();
  const m = v.match(/\/folders\/([\w-]{10,})/) || v.match(/[?&]id=([\w-]{10,})/) || v.match(/^([\w-]{20,})$/);
  return m ? m[1] : '';
}

/** Word/Google Docs -> file PDF trong thư mục đích (bản Google Docs tạm được xoá ngay). */
function docToPdf_(file, folder) {
  const pdfName = String(file.getName()).replace(/\.docx?$/i, '') + '.pdf';
  if (file.getMimeType() === MimeType.GOOGLE_DOCS) return folder.createFile(file.getAs(MimeType.PDF).setName(pdfName));
  const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + file.getId() + '/copy?fields=id', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ name: '_tmp ' + file.getName(), mimeType: MimeType.GOOGLE_DOCS, parents: [folder.getId()] }),
  });
  if (res.getResponseCode() !== 200) throw new Error('Drive copy ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  const tmp = DriveApp.getFileById(JSON.parse(res.getContentText()).id);
  try { return folder.createFile(tmp.getAs(MimeType.PDF).setName(pdfName)); }
  finally { tmp.setTrashed(true); }
}

function isDocLike_(mime) { return mime === DOCX_MIME || mime === MimeType.GOOGLE_DOCS; }

function fileSkill_(name, mime) {
  const n = String(name).toLowerCase();
  if (/reading|\bđọc\b/.test(n)) return 'R';
  if (/listening|\bnghe\b/.test(n)) return 'L';
  if (/writing|\bviết\b/.test(n)) return 'W';
  if (/speaking|\bnói\b/.test(n)) return 'S';
  if (/^audio\//.test(mime || '')) return 'L';
  return '';
}

/** Kỹ năng ghi ở tiêu đề Teacher's Book: "IELTS LISTENING – …" -> 'L' */
function skillFromText_(text) {
  const t = String(text);
  const m = t.match(/IELTS\s+(READING|LISTENING|WRITING|SPEAKING)\b/i) || t.match(/\b(READING|LISTENING|WRITING|SPEAKING)\b/);
  return m ? { READING: 'R', LISTENING: 'L', WRITING: 'W', SPEAKING: 'S' }[m[1].toUpperCase()] : '';
}

function isTeacherFile_(name) {
  return /teacher|đáp án|dap an|answer[\s_-]*key|transcript|giáo viên|giao vien/i.test(String(name).normalize('NFC'));
}

function countWords_(s) { return String(s || '').trim().split(/\s+/).filter(String).length; }

// ---- Đọc file Word (.docx) và Google Docs --------------------------------------
function readDocx_(fileOrId) {
  const f = typeof fileOrId === 'string' ? DriveApp.getFileById(fileOrId) : fileOrId;
  if (f.getMimeType() === MimeType.GOOGLE_DOCS) {
    // Google Docs (VD HS mở file Word bằng Docs rồi lưu): đọc trực tiếp từng đoạn
    const body = DocumentApp.openById(f.getId()).getBody();
    const paras = body.getParagraphs().map(p => String(p.getText()).replace(/[  ]+/g, ' ').trim()).filter(String);
    let media = [];
    try { media = body.getImages().map(im => im.getBlob()); } catch (e) { /* không có ảnh */ }
    return { paras, media };
  }
  const blob = f.getBlob();
  let entries;
  try { entries = Utilities.unzip(blob.setContentType('application/zip')); }
  catch (e) { throw new PermanentError('"' + f.getName() + '" không phải file .docx hợp lệ (file .doc cũ: mở Word và lưu lại thành .docx)'); }
  const docXml = entries.filter(b => /document\.xml$/.test(b.getName()) && !/glossary/i.test(b.getName()))[0];
  if (!docXml) throw new PermanentError('"' + f.getName() + '" không có nội dung Word đọc được');
  return {
    paras: docxXmlToParagraphs_(docXml.getDataAsString('UTF-8')),
    media: entries.filter(b => /\.(png|jpe?g)$/i.test(b.getName()) && !/thumbnail/i.test(b.getName())),
  };
}

/** XML của Word -> danh sách đoạn văn (giữ dấu tab, xuống dòng). */
function docxXmlToParagraphs_(xml) {
  const body = String(xml).replace(/^[\s\S]*?<w:body>/, '');
  return body.split(/<\/w:p>/).map(p => p
    .replace(/<w:tab\/>/g, '\u0001\t\u0002').replace(/<w:br[^>]*\/>/g, '\u0001\n\u0002')
    .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, '\u0001$1\u0002')
    .replace(/[^\u0001\u0002]*?(?:\u0001([^\u0002]*)\u0002|$)/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[  ]+/g, ' ').trim()).filter(String);
}

// ---- Phân tích đề Reading / Listening ------------------------------------------
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv'];

function parseRLExam_(paras) {
  const keyIdx = paras.findIndex(p => /^\s*(ĐÁP ÁN|DAP AN|ANSWER KEY)\s*:?\s*$/i.test(p));
  const exam = keyIdx >= 0 ? paras.slice(0, keyIdx) : paras;
  const ranges = [];
  exam.forEach((p, i) => {
    const re = /Questions?\s+(\d{1,2})\s*(?:[–—-]|and|to)\s*(\d{1,2})/gi;
    let m;
    while ((m = re.exec(p))) {
      const a = Number(m[1]), b = Number(m[2]);
      if (b < a || b - a > 40) continue;
      ranges.push({ a, b, i, heading: /^\s*(SECTION\s+\d+\s+)?Questions?\s+\d/i.test(p) });
    }
  });
  const declared = Number((exam.join('\n').match(/There are (\d{1,2}) questions/i) || [])[1]) || null;
  const maxQ = ranges.reduce((m, r) => Math.max(m, r.b), 0);
  const groups = [];
  ranges.filter(r => r.heading).sort((x, y) => (x.b - x.a) - (y.b - y.a)).forEach(r => {
    if (groups.some(g => !(r.b < g.a || r.a > g.b))) return; // giữ nhóm nhỏ nhất
    const t = detectQType_(exam.slice(r.i, r.i + 6).join(' '));
    // "Questions 1 and 2 – Choose TWO letters": 2 câu là 1 cặp, đáp án theo thứ tự bất kỳ
    const pair = t.pick && r.b - r.a + 1 === t.pick;
    groups.push({ a: r.a, b: r.b, type: pair || !t.pick ? t.type : 'text', label: pair || !t.pick ? t.label : 'Chọn nhiều chữ cái (VD: B,D)',
      options: pair || !t.pick ? t.options : [], pair });
  });
  groups.sort((x, y) => x.a - y.a);
  const total = maxQ;
  const questions = [];
  for (let q = 1; q <= total; q++) {
    const g = groups.filter(x => q >= x.a && q <= x.b)[0];
    questions.push({ n: q, type: g ? g.type : 'text', options: g ? g.options : [] });
  }
  const key = {};
  if (keyIdx >= 0) {
    paras.slice(keyIdx + 1).forEach(p => p.split(/\t|\n/).forEach(seg => {
      const m = seg.match(/^\s*(\d{1,2})\s*[.):-]?\s+(.+?)\s*$/);
      if (m) key[m[1]] = normalizeKeyText_(m[2]);
    }));
  }
  return { total, declared, groups, questions, key, hasKey: keyIdx >= 0 };
}

function letterRange_(a, b) {
  const out = [];
  for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) out.push(String.fromCharCode(c));
  return out;
}

function detectQType_(text) {
  const s = String(text);
  if (/TRUE.*FALSE.*NOT\s*GIVEN/.test(s)) return { type: 'choice', label: 'TRUE/FALSE/NOT GIVEN', options: ['TRUE', 'FALSE', 'NOT GIVEN'] };
  if (/YES.*\bNO.*NOT\s*GIVEN/.test(s)) return { type: 'choice', label: 'YES/NO/NOT GIVEN', options: ['YES', 'NO', 'NOT GIVEN'] };
  let m = s.match(/\b(i)\s*[–—-]\s*(x{0,1}i{0,3}v?i{0,3}x?)\b/);
  if (/heading/i.test(s) && m && ROMAN.indexOf(m[2]) > 0) {
    return { type: 'choice', label: 'Headings i–' + m[2], options: ROMAN.slice(0, ROMAN.indexOf(m[2]) + 1) };
  }
  const multi = s.match(/\b(TWO|THREE)\s+letters?/i);
  if (multi) {
    const pick = /three/i.test(multi[1]) ? 3 : 2;
    const r = s.match(/\b(A)\s*[–—-]\s*([C-L])\b/);
    if (r) return { type: 'choice', pick, label: 'Chọn ' + pick + ' chữ cái A–' + r[2] + ' (thứ tự bất kỳ)', options: letterRange_('A', r[2]) };
    return { type: 'text', pick, label: 'Chọn ' + pick + ' chữ cái (VD: B,D)', options: [] };
  }
  m = s.match(/\b(A)\s*[–—-]\s*([B-L])\b/);
  if (m) return { type: 'choice', label: 'Chọn chữ A–' + m[2], options: letterRange_('A', m[2]) };
  m = s.match(/\bA,\s*B(?:,\s*C)?(?:,\s*D)?(?:,\s*E)?\s*or\s*([C-G])\b/);
  if (m) return { type: 'choice', label: 'Chọn A–' + m[1], options: letterRange_('A', m[1]) };
  const w = s.match(/((NO MORE THAN\s+)?(ONE|TWO|THREE)\s+WORDS?(\s+AND\/OR\s+A\s+NUMBER)?)/i);
  return { type: 'text', label: w ? 'Điền ' + w[1] : 'Điền đáp án', options: [] };
}

/**
 * Đọc "BẢNG ĐÁP ÁN" trong Teacher's Book. Hỗ trợ:
 *  - bảng 2 cột Câu | Đáp án (có thể 2 cặp cột song song)
 *  - bảng nhiều cột Câu | Đáp án | Chấp nhận | Mức độ | Bẫy… (đọc theo hàng; cột "Chấp nhận" thành đáp án thay thế)
 *  - dòng "1. answer" / "1 answer"
 */
function parseKeyTable_(paras) {
  const P = paras.map(x => String(x).trim());
  const start = P.findIndex(p => /^(\d+(\.\d+)*\.?\s*)?(BẢNG ĐÁP ÁN|ĐÁP ÁN|ANSWER KEY)\s*:?\s*$/i.test(p));
  if (start < 0) return {};
  const END = /^(\d+(\.\d+)*\.?\s+[A-ZĐÀ-Ỹ]|Chấm|Quy tắc|Lưu ý|Ghi chú\s*:|Thống kê)/;
  const isNum = p => /^\d{1,2}$/.test(p);
  const isHdr = p => p.length <= 30 && !/\d/.test(p) && !/[.:;!?]$/.test(p);
  // Tiêu đề bảng: các ô ngắn ngay sau (hoặc chứa) dòng "Đáp án"
  let i = start + 1;
  // Bỏ qua đoạn hướng dẫn ngay dưới tiêu đề (VD trong file mẫu Teacher's Book)
  for (let k = 0; k < 3 && i < P.length && P[i].length > 30 && !/^\d{1,2}\s/.test(P[i]); k++) i++;
  const hdr = [];
  if (/^(Đáp án|Answer)s?$/i.test(P[start]) && /^(Câu|Question|Q|No\.?)$/i.test(P[start - 1] || '')) hdr.push(P[start - 1], P[start]);
  while (i < P.length && !isNum(P[i]) && isHdr(P[i]) && hdr.length < 10) hdr.push(P[i++]);
  const ansCol = hdr.findIndex(h => /^(Đáp án|Answer)s?$/i.test(h));
  const accCol = hdr.findIndex(h => /^(Chấp nhận|Accept(ed)?|Also accept|Đáp án khác)/i.test(h));
  const multi = ansCol >= 0 && hdr.filter(h => /^(Câu|Question|Q|Đáp án|Answers?)$/i.test(h)).length === 2 && hdr.length > 2;
  const key = {};

  if (multi) {
    // Bảng nhiều cột: mỗi hàng bắt đầu bằng ô số câu; chỉ đọc ô Đáp án (+ ô Chấp nhận ngay sau)
    let last = 0;
    for (; i < P.length; i++) {
      const p = P[i];
      if (END.test(p) && !isNum(p)) break;
      if (!isNum(p)) continue;
      const n = Number(p);
      if (n <= last || (last && n > last + 15) || n > 80 || key[n]) continue;
      const ans = P[i + 1];
      if (!ans || (isNum(ans) && Number(ans) === n + 1)) continue; // ô đáp án trống (đáp án dạng số như "70" vẫn nhận)
      let alts = normalizeKeyText_(ans).split('|');
      if (accCol === ansCol + 1 && P[i + 2] && !isNum(P[i + 2])) alts = alts.concat(acceptCell_(P[i + 2]));
      key[n] = alts.filter((x, j) => x && alts.indexOf(x) === j).join('|');
      last = n;
      i += 1;
    }
    return key;
  }

  let pending = null;
  for (; i < P.length; i++) {
    const p = P[i];
    if (!isNum(p) && END.test(p)) break; // hết bảng
    if (/^(Câu|Đáp án|Question|Answer)s?$/i.test(p)) continue;
    if (isNum(p) && pending === null) { pending = p; continue; }
    if (pending !== null) { key[pending] = normalizeKeyText_(p); pending = null; continue; }
    p.split(/\t|\n/).forEach(seg => {
      const m = seg.match(/^\s*(\d{1,2})\s*[.):-]?\s+([^\/\s].*?)\s*$/);
      if (m) key[m[1]] = normalizeKeyText_(m[2]);
    });
  }
  return key;
}

/** Ô "Chấp nhận": "70 / seventy (hoặc 70°C)" -> [70, seventy, 70°C]; "supermarkets (phải có “s”)" -> [supermarkets] */
function acceptCell_(s) {
  let t = String(s).trim();
  const extra = [];
  t = t.replace(/\(([^)]*)\)/g, (all, inner) => {
    const m = inner.match(/^\s*(?:hoặc|or|also|chấp nhận|accept(?:ed)?)\s*:?\s*(.+)$/i);
    if (m) extra.push.apply(extra, m[1].split(/\s*\/\s*|\s*;\s*|\s+(?:hoặc|or)\s+/i));
    return ' ';
  });
  return t.split(/\s*\/\s*|\s*;\s*|\s+(?:hoặc|or)\s+/i).concat(extra)
    .map(x => x.replace(/[“”"]/g, '').trim()).filter(x => x && x.length <= 60 && !/^(không|phải|cả hai|both)/i.test(x));
}

/** "Hartley (chấp nhận: HARTLEY)" -> "Hartley|HARTLEY"; "two hours / 2 hours" -> "two hours|2 hours" */
function normalizeKeyText_(s) {
  let main = String(s).trim(), extra = [];
  const m = main.match(/^(.*?)\s*\((?:chấp nhận|accept(?:ed)?|also)\s*:?\s*([^)]*)\)\s*$/i);
  if (m) { main = m[1]; extra = m[2].split(/\s+\/\s+|\s*;\s*|\s*\|\s*/); }
  const alts = main.split(/\s+\/\s+|\s*\|\s*/).concat(extra).map(x => x.trim()).filter(String);
  return alts.filter((x, i) => alts.indexOf(x) === i).join('|');
}

/**
 * Đọc mục "Giải thích chi tiết" của Teacher's Book. Hỗ trợ 2 kiểu:
 *  - Bảng theo 4 bước: "Câu 1 → D | Mức độ: Dễ • p ≈ 0.70 • D ≈ 0.30 • Lỗi dự kiến: …" rồi các dòng
 *    "Câu hỏi" / "B2 – Keywords" / "B3 – Vị trí" / "Paraphrase" / "B4 – Chốt đáp án" / "Bẫy / lỗi hay gặp"
 *  - Dạng đoạn: "Câu 1. <câu hỏi>" rồi "Đáp án: … | Vị trí: …", "Dẫn chứng: …", "Script: …", "Giải thích: …"
 * Trả về { câu: { text, level, p, d, err } }; text là các dòng "Nhãn: nội dung" (gửi cho HS).
 */
function parseExplanations_(paras) {
  const out = {};
  const st = paras.findIndex(p => /^(\d+\.(\d+\.?)*\s*)?GIẢI THÍCH/i.test(String(p).trim()));
  if (st < 0) return out;
  const LABEL = /^(Câu hỏi|B\d\s*[–—-].{1,30}|Bước\s*\d.{0,30}|Keywords?|Paraphrase|Vị trí|Dẫn chứng|Script|Transcript|Giải thích|Chốt đáp án|Bẫy.{0,30}|Lưu ý|Mẹo)$/i;
  let cur = null, label = null, grp = null;
  // Dạng "Questions 1–2: … → C, D" + bảng từng phương án (A | nội dung | ✓/✗ | phân tích | signpost)
  const flushGroup = () => {
    if (!grp) return;
    const lines = [];
    if (grp.q) lines.push('Câu hỏi: ' + grp.q);
    lines.push('Cặp câu ' + grp.a + '–' + grp.b + ': đáp án ' + grp.ans.replace(/\s*[,&]\s*/g, ', ') + ' (thứ tự bất kỳ)');
    grp.opts.forEach(o => {
      const mi = o.cells.findIndex(c => /^[✓✔✗✘xX]$/.test(c));
      const text = (mi > 0 ? o.cells.slice(0, mi) : o.cells.slice(0, 1)).join(' ');
      const mark = mi >= 0 ? o.cells[mi].replace(/[✔]/, '✓').replace(/[✘xX]/, '✗') : '';
      const rest = mi >= 0 ? o.cells.slice(mi + 1) : o.cells.slice(1);
      lines.push(o.L + '. ' + text + (mark ? ' ' + mark : '') + (rest[0] ? ' — ' + rest[0] : '') + (rest[1] ? ' (tín hiệu: ' + rest.slice(1).join('; ') + ')' : ''));
    });
    for (let q = grp.a; q <= grp.b; q++) if (!out[q]) out[q] = { lines: lines.slice(), level: '', p: '', d: '', err: '' };
    grp = null;
  };
  const meta = (x, t) => {
    let m = t.match(/Mức độ\s*:\s*([^•|]+)/i); if (m) x.level = m[1].trim();
    m = t.match(/(?:^|[\s•|])p\s*[≈=~]\s*([\d.,]+)/); if (m) x.p = m[1];
    m = t.match(/(?:^|[\s•|])D\s*[≈=~]\s*([\d.,]+)/); if (m) x.d = m[1];
    m = t.match(/Lỗi dự kiến\s*:\s*([^•|]+)/i); if (m) x.err = m[1].trim();
  };
  for (let i = st + 1; i < paras.length; i++) {
    const p = String(paras[i]).replace(/\s+/g, ' ').trim();
    if (!p) continue;
    if (/^\d+\.(\d+\.?)*\s+\S/.test(p)) break; // mục tiếp theo của Teacher's Book (VD "4. Độ khó…")
    if (/^(READING\s+)?PASSAGE\s+\d|^SECTION\s+\d|^PART\s+\d/i.test(p)) { flushGroup(); cur = null; label = null; continue; }
    const gq = p.match(/^Questions?\s+(\d{1,2})\s*(?:[–—-]|and|to)\s*(\d{1,2})\s*[:.]?\s*(.*?)\s*(?:→|->)\s*([A-L](?:\s*[,&]\s*[A-L])+)\s*$/i);
    if (gq) { flushGroup(); grp = { a: Number(gq[1]), b: Number(gq[2]), q: gq[3], ans: gq[4], opts: [] }; cur = null; label = null; continue; }
    if (grp) {
      if (/^[A-L]$/.test(p)) grp.opts.push({ L: p, cells: [] });
      else if (!/^(Phương án|KQ|Kết quả|Phân tích|Signpost|Tín hiệu|Options?)$/i.test(p) && grp.opts.length) grp.opts[grp.opts.length - 1].cells.push(p);
      continue;
    }
    const m = p.match(/^Câu\s+(\d{1,2})\s*(→|->|\.|:|–|-)\s*(.*)$/);
    if (m) {
      cur = out[m[1]] = { lines: [], level: '', p: '', d: '', err: '' };
      label = null;
      if (m[2] === '→' || m[2] === '->') meta(cur, m[3]);
      else if (m[3]) cur.lines.push('Câu hỏi: ' + m[3]);
      continue;
    }
    if (!cur) continue;
    if (label !== null && !LABEL.test(p)) { cur.lines.push(label + ': ' + p); label = null; continue; }
    // Nhãn cột trái của bảng: ngắn, không có dấu ":" và không kết thúc bằng dấu câu
    if (LABEL.test(p) || (p.length <= 28 && p.indexOf(':') < 0 && !/[.?!”"…)]$/.test(p) && /^[A-ZĐÀ-Ỹ]/.test(p) && p.split(' ').length <= 5)) {
      label = p; continue;
    }
    meta(cur, p);
    // Bỏ phần "Đáp án: …" / "Mức độ: …" (HS đã thấy đáp án ở chỗ khác)
    const parts = p.split(/\s+\|\s+/).filter(x => !/^(Đáp án|Mức độ)\s*:/i.test(x.trim()));
    if (parts.length) cur.lines.push(parts.join(' | '));
  }
  flushGroup();
  Object.keys(out).forEach(q => { out[q].text = out[q].lines.join('\n'); delete out[q].lines; });
  // Mức độ / p / D / lỗi dự kiến từ bảng "Độ khó và độ phân hoá" (nếu phần giải thích không ghi)
  const diff = parseDifficulty_(paras);
  Object.keys(diff).forEach(q => {
    const x = out[q] = out[q] || { text: '', level: '', p: '', d: '', err: '' };
    ['level', 'p', 'd', 'err'].forEach(f => { if (!x[f] && diff[q][f]) x[f] = diff[q][f]; });
  });
  return out;
}

/** Bảng "Độ khó và độ phân hoá": Câu | Đáp án | Mức độ | p | D | Phân hoá | Lỗi dự kiến -> { câu: {level, p, d, err} } */
function parseDifficulty_(paras) {
  const P = paras.map(x => String(x).replace(/\s+/g, ' ').trim()).filter(String);
  const st = P.findIndex(p => /^(\d+\.(\d+\.?)*\s*)?Độ khó/i.test(p));
  if (st < 0) return {};
  let i = st + 1;
  while (i < P.length && !/^(Câu|Question|Q)$/i.test(P[i]) && i < st + 6) i++;
  const hdr = [];
  while (i < P.length && !/^\d{1,2}$/.test(P[i]) && P[i].length <= 30 && hdr.length < 10) hdr.push(P[i++]);
  const col = re => hdr.findIndex(h => re.test(h));
  const cP = col(/^p( dự kiến)?$/), cD = col(/^D( dự kiến)?$/), cL = col(/^Mức độ$/i), cE = col(/^Lỗi dự kiến/i);
  if (cP < 0 && cD < 0) return {};
  const out = {};
  let last = 0;
  while (i < P.length) {
    if (!/^\d{1,2}$/.test(P[i]) || Number(P[i]) !== last + 1) break;
    const n = last = Number(P[i++]);
    const cells = [];
    while (i < P.length && !(cells.length && /^\d{1,2}$/.test(P[i]) && Number(P[i]) === n + 1) && cells.length < hdr.length - 1) cells.push(P[i++]);
    const get = c => (c > 0 && cells[c - 1] !== undefined ? cells[c - 1] : '');
    const num = v => (/^\d*[.,]\d+$|^[01]$/.test(v) ? v : '');
    out[n] = { level: get(cL), p: num(get(cP)), d: num(get(cD)), err: get(cE) };
  }
  return out;
}

/** Mục "Thang đánh giá" (VD 11 – 13: Vững …) -> [[từ, đến, mức, gợi ý cho GV], …] */
function parseScale_(paras) {
  const st = paras.findIndex(p => /^(\d+\.(\d+\.?)*\s*)?Thang đánh giá/i.test(String(p).trim()));
  if (st < 0) return [];
  const out = [];
  for (let i = st + 1; i < paras.length; i++) {
    const p = String(paras[i]).trim();
    if (/^\d+\.(\d+\.?)*\s+\S/.test(p)) break;
    const m = p.match(/^(\d{1,2})\s*[–—-]\s*(\d{1,2})$/);
    if (!m) continue;
    const isRange = x => /^\d{1,2}\s*[–—-]\s*\d{1,2}$/.test(String(x || '').trim());
    const label = isRange(paras[i + 1]) ? '' : String(paras[i + 1] || '').trim();
    const tip = isRange(paras[i + 2]) || /^\d+\.(\d+\.?)*\s+\S/.test(String(paras[i + 2] || '')) ? '' : String(paras[i + 2] || '').trim();
    if (label) out.push([Number(m[1]), Number(m[2]), label, tip]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

/** Mức thành thạo theo thang của Teacher's Book (quy đổi tỉ lệ nếu số câu khác thang). */
function scaleLevel_(scale, correct, total) {
  if (!scale || !scale.length || !total) return null;
  const max = scale.reduce((m, x) => Math.max(m, x[1]), 0);
  const s = max === total ? correct : Math.round(correct * max / total);
  for (let i = 0; i < scale.length; i++) {
    if (s >= scale[i][0] && s <= scale[i][1]) return { label: scale[i][2], tip: scale[i][3], range: scale[i][0] + '–' + scale[i][1] + (max === total ? '' : '/' + max) };
  }
  return null;
}

// ---- Phân tích file Writing ----------------------------------------------------
function parseWriting_(paras) {
  const idx = re => paras.findIndex(p => re.test(p));
  const t1 = idx(/^WRITING TASK 1\b/i), t2 = idx(/^WRITING TASK 2\b/i);
  const a1 = idx(/^TASK 1\s*[–—-]\s*Answer\b/i), a2 = idx(/^TASK 2\s*[–—-]\s*Answer\b/i);
  const clean = arr => arr.filter(p => !/^(TASK [12]\s*[–—-]\s*Answer|Word count|You should spend|Write at least|Write about the following)/i.test(p) &&
    !/^[-_.…\s]+$/.test(p) && !/^\d{1,2}$/.test(p));
  const slice = (s, e) => (s < 0 ? [] : paras.slice(s + 1, e < 0 ? undefined : e));
  const firstAns = [a1, a2].filter(x => x >= 0).sort((x, y) => x - y)[0];
  const end = (s, cands) => cands.filter(x => x > s).sort((x, y) => x - y)[0];
  return {
    hasMarkers: a1 >= 0 || a2 >= 0,
    has1: a1 >= 0 || t1 >= 0,
    has2: a2 >= 0 || t2 >= 0,
    task1Prompt: clean(slice(t1, t1 < 0 ? -1 : (end(t1, [t2, firstAns]) || -1))).join('\n').trim(),
    task2Prompt: clean(slice(t2, t2 < 0 ? -1 : (end(t2, [firstAns]) || -1))).join('\n').trim(),
    task1Answer: a1 < 0 ? '' : clean(slice(a1, end(a1, [a2]) || -1)).join('\n').trim(),
    task2Answer: a2 < 0 ? '' : clean(slice(a2, end(a2, [a1]) || -1)).join('\n').trim(),
  };
}

// ---------------------------------------------------------------------------
// SAU HẠN NỘP: GỬI KẾT QUẢ READING/LISTENING + PHÂN TÍCH CÂU HỎI
// ---------------------------------------------------------------------------
/**
 * Với mỗi phần Reading/Listening đã hết hạn nộp (+ số giờ chờ trong Cấu hình):
 *  1. Gửi mỗi HS 1 email: điểm, mức độ, các câu sai kèm giải thích từ Teacher's Book (không cần tick Duyệt gửi)
 *  2. Phân tích câu hỏi của cả lớp (p, D theo nhóm 27%) vào sheet "Phân tích câu hỏi", gửi tóm tắt cho giáo viên
 * opts.analyzeNow: chỉ phân tích, không cần chờ hết hạn, không gửi email nào.
 */
function rlAfterDeadline_(opts) {
  opts = opts || {};
  ensureConfigRows_(); // hiện các thiết lập mới trong sheet Cấu hình (không cần chạy lại Cài đặt)
  const cfg = getConfig_();
  if (!opts.analyzeNow && !cfg.autoSendRL && !cfg.itemAnalysis) return '';
  const cwT = readTable_(SH.CW, CW_HEADERS);
  const subT = readTable_(SH.SUB, SUB_HEADERS);
  const keys = loadAnswerKeys_();
  const bands = loadBands_();
  let info = null;
  const formCache = {};
  const now = Date.now();
  const st = { sent: 0, waitQuota: 0, analyzed: [], notes: [] };

  for (let ci = 0; ci < cwT.rows.length; ci++) {
    if (timeUp_()) break;
    const cw = cwT.rows[ci];
    if (cw[C['Chấm tự động']] !== true) continue;
    const due = cw[C['Hạn nộp']];
    if (!opts.analyzeNow) {
      if (!(due instanceof Date) || now < due.getTime() + cfg.rlDelayH * 3600e3) continue;
      if (now - due.getTime() > cfg.days * 86400e3) continue;
    }
    const comps = componentsOf_(cw).filter(s => /^Reading|^Listening/.test(s));
    for (let j = 0; j < comps.length; j++) {
      const skill = comps[j];
      const k = /^Listening/.test(skill) ? 'L' : 'R';
      const src = rlSource_(cw, skill);
      if (!src.keyCode || !keys[src.keyCode]) continue;
      // Bài giao trước khi có tính năng này: đọc lại Teacher's Book trong thư mục bài (1 lần)
      if (!(cwData_(cw).info || {})[k]) { backfillTeacherInfo_(cwT, ci, k, src.keyCode); info = null; }
      if (!info) info = loadKeyInfo_();
      const ctx = {
        cw, skill, k, key: keys[src.keyCode], info: info[src.keyCode] || {},
        scale: (cwData_(cw).scales || {})[k] || [], formUrl: src.formUrl,
      };
      try {
        if (cfg.autoSendRL && !opts.analyzeNow) sendRLResults_(subT, ctx, bands, formCache, cfg, st);
        if ((cfg.itemAnalysis || opts.analyzeNow) && src.formUrl) {
          const a = analyzeItems_(cwT, ci, ctx, subT, formCache, cfg, !opts.analyzeNow);
          if (a) st.analyzed.push(a);
        }
      } catch (e) {
        log_('Lỗi gửi kết quả/phân tích ' + cw[C['Tiêu đề']] + ' - ' + skill, e.stack || e.message);
        st.notes.push(cw[C['Tiêu đề']] + ' – ' + skill + ': ' + e.message);
      }
    }
  }
  const parts = [];
  if (st.sent) parts.push('Đã gửi kết quả R/L cho ' + st.sent + ' HS');
  if (st.waitQuota) parts.push(st.waitQuota + ' email chờ ngày mai (hết hạn mức Gmail)');
  if (st.analyzed.length) parts.push('Phân tích câu hỏi: ' + st.analyzed.join('; '));
  if (st.notes.length) parts.push('Lỗi: ' + st.notes.join('; '));
  if (opts.analyzeNow && !st.analyzed.length) parts.push('Chưa có bài nào để phân tích (cần bài có Form + đáp án và có HS đã làm).');
  return parts.join('\n');
}

/** Gửi email kết quả cho HS đã làm phần R/L này và chưa được gửi. */
function sendRLResults_(subT, ctx, bands, formCache, cfg, st) {
  const cwId = String(ctx.cw[C['CourseWork ID']]);
  const fr = ctx.formUrl ? getFormResponses_(ctx.formUrl, formCache) : null;
  for (let i = 0; i < subT.rows.length; i++) {
    if (timeUp_()) return;
    const r = subT.rows[i];
    if (String(r[S['CourseWork ID']]) !== cwId || String(r[S['Kỹ năng']]) !== ctx.skill) continue;
    if (r[S['Đã gửi lúc']] || !r[S['Email']] || String(r[S['Trạng thái chấm']]) !== 'Đã chấm') continue;
    let answers = null;
    if (fr) {
      const resp = fr[String(r[S['Email']]).toLowerCase()];
      if (!resp) continue;
      answers = resp.answers;
      // Chấm lại theo câu trả lời mới nhất trên Form (HS có thể đã sửa sau lần chấm trước)
      const res = scoreAnswers_(answers, ctx.key);
      const b = toBand_(bands, ctx.skill, res.correct, res.total);
      writeGrade_(subT, i, rlGradeResult_(res, b, false));
    }
    if (MailApp.getRemainingDailyQuota() < 3) { st.waitQuota++; continue; }
    const mail = rlResultEmail_(r, ctx, answers, cfg);
    MailApp.sendEmail({ to: r[S['Email']], subject: mail.subject, body: mail.text, htmlBody: mail.html, name: cfg.teacherName || undefined });
    r[S['Duyệt gửi']] = true;
    r[S['Đã gửi lúc']] = new Date();
    subT.sh.getRange(i + 2, S['Duyệt gửi'] + 1, 1, 2).setValues([[true, r[S['Đã gửi lúc']]]]);
    st.sent++;
  }
}

/** Kết quả chấm R/L để ghi vào sheet Nộp bài. */
function rlGradeResult_(res, b, usedAI) {
  const wrong = res.wrong.slice(0, 25).map(w => 'Câu ' + w.q + ': "' + (w.given || '—') + '" → ' + w.expected).join('; ');
  return {
    score: res.correct + '/' + res.total, band: b.band,
    summary: (res.wrong.length ? 'Sai ' + res.wrong.length + ' câu. ' + wrong : 'Đúng tất cả!') +
      (b.scaled ? ' (band quy đổi theo tỉ lệ /40)' : '') + (usedAI ? ' [AI đọc đáp án từ file — nên kiểm tra lại]' : ''),
    status: 'Đã chấm', stamp: true, usedAI,
  };
}

/** "Hartley|HARTLEY" -> "Hartley (chấp nhận: HARTLEY)" */
function displayKey_(k) {
  const alts = String(k).split('|').map(x => x.trim()).filter(String);
  return alts[0] + (alts.length > 1 ? ' (chấp nhận: ' + alts.slice(1).join(' / ') + ')' : '');
}

// Bảng màu giống web IELTS Writing Checker (xanh pastel + xanh đậm)
const EM = {
  bg: '#f3f6f4', surface: '#ffffff', brand: '#cdebd8', onBrand: '#1b4332', primary: '#2d6a4f', soft: '#f1faf4',
  border: '#cfe8d8', text: '#1c1917', muted: '#57534e', success: '#065f46', successSoft: '#ecfdf5',
  danger: '#991b1b', dangerSoft: '#fef2f2', warning: '#78350f', warningSoft: '#fffbeb', grey: '#e7e5e4',
  font: 'Arial,Helvetica,sans-serif', serif: 'Georgia,\'Times New Roman\',serif',
};

// ---- Khung email dùng chung (bảng màu EM) ----
function emPill_(txt, fg, bg) {
  return '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:' + bg + ';color:' + fg +
    ';font-size:13px;font-weight:bold;font-family:' + EM.font + ';white-space:nowrap">' + txt + '</span>';
}
/** Dải đầu email: nhãn nhỏ, tiêu đề chữ có chân, dòng phụ (đã esc sẵn). */
function emHeader_(kicker, title, sub) {
  return '<tr><td style="background:' + EM.brand + ';padding:22px 28px;border-radius:12px 12px 0 0">' +
    '<div style="font-family:' + EM.font + ';font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:' + EM.onBrand + ';opacity:.8">' + kicker + '</div>' +
    '<div style="font-family:' + EM.serif + ';font-size:24px;line-height:1.3;color:' + EM.onBrand + ';margin-top:4px">' + title + '</div>' +
    (sub ? '<div style="font-family:' + EM.font + ';font-size:13px;color:' + EM.onBrand + ';margin-top:2px">' + sub + '</div>' : '') + '</td></tr>';
}
/** 1 dòng nội dung có lề chuẩn. */
function emRow_(inner, pad) {
  return '<tr><td style="padding:' + (pad || '16px 28px 0') + ';font-family:' + EM.font + ';font-size:15px;line-height:1.6;color:' + EM.text + '">' + inner + '</td></tr>';
}
function emH2_(txt) {
  return '<tr><td style="padding:22px 28px 4px;font-family:' + EM.serif + ';font-size:19px;color:' + EM.onBrand + '">' + txt + '</td></tr>';
}
/** Hộp ghi chú: kind = 'info' | 'warn' | 'danger' | 'ok'. */
function emBox_(inner, kind) {
  const c = { info: [EM.onBrand, EM.soft, EM.primary], warn: [EM.warning, EM.warningSoft, '#d97706'], danger: [EM.danger, EM.dangerSoft, EM.danger], ok: [EM.success, EM.successSoft, EM.success] }[kind || 'info'];
  return '<div style="background:' + c[1] + ';border-left:4px solid ' + c[2] + ';border-radius:0 8px 8px 0;padding:12px 14px;font-family:' + EM.font +
    ';font-size:13px;line-height:1.6;color:' + c[0] + '">' + inner + '</div>';
}
/** Thẻ viền xanh nhạt. */
function emCard_(inner, bg) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ' + EM.border + ';border-radius:12px' +
    (bg ? ';background:' + bg : '') + '"><tr><td style="padding:14px 16px">' + inner + '</td></tr></table>';
}
function emButton_(href, label) {
  return '<a href="' + esc_(href) + '" style="display:inline-block;background:' + EM.primary + ';color:#ffffff;text-decoration:none;font-family:' + EM.font +
    ';font-size:14px;font-weight:bold;padding:10px 18px;border-radius:8px">' + label + '</a>';
}
/** Các ô số liệu: [{ v, label, color }] */
function emStats_(items) {
  const w = Math.floor(100 / items.length);
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + items.map(x =>
    '<td width="' + w + '%" style="padding:4px" valign="top"><div style="background:' + EM.soft + ';border:1px solid ' + EM.border + ';border-radius:10px;padding:12px 10px;text-align:center">' +
    '<div style="font-family:' + EM.serif + ';font-size:26px;line-height:1.1;font-weight:bold;color:' + (x.color || EM.primary) + '">' + x.v + '</div>' +
    '<div style="font-family:' + EM.font + ';font-size:12px;color:' + EM.muted + ';margin-top:4px">' + x.label + '</div></div></td>').join('') + '</tr></table>';
}
function emSign_(teacher, line) {
  return '<tr><td style="padding:22px 28px 26px;font-family:' + EM.font + ';font-size:15px;line-height:1.6;color:' + EM.text + '">' + (line || 'Cố gắng lên nhé!') + '<br>' +
    '<span style="font-family:' + EM.serif + ';font-size:17px;color:' + EM.onBrand + '">' + esc_(teacher) + '</span></td></tr>';
}
/** Bọc nội dung thành email HTML hoàn chỉnh. */
function emShell_(body, preheader, footer, width) {
  return '<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:' + EM.bg + '"><div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc_(preheader || '') + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + EM.bg + '"><tr><td align="center" style="padding:20px 10px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:' + (width || 600) + 'px;background:' + EM.surface + ';border-radius:12px;border:1px solid ' + EM.border + '">' +
    body + '</table>' +
    (footer ? '<div style="font-family:' + EM.font + ';font-size:12px;color:' + EM.muted + ';margin-top:12px">' + footer + '</div>' : '') +
    '</td></tr></table></body></html>';
}
/** Văn bản nhiều dòng -> HTML: dòng bắt đầu bằng -, •, * thành gạch đầu dòng. */
function emText_(s) {
  const lines = String(s || '').split('\n'), out = [];
  let list = [];
  const flush = () => { if (list.length) { out.push('<ul style="margin:6px 0 6px 18px;padding:0">' + list.join('') + '</ul>'); list = []; } };
  lines.forEach(l => {
    const t = l.trim();
    if (!t) { flush(); return; }
    const m = t.match(/^[-•*]\s+(.*)$/);
    if (m) list.push('<li style="margin:2px 0">' + esc_(m[1]) + '</li>');
    else { flush(); out.push('<div style="margin:4px 0">' + esc_(t) + '</div>'); }
  });
  flush();
  return out.join('');
}

/** Email kết quả chung (Speaking, Writing chấm bằng AI, bài không có đáp án). Trả về { subject, html, text }. */
function feedbackEmail_(r, cfg, hasPdf) {
  const teacher = cfg.teacherName || 'Thầy/cô';
  const student = String(r[S['Học sinh']]), title = String(r[S['Bài tập']]).trim(), skill = String(r[S['Kỹ năng']]), cls = String(r[S['Lớp']]);
  const band = r[S['Band']] !== '' && r[S['Band']] !== null ? String(r[S['Band']]) : '';
  const score = String(r[S['Điểm']] || '');
  const summary = String(r[S['Nhận xét tóm tắt']] || '');
  let body = emHeader_('Kết quả ' + esc_(skill), esc_(title), esc_(cls));
  body += emRow_('Chào <b>' + esc_(student) + '</b>,<br>' + esc_(teacher) + ' gửi em kết quả bài <b>' + esc_(title) + ' – ' + esc_(skill) + '</b>.', '24px 28px 8px');
  if (band || score) {
    const big = band ? 'Band ' + band : score;
    body += emRow_(emCard_('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td style="font-family:' + EM.serif + ';font-size:40px;line-height:1;color:' + EM.primary + ';font-weight:bold">' + esc_(big) + '</td>' +
      '<td align="right" valign="middle" style="font-family:' + EM.font + ';font-size:13px;color:' + EM.muted + '">' +
      (band && score ? 'Điểm: <b style="color:' + EM.text + '">' + esc_(score) + '</b>' : '') + '</td></tr></table>', EM.soft), '8px 28px 4px');
  }
  if (summary.trim()) {
    body += emH2_('Nhận xét');
    body += emRow_('<div style="font-size:14px;line-height:1.65">' + emText_(summary) + '</div>', '4px 28px 0');
  }
  if (hasPdf) body += emRow_(emBox_('<b>Nhận xét chi tiết</b> nằm trong file PDF đính kèm. Em đọc kỹ từng góp ý và sửa lại bài nhé.'), '18px 28px 0');
  body += emSign_(teacher);
  const html = emShell_(body, (band ? 'Band ' + band : score) + ' – ' + title + ' ' + skill, 'Email tự động từ hệ thống bài tập lớp ' + esc_(cls) + '.');
  const text = ['Chào ' + student + ',', '', teacher + ' gửi em kết quả bài ' + title + ' – ' + skill + ' (' + cls + ').'];
  if (score) text.push('Điểm: ' + score);
  if (band) text.push('Band: ' + band);
  if (summary.trim()) text.push('', summary);
  if (hasPdf) text.push('', 'Nhận xét chi tiết trong file PDF đính kèm.');
  text.push('', 'Cố gắng lên nhé!', teacher);
  return { subject: '[Kết quả] ' + title + ' – ' + skill + (band ? ': Band ' + band : score ? ': ' + score : ''), html, text: text.join('\n') };
}

/** Email nhắc nộp bài. g = { name, items: [{ r, kind, link }] }. Trả về { subject, html, text }. */
function reminderEmail_(g, cfg, tz, now) {
  const teacher = cfg.teacherName || 'Thầy/cô';
  const n = g.items.length, late = g.items.filter(x => x.kind === 'late').length;
  const items = g.items.slice().sort((a, b) => a.r[S['Hạn nộp']] - b.r[S['Hạn nộp']]);
  const left = due => {
    const h = Math.max(0, (due.getTime() - now) / 3600e3);
    return h < 1 ? 'còn dưới 1 giờ' : h < 48 ? 'còn ' + Math.floor(h) + ' giờ' : 'còn ' + Math.floor(h / 24) + ' ngày';
  };
  let body = emHeader_('Nhắc nộp bài', 'Em còn ' + n + ' bài chưa nộp', late ? '<b>' + late + '</b> bài đã quá hạn' : 'Sắp đến hạn nộp');
  body += emRow_('Chào <b>' + esc_(g.name) + '</b>,<br>Trên Google Classroom em còn ' + (n > 1 ? 'các bài' : 'bài') + ' sau chưa nộp:', '24px 28px 4px');
  items.forEach(x => {
    const due = x.r[S['Hạn nộp']];
    const tag = x.kind === 'late' ? emPill_('Đã quá hạn', EM.danger, EM.dangerSoft) : emPill_(left(due), EM.warning, EM.warningSoft);
    const formNote = x.state && x.state.formDone
      ? '<div style="font-family:' + EM.font + ';font-size:13px;color:' + EM.danger + ';margin-top:6px"><b>Em đã làm bài trên Form nhưng chưa bấm "Nộp bài" trên Classroom</b> — bài vẫn đang tính là chưa nộp.</div>' : '';
    body += emRow_(emCard_('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td valign="top"><div style="font-family:' + EM.serif + ';font-size:17px;font-weight:bold;color:' + EM.onBrand + '">' +
      (x.link ? '<a href="' + esc_(x.link) + '" style="color:' + EM.onBrand + ';text-decoration:none">' + esc_(x.r[S['Bài tập']]) + '</a>' : esc_(x.r[S['Bài tập']])) + '</div>' +
      '<div style="font-family:' + EM.font + ';font-size:13px;color:' + EM.muted + ';margin-top:2px">' + esc_(x.r[S['Lớp']]) + ' · hạn ' + Utilities.formatDate(due, tz, 'HH:mm dd/MM') + '</div></td>' +
      '<td align="right" valign="top">' + tag + '</td></tr></table>' + formNote, x.kind === 'late' ? EM.dangerSoft : ''), '10px 28px 0');
  });
  body += emRow_(emBox_('Làm xong em nhớ bấm <b>Nộp bài (Turn in)</b> trên Classroom. Bài chỉ được tính là đã nộp khi có trạng thái <i>Đã nộp</i>.'), '18px 28px 0');
  body += emRow_(emButton_(items.length === 1 && items[0].link ? items[0].link : 'https://classroom.google.com', 'Mở Google Classroom'), '18px 28px 0');
  body += emSign_(teacher, 'Cố lên nhé!');
  const html = emShell_(body, 'Em còn ' + n + ' bài chưa nộp' + (late ? ' (' + late + ' bài đã quá hạn)' : ''), 'Email tự động từ hệ thống bài tập IELTS.');
  const text = ['Chào ' + g.name + ',', '', 'Em còn bài tập chưa nộp trên Google Classroom:'];
  items.forEach(x => text.push('- ' + x.r[S['Bài tập']] + ' (' + x.r[S['Lớp']] + ') – hạn ' + Utilities.formatDate(x.r[S['Hạn nộp']], tz, 'HH:mm dd/MM') +
    (x.kind === 'late' ? ' (đã quá hạn)' : '') + (x.state && x.state.formDone ? ' — em đã làm Form nhưng CHƯA bấm Nộp trên Classroom' : '')));
  text.push('', 'Làm xong em nhớ bấm Nộp bài (Turn in) nhé.', '', teacher);
  return { subject: '[Nhắc nộp bài] ' + (late ? n + ' bài cần nộp, ' + late + ' bài đã quá hạn' : n + ' bài tập IELTS cần hoàn thành'), html, text: text.join('\n') };
}

/** Báo cáo ngày cho giáo viên. Trả về { subject, html }. */
function teacherReportEmail_(cfg, tz, recent, subs, pending, webPending, errors, health, todo) {
  const date = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');
  const sheetUrl = SpreadsheetApp.getActive().getUrl();
  let body = emHeader_('Báo cáo ngày', esc_(date), 'IELTS Classroom Portal');
  if (health && !health.ok) {
    body += emRow_(emBox_('<b>Hệ thống cần bạn xử lý:</b><ul style="margin:6px 0 0 18px;padding:0">' +
      health.problems.map(x => '<li style="margin:2px 0">' + esc_(x) + '</li>').join('') + '</ul>', 'danger'), '20px 24px 0');
  }
  body += emRow_(emStats_([
    { v: pending, label: 'bài AI chấm<br>chờ bạn duyệt', color: pending ? EM.warning : EM.primary },
    { v: webPending, label: 'bài Writing<br>chờ chấm trên web', color: webPending ? EM.warning : EM.primary },
    { v: errors, label: 'bài<br>chấm lỗi', color: errors ? EM.danger : EM.primary },
  ]), '20px 24px 0');
  body += emRow_((cfg.writingAppUrl ? emButton_(cfg.writingAppUrl + '#/lop', 'Mở IELTS Classroom Portal') + ' &nbsp; ' : '') + '<a href="' + esc_(sheetUrl) + '" style="font-family:' + EM.font + ';font-size:14px;color:' + EM.primary + ';font-weight:bold">Mở Google Sheet →</a>' + (webPending && cfg.writingAppUrl ? ' &nbsp; <a href="' + esc_(cfg.writingAppUrl + '#/admin') +
    '" style="font-family:' + EM.font + ';font-size:14px;color:' + EM.primary + ';font-weight:bold">Mở hàng chờ chấm Writing →</a>' : ''), '16px 28px 0');
  if (todo) body += todoEmailSection_(todo);
  body += emH2_('Bài tập có hạn trong ±7 ngày');
  if (!recent.length) body += emRow_('<span style="color:' + EM.muted + ';font-size:14px">Không có bài tập nào.</span>', '4px 28px 0');
  const now = Date.now();
  recent.forEach(w => {
    const missing = subs.filter(s => s[S['CourseWork ID']] === w[C['CourseWork ID']] &&
      [STATUS.NOT_YET, STATUS.MISSING].indexOf(s[S['Trạng thái']]) >= 0).map(s => s[S['Học sinh']])
      .filter((x, k, arr) => arr.indexOf(x) === k);
    const past = w[C['Hạn nộp']].getTime() <= now;
    const tag = past ? emPill_('Đã hết hạn', EM.muted, EM.grey) : emPill_('Đang mở', EM.success, EM.successSoft);
    const num = (v, lbl, col) => '<span style="font-weight:bold;color:' + col + '">' + v + '</span> ' + lbl;
    body += emRow_(emCard_('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td valign="top"><div style="font-family:' + EM.serif + ';font-size:16px;font-weight:bold;color:' + EM.onBrand + '">' +
      (w[C['Link']] ? '<a href="' + esc_(w[C['Link']]) + '" style="color:' + EM.onBrand + ';text-decoration:none">' + esc_(w[C['Tiêu đề']]) + '</a>' : esc_(w[C['Tiêu đề']])) + '</div>' +
      '<div style="font-family:' + EM.font + ';font-size:12px;color:' + EM.muted + ';margin-top:2px">' + esc_(w[C['Lớp']]) + ' · hạn ' +
      Utilities.formatDate(w[C['Hạn nộp']], tz, 'dd/MM HH:mm') + '</div></td><td align="right" valign="top">' + tag + '</td></tr></table>' +
      '<div style="font-family:' + EM.font + ';font-size:13px;color:' + EM.text + ';margin-top:8px">' +
      num(w[C['Đã nộp']], 'đã nộp', EM.success) + ' &nbsp;·&nbsp; ' + num(w[C['Nộp muộn']], 'muộn', EM.warning) + ' &nbsp;·&nbsp; ' +
      num(w[C['Chưa nộp']], 'chưa nộp', Number(w[C['Chưa nộp']]) ? EM.danger : EM.muted) + '</div>' +
      (missing.length ? '<div style="font-family:' + EM.font + ';font-size:13px;color:' + EM.muted + ';margin-top:6px;line-height:1.5">Chưa nộp: <span style="color:' + EM.text + '">' +
        esc_(missing.join(', ')) + '</span></div>' : '')), '10px 28px 0');
  });
  body += '<tr><td style="padding:0 0 24px"></td></tr>';
  return { subject: '[IELTS Classroom Portal] Báo cáo ngày ' + Utilities.formatDate(new Date(), tz, 'dd/MM'), html: emShell_(body, pending + ' bài chờ duyệt · ' + webPending + ' chờ chấm Writing · ' + errors + ' lỗi', 'Báo cáo tự động lúc ' + Utilities.formatDate(new Date(), tz, 'HH:mm dd/MM') + '.') };
}

/** Mục "Việc cần làm hôm nay" trong email báo cáo sáng (rỗng nếu không có việc gì). */
function todoEmailSection_(todo) {
  const groups = [
    ['Chờ bạn duyệt (AI đã chấm)', todo.review, x => x.student + ' — ' + x.title + ' · ' + x.skill],
    ['Writing chờ chấm trên web', todo.web, x => x.student + ' — ' + x.title],
    ['Cần xem tay', todo.manual, x => x.student + ' — ' + x.title + ' · ' + x.skill + ': ' + x.status.replace(/^(Lỗi[^:]*:|Bỏ qua:)\s*/, '').slice(0, 90)],
    ['Đã làm Form nhưng chưa bấm Nộp (đã nhắc HS)', todo.formPending, x => x.student + ' — ' + x.title],
  ].filter(g => g[1].length);
  if (!groups.length) return emH2_('Việc cần làm hôm nay') + emRow_('<span style="color:' + EM.success + ';font-size:14px">Không có việc gì cần xử lý.</span>', '4px 28px 0');
  let html = emH2_('Việc cần làm hôm nay');
  groups.forEach(g => {
    const list = g[1].slice(0, 12).map(x => '<li style="margin:2px 0">' + esc_(g[2](x)) + '</li>').join('') +
      (g[1].length > 12 ? '<li style="margin:2px 0;color:' + EM.muted + '">… và ' + (g[1].length - 12) + ' bài khác</li>' : '');
    html += emRow_('<div style="font-family:' + EM.font + ';font-size:14px;font-weight:bold;color:' + EM.text + '">' + esc_(g[0]) + ' (' + g[1].length + ')</div>' +
      '<ul style="font-family:' + EM.font + ';font-size:13px;color:' + EM.text + ';margin:4px 0 0 18px;padding:0;line-height:1.5">' + list + '</ul>', '10px 28px 0');
  });
  return html;
}

/** Email kết quả R/L cho 1 HS: điểm, mức độ, bảng đúng/sai từng câu, các câu sai + giải thích. Trả về { subject, html, text }. */
function rlResultEmail_(r, ctx, answers, cfg) {
  const teacher = cfg.teacherName || 'Thầy/cô';
  const name = SKILL_NAMES[ctx.k];
  const student = String(r[S['Học sinh']]);
  const title = String(r[S['Bài tập']]).trim();
  const cls = String(r[S['Lớp']]);
  let res = null, correct = null, total = Object.keys(ctx.key).length;
  if (answers) { res = scoreAnswers_(answers, ctx.key); correct = res.correct; total = res.total; }
  else {
    const m = String(r[S['Điểm']]).match(/^(\d+)\s*\/\s*(\d+)/);
    if (m) { correct = Number(m[1]); total = Number(m[2]); }
  }
  const scoreTxt = correct !== null ? correct + '/' + total : String(r[S['Điểm']]);
  const lvl = correct === null ? null : scaleLevel_(ctx.scale, correct, total);
  const lvlIdx = lvl ? ctx.scale.map(x => x[2]).indexOf(lvl.label) : -1;
  const lvlColor = [[EM.success, EM.successSoft], [EM.primary, EM.soft], [EM.warning, EM.warningSoft], [EM.danger, EM.dangerSoft]][Math.min(Math.max(lvlIdx, 0), 3)];
  const pill = emPill_;
  const wrong = res ? res.wrong : null;
  const blank = wrong ? wrong.filter(w => !String(w.given).trim()).length : 0;
  const pct = correct !== null && total ? Math.round(correct * 100 / total) : 0;

  // Phần đầu + điểm
  let body = '';
  body += emHeader_('Kết quả ' + esc_(name), esc_(title), esc_(cls));
  body += '<tr><td style="padding:24px 28px 8px;font-family:' + EM.font + ';font-size:15px;line-height:1.6;color:' + EM.text + '">' +
    'Chào <b>' + esc_(student) + '</b>,<br>' + esc_(teacher) + ' gửi em kết quả phần <b>' + esc_(name) + '</b> của bài <b>' + esc_(title) + '</b>.</td></tr>';
  body += '<tr><td style="padding:8px 28px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + EM.soft +
    ';border:1px solid ' + EM.border + ';border-radius:12px"><tr><td style="padding:18px 20px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="font-family:' + EM.serif + ';font-size:44px;line-height:1;color:' + EM.primary + ';font-weight:bold">' + esc_(scoreTxt) +
    '<span style="font-family:' + EM.font + ';font-size:14px;color:' + EM.muted + ';font-weight:normal"> câu đúng</span></td>' +
    '<td align="right" valign="middle">' + (lvl ? pill(esc_(lvl.label), lvlColor[0], '#ffffff') +
      '<div style="font-family:' + EM.font + ';font-size:12px;color:' + EM.muted + ';margin-top:6px">mức ' + esc_(lvl.range) + ' câu</div>'
      : (r[S['Band']] !== '' ? pill('Band ' + esc_(r[S['Band']]), EM.primary, '#ffffff') +
        '<div style="font-family:' + EM.font + ';font-size:12px;color:' + EM.muted + ';margin-top:6px">quy đổi tham khảo</div>' : '')) + '</td>' +
    '</tr></table>';
  if (correct !== null) {
    body += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px"><tr>' +
      (pct > 0 ? '<td width="' + pct + '%" style="background:' + EM.primary + ';height:8px;border-radius:4px 0 0 4px;font-size:0;line-height:0">&nbsp;</td>' : '') +
      (pct < 100 ? '<td style="background:' + EM.grey + ';height:8px;border-radius:0 4px 4px 0;font-size:0;line-height:0">&nbsp;</td>' : '') + '</tr></table>';
  }
  if (wrong) {
    body += '<div style="font-family:' + EM.font + ';font-size:13px;color:' + EM.muted + ';margin-top:10px">' +
      '<span style="color:' + EM.success + ';font-weight:bold">' + correct + ' đúng</span> &nbsp;·&nbsp; ' +
      '<span style="color:' + (wrong.length - blank ? EM.danger : EM.muted) + ';font-weight:bold">' + (wrong.length - blank) + ' sai</span>' +
      (blank ? ' &nbsp;·&nbsp; <span style="font-weight:bold">' + blank + ' bỏ trống</span>' : '') + '</div>';
  }
  body += '</td></tr></table></td></tr>';

  // Bảng đúng/sai từng câu
  if (res) {
    const wrongSet = {};
    res.wrong.forEach(w => { wrongSet[w.q] = w; });
    const qs = Object.keys(ctx.key).sort((a, b) => Number(a) - Number(b));
    let cells = '', grid = '';
    qs.forEach((q, i) => {
      const w = wrongSet[q];
      const bg = !w ? EM.successSoft : String(w.given).trim() ? EM.dangerSoft : EM.grey;
      const fg = !w ? EM.success : String(w.given).trim() ? EM.danger : EM.muted;
      const mark = !w ? '&#10003;' : String(w.given).trim() ? '&#10007;' : '&ndash;';
      cells += '<td align="center" style="padding:3px"><div style="background:' + bg + ';color:' + fg + ';border-radius:8px;padding:6px 0;font-family:' + EM.font +
        ';font-size:12px;line-height:1.3"><b>' + esc_(q) + '</b><br>' + mark + '</div></td>';
      if ((i + 1) % 7 === 0 || i === qs.length - 1) {
        for (let k = (i + 1) % 7 ? (i + 1) % 7 : 7; k < 7; k++) cells += '<td style="padding:3px"></td>';
        grid += '<tr>' + cells + '</tr>'; cells = '';
      }
    });
    body += '<tr><td style="padding:16px 28px 0"><div style="font-family:' + EM.font + ';font-size:13px;font-weight:bold;color:' + EM.onBrand +
      ';margin-bottom:6px">Bài làm của em</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed">' + grid + '</table></td></tr>';
  }

  // Các câu sai + giải thích
  if (wrong && !wrong.length) {
    body += '<tr><td style="padding:18px 28px 0"><div style="background:' + EM.successSoft + ';border-radius:12px;padding:16px 18px;font-family:' + EM.font +
      ';font-size:15px;color:' + EM.success + '"><b>Em làm đúng tất cả các câu. Rất tốt!</b><br><span style="font-size:13px">Giữ phong độ này ở bài sau nhé.</span></div></td></tr>';
  } else if (wrong) {
    body += '<tr><td style="padding:22px 28px 4px;font-family:' + EM.serif + ';font-size:19px;color:' + EM.onBrand + '">Các câu cần xem lại (' + wrong.length + ')</td></tr>';
    wrong.forEach(w => {
      const isBlank = !String(w.given).trim();
      const ex = ctx.info[w.q] && ctx.info[w.q].text ? String(ctx.info[w.q].text) : '';
      let rows = '';
      ex.split('\n').filter(String).forEach(line => {
        const k = line.indexOf(': ');
        const label = k > 0 && k < 40 ? line.slice(0, k) : '';
        const val = label ? line.slice(k + 2) : line;
        if (/^Bẫy/i.test(label)) {
          rows += '<tr><td style="padding:10px 0 0"><div style="background:' + EM.warningSoft + ';border-radius:8px;padding:10px 12px;font-family:' + EM.font +
            ';font-size:13px;line-height:1.55;color:' + EM.warning + '"><b>' + esc_(label) + '</b><br>' + esc_(val) + '</div></td></tr>';
        } else {
          rows += '<tr><td style="padding:8px 0 0;font-family:' + EM.font + '">' + (label ? '<div style="font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:' +
            EM.primary + ';font-weight:bold">' + esc_(label) + '</div>' : '') + '<div style="font-size:14px;line-height:1.55;color:' + EM.text + '">' + esc_(val) + '</div></td></tr>';
        }
      });
      if (!rows) rows = '<tr><td style="padding:6px 0 0;font-family:' + EM.font + ';font-size:13px;color:' + EM.muted + '">Câu này sẽ được chữa trên lớp.</td></tr>';
      body += '<tr><td style="padding:10px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ' + EM.border +
        ';border-radius:12px"><tr><td style="padding:14px 16px">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td style="font-family:' + EM.serif + ';font-size:17px;color:' + EM.onBrand + ';font-weight:bold">Câu ' + esc_(w.q) + '</td>' +
        '<td align="right">' + pill(isBlank ? 'Bỏ trống' : 'Em chọn: ' + esc_(w.given), isBlank ? EM.muted : EM.danger, isBlank ? EM.grey : EM.dangerSoft) + ' ' +
        pill('Đáp án: ' + esc_(displayKey_(w.expected)), EM.success, EM.successSoft) + '</td></tr></table>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px">' + rows + '</table>' +
        '</td></tr></table></td></tr>';
    });
    body += '<tr><td style="padding:18px 28px 0"><div style="background:' + EM.soft + ';border-left:4px solid ' + EM.primary + ';border-radius:0 8px 8px 0;padding:12px 14px;font-family:' +
      EM.font + ';font-size:13px;line-height:1.6;color:' + EM.onBrand + '"><b>Cách xem lại bài hiệu quả</b><br>1. Mở lại đề, tìm đúng đoạn ở dòng <i>Vị trí</i>.<br>' +
      '2. Gạch chân cặp từ ở dòng <i>Paraphrase</i>.<br>3. Đọc phần <i>Bẫy</i> để biết vì sao mình chọn nhầm.</div></td></tr>';
  } else {
    body += '<tr><td style="padding:16px 28px 0;font-family:' + EM.font + ';font-size:14px;color:' + EM.text + '">' + esc_(r[S['Nhận xét tóm tắt']]) + '</td></tr>';
  }

  // Lời chào + chân email
  body += emSign_(teacher);
  const preheader = 'Em được ' + scoreTxt + (lvl ? ' – mức ' + lvl.label : '') + (wrong && wrong.length ? '. Xem giải thích ' + wrong.length + ' câu cần xem lại.' : '.');
  const html = emShell_(body, preheader, 'Email tự động từ hệ thống bài tập lớp ' + esc_(cls) + '.');

  // Bản chữ thường (cho ứng dụng email không hiển thị HTML)
  const text = ['Chào ' + student + ',', '', teacher + ' gửi em kết quả phần ' + name + ' bài ' + title + ' (' + cls + ').',
    'Điểm: ' + scoreTxt + (lvl ? ' – mức ' + lvl.label : '')];
  if (wrong && wrong.length) {
    text.push('', 'Các câu cần xem lại:');
    wrong.forEach(w => {
      text.push('', 'Câu ' + w.q + ' – Em trả lời: ' + (String(w.given).trim() || '(bỏ trống)') + ' · Đáp án: ' + displayKey_(w.expected));
      const ex = ctx.info[w.q] && ctx.info[w.q].text;
      if (ex) text.push(ex);
    });
  } else if (wrong) text.push('', 'Em làm đúng tất cả các câu. Rất tốt!');
  text.push('', 'Cố gắng lên nhé!', teacher);

  return {
    subject: '[Kết quả] ' + title + ' – ' + name + ': ' + scoreTxt + (lvl ? ' (' + lvl.label + ')' : ''),
    html, text: text.join('\n'),
  };
}

/** Thông tin để gửi kết quả R/L (dùng chung cho gửi sau hạn và gửi khi tick Duyệt gửi). */
function rlContext_(cw, skill, keys, info) {
  const src = rlSource_(cw, skill);
  if (!src.keyCode || !keys[src.keyCode]) return null;
  const k = /^Listening/.test(skill) ? 'L' : 'R';
  return { cw, skill, k, key: keys[src.keyCode], info: info[src.keyCode] || {}, scale: (cwData_(cw).scales || {})[k] || [], formUrl: src.formUrl };
}

/** Ghi lại dữ liệu JSON của bài tập. */
function saveCwData_(cwT, ci, data) {
  const v = JSON.stringify(data);
  cwT.rows[ci][C['Dữ liệu bài (JSON)']] = v;
  cwT.sh.getRange(ci + 2, C['Dữ liệu bài (JSON)'] + 1).setValue(v);
}

/** Bài đã giao trước bản cập nhật: tìm Teacher's Book trong thư mục bài (sheet Giao bài) để lấy giải thích. */
function backfillTeacherInfo_(cwT, ci, k, code) {
  const cw = cwT.rows[ci];
  const data = cwData_(cw);
  data.info = data.info || {};
  data.info[k] = 'none';
  try {
    const cwId = String(cw[C['CourseWork ID']]);
    const rows = readTable_(SH.ASSIGN, ASSIGN_HEADERS).rows.filter(r => String(r[A['CourseWork ID']]) === cwId);
    const folderId = rows.length ? driveIdFromUrl_(rows[0][A['Link thư mục Drive']]) : '';
    if (folderId) {
      const cands = [];
      const it = DriveApp.getFolderById(folderId).getFiles();
      while (it.hasNext()) {
        const f = it.next();
        const fname = String(f.getName()).normalize('NFC');
        if (f.isTrashed() || !isTeacherFile_(fname) || !isDocLike_(f.getMimeType())) continue;
        const sk = fileSkill_(fname, f.getMimeType());
        if (sk === k) cands.unshift(f); else if (!sk) cands.push(f);
      }
      if (cands.length) {
        const paras = readDocx_(cands[0]).paras;
        const ex = parseExplanations_(paras);
        const scale = parseScale_(paras);
        fillKeyInfo_(code, ex);
        if (scale.length) { data.scales = data.scales || {}; data.scales[k] = scale; }
        data.info[k] = 'ok';
        log_('Đọc giải thích từ Teacher\'s Book', cw[C['Tiêu đề']] + ' – ' + SKILL_NAMES[k] + ': ' + Object.keys(ex).length + ' câu');
      }
    }
  } catch (e) {
    log_('Không đọc được Teacher\'s Book', cw[C['Tiêu đề']] + ': ' + e.message);
  }
  saveCwData_(cwT, ci, data);
}

/** Điền giải thích vào các dòng đáp án còn trống (không ghi đè chỗ giáo viên đã sửa). */
function fillKeyInfo_(code, ex) {
  ensureHeaders_(SH.KEY, KEY_HEADERS);
  const sh = sheet_(SH.KEY);
  const last = sh.getLastRow();
  if (last < 2) return;
  const rg = sh.getRange(2, 1, last - 1, KEY_HEADERS.length);
  const vals = rg.getValues();
  let changed = false;
  vals.forEach(r => {
    if (String(r[0]).trim() !== code || String(r[4]).trim()) return;
    const x = ex[String(r[1]).trim()];
    if (!x) return;
    const cells = infoCells_(x);
    for (let c = 0; c < 5; c++) r[4 + c] = cells[c];
    changed = true;
  });
  if (changed) rg.setValues(vals);
}

// ---- Phân tích câu hỏi (Teacher's Book mục 7) --------------------------------
function pLabel_(p) { return p >= 0.65 ? 'Dễ' : p >= 0.45 ? 'Trung bình' : 'Khó'; }
function dLabel_(d) { return d >= 0.40 ? 'Rất tốt' : d >= 0.30 ? 'Tốt' : d >= 0.20 ? 'Chấp nhận' : 'Kém'; }
function round2_(x) { return Math.round(x * 100) / 100; }

/**
 * Tính p, D từng câu từ câu trả lời trên Form của HS trong lớp.
 * students: [{ name, answers: {câu: trả lời} }]. Trả về { n, g, avg, total, items: [...], students }.
 */
function itemStats_(students, key) {
  const qs = Object.keys(key).sort((a, b) => Number(a) - Number(b));
  students.forEach(s => {
    s.answers = alignPairs_(s.answers || {}, key);
    s.ok = {}; s.total = 0;
    qs.forEach(q => {
      const g = s.answers[q] !== undefined && s.answers[q] !== null ? String(s.answers[q]).trim() : '';
      s.ok[q] = matchAnswer_(g, key[q]);
      if (s.ok[q]) s.total++;
    });
  });
  const n = students.length;
  // Nhóm G (điểm cao) / Y (điểm thấp): 27% mỗi nhóm; lớp dưới 20 HS: chia đôi lớp
  const g = n < 20 ? Math.floor(n / 2) : Math.round(n * 0.27);
  const sorted = students.slice().sort((a, b) => b.total - a.total);
  const G = sorted.slice(0, g), Y = g ? sorted.slice(n - g) : [];
  const items = qs.map(q => {
    const right = students.filter(s => s.ok[q]).length;
    const p = n ? right / n : 0;
    const d = g ? (G.filter(s => s.ok[q]).length - Y.filter(s => s.ok[q]).length) / g : null;
    const dist = {};
    students.forEach(s => {
      if (s.ok[q]) return;
      const raw = s.answers[q] !== undefined && s.answers[q] !== null ? String(s.answers[q]).trim() : '';
      const k = raw ? raw.toLowerCase().replace(/\s+/g, ' ') : '(bỏ trống)';
      dist[k] = dist[k] || { label: raw ? (raw.length <= 4 || /^(true|false|not given|yes|no)$/i.test(raw) ? raw.toUpperCase() : raw) : '(bỏ trống)', n: 0 };
      dist[k].n++;
    });
    const common = Object.keys(dist).map(k => dist[k]).sort((a, b) => b.n - a.n).slice(0, 4).map(x => x.label + ' (' + x.n + ')').join(', ');
    const flags = [];
    if (p < 0.30) flags.push('Chữa kỹ trên lớp (p < 0.30)');
    // D chỉ đáng tin khi mỗi nhóm ≥ 3 HS; câu gần như cả lớp đều đúng (p ≥ 0.90) thì D thấp là bình thường
    if (d !== null && g >= 3 && (d < 0 || (d < 0.20 && p < 0.90))) flags.push('Xem lại câu hỏi/đáp án (D ' + (d < 0 ? 'âm' : '< 0.20') + ')');
    return { q, right, wrong: n - right, p, d, common, flags };
  });
  const avg = n ? students.reduce((a, s) => a + s.total, 0) / n : 0;
  return { n, g, avg, total: qs.length, items, students };
}

/** Phân tích 1 phần R/L, ghi vào sheet "Phân tích câu hỏi"; lần đầu sau hạn nộp gửi email cho giáo viên. */
function analyzeItems_(cwT, ci, ctx, subT, formCache, cfg, afterDeadline) {
  const cw = cwT.rows[ci];
  const cwId = String(cw[C['CourseWork ID']]);
  const fr = getFormResponses_(ctx.formUrl, formCache);
  const seen = {}, students = [];
  let roster = 0;
  subT.rows.forEach(r => {
    if (String(r[S['CourseWork ID']]) !== cwId || String(r[S['Kỹ năng']]) !== ctx.skill) return;
    const e = String(r[S['Email']] || '').toLowerCase();
    if (!e || seen[e]) return;
    seen[e] = true; roster++;
    if (fr[e]) students.push({ name: String(r[S['Học sinh']]), email: e, answers: fr[e].answers });
  });
  if (!students.length) return '';
  const a = itemStats_(students, ctx.key);
  const sig = students.map(s => s.email + ':' + Object.keys(s.ok).filter(q => s.ok[q]).join(',')).sort().join('|');
  const data = cwData_(cw);
  data.analysis = data.analysis || {};
  const prev = data.analysis[ctx.k] || {};
  const needMail = afterDeadline && !prev.emailed;
  if (prev.sig === sig && !needMail) return '';

  writeItemRows_(cw, ctx, a, roster);
  data.analysis[ctx.k] = { sig, emailed: !!(prev.emailed || needMail), n: a.n };
  saveCwData_(cwT, ci, data);
  if (needMail && MailApp.getRemainingDailyQuota() >= 1) {
    MailApp.sendEmail({
      to: cfg.reportEmail,
      subject: '[IELTS Classroom Portal] Phân tích câu hỏi ' + cw[C['Tiêu đề']] + ' – ' + SKILL_NAMES[ctx.k] + ' (' + cw[C['Lớp']] + ')',
      htmlBody: itemReportHtml_(cw, ctx, a, roster),
    });
  }
  return cw[C['Tiêu đề']] + ' – ' + SKILL_NAMES[ctx.k] + ' (' + a.n + ' HS)';
}

function levelDistribution_(a, ctx) {
  const order = [], cnt = {};
  if (ctx.scale.length) ctx.scale.forEach(x => { order.push(x[2]); cnt[x[2]] = 0; });
  a.students.forEach(s => {
    const lv = scaleLevel_(ctx.scale, s.total, a.total);
    const k = lv ? lv.label : s.total + ' câu';
    if (!(k in cnt)) { order.push(k); cnt[k] = 0; }
    cnt[k]++;
  });
  return order.filter(k => cnt[k] || ctx.scale.length).map(k => k + ': ' + cnt[k]).join(' · ');
}

function initItemSheet_() {
  const sh = initTable_(SH.ITEM, ITEM_HEADERS);
  ensureHeaders_(SH.ITEM, ITEM_HEADERS);
  sh.getRange(1, I['Đáp án'] + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  sh.getRange(1, I['p (độ khó)'] + 1, sh.getMaxRows(), 1).setNumberFormat('0.00');
  sh.getRange(1, I['D (phân hoá)'] + 1, sh.getMaxRows(), 1).setNumberFormat('0.00');
  sh.getRange(1, I['Cập nhật'] + 1, sh.getMaxRows(), 1).setNumberFormat('dd/MM/yyyy HH:mm');
  sh.hideColumns(I['CourseWork ID'] + 1);
  sh.setColumnWidth(I['Dự kiến (Teacher\'s Book)'] + 1, 220).setColumnWidth(I['Câu trả lời sai hay gặp'] + 1, 220)
    .setColumnWidth(I['Cần chú ý'] + 1, 260);
  const all = sh.getRange(2, 1, sh.getMaxRows() - 1, ITEM_HEADERS.length);
  const col = c => String.fromCharCode(65 + c);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + col(I['Câu']) + '2="Cả lớp"')
      .setBackground('#e8eaf6').setBold(true).setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEN($' + col(I['Cần chú ý']) + '2)>0')
      .setBackground('#fff2cc').setRanges([all]).build(),
  ]);
  return sh;
}

function writeItemRows_(cw, ctx, a, roster) {
  const sh = sheet_(SH.ITEM).getLastRow() === 0 ? initItemSheet_() : sheet_(SH.ITEM);
  const cwId = String(cw[C['CourseWork ID']]);
  const last = sh.getLastRow();
  // Xoá kết quả cũ của bài/phần này (từ dưới lên)
  if (last > 1) {
    const vals = sh.getRange(2, 1, last - 1, ITEM_HEADERS.length).getValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][I['CourseWork ID']]) === cwId && String(vals[i][I['Phần']]) === ctx.skill) sh.deleteRow(i + 2);
    }
  }
  const now = new Date();
  const base = () => { const r = new Array(ITEM_HEADERS.length).fill(''); r[I['Lớp']] = cw[C['Lớp']]; r[I['Bài tập']] = cw[C['Tiêu đề']]; r[I['Phần']] = ctx.skill; r[I['Cập nhật']] = now; r[I['CourseWork ID']] = cwId; return r; };
  const review = a.items.filter(x => x.p < 0.30).map(x => x.q);
  const check = a.items.filter(x => x.flags.some(f => /^Xem lại/.test(f))).map(x => x.q);
  const sum = base();
  sum[I['Câu']] = 'Cả lớp';
  sum[I['Đáp án']] = 'Điểm TB ' + round2_(a.avg) + '/' + a.total;
  sum[I['Số HS làm']] = a.n;
  sum[I['Sai']] = roster - a.n ? (roster - a.n) + ' HS chưa làm' : '';
  sum[I['Dự kiến (Teacher\'s Book)']] = a.g ? 'Nhóm G/Y: ' + a.g + ' HS mỗi nhóm' + (a.n < 20 ? ' (lớp < 20 HS: chia đôi)' : ' (27%)') : 'Cần ≥ 2 HS để tính D';
  sum[I['Câu trả lời sai hay gặp']] = levelDistribution_(a, ctx);
  sum[I['Cần chú ý']] = [review.length ? 'Chữa kỹ: câu ' + review.join(', ') : '', check.length ? 'Xem lại: câu ' + check.join(', ') : ''].filter(String).join(' · ');
  const rows = [sum];
  a.items.forEach(x => {
    const r = base();
    const inf = ctx.info[x.q] || {};
    r[I['Câu']] = Number(x.q);
    r[I['Đáp án']] = displayKey_(ctx.key[x.q]);
    r[I['Số HS làm']] = a.n;
    r[I['Đúng']] = x.right;
    r[I['Sai']] = x.wrong;
    r[I['p (độ khó)']] = round2_(x.p);
    r[I['Mức độ']] = pLabel_(x.p);
    r[I['D (phân hoá)']] = x.d === null ? '' : round2_(x.d);
    r[I['Độ phân hoá']] = x.d === null ? '' : dLabel_(x.d);
    r[I['Dự kiến (Teacher\'s Book)']] = [inf.level, inf.p !== '' && inf.p !== undefined ? 'p≈' + inf.p : '', inf.d !== '' && inf.d !== undefined ? 'D≈' + inf.d : '', inf.err ? 'Lỗi dự kiến: ' + inf.err : '']
      .filter(String).join(' · ');
    r[I['Câu trả lời sai hay gặp']] = x.common;
    r[I['Cần chú ý']] = x.flags.join('; ');
    rows.push(r);
  });
  const start = sh.getLastRow() + 1;
  sh.getRange(start, I['Đáp án'] + 1, rows.length, 1).setNumberFormat('@'); // giữ nguyên đáp án dạng chữ (VD 2,000)
  sh.getRange(start, 1, rows.length, ITEM_HEADERS.length).setValues(rows);
  sh.getRange(start, I['p (độ khó)'] + 1, rows.length, 1).setNumberFormat('0.00');
  sh.getRange(start, I['D (phân hoá)'] + 1, rows.length, 1).setNumberFormat('0.00');
  sh.getRange(start, I['Cập nhật'] + 1, rows.length, 1).setNumberFormat('dd/MM/yyyy HH:mm');
}

function itemReportHtml_(cw, ctx, a, roster) {
  const f2 = x => (x === null ? '—' : round2_(x).toFixed(2));
  const review = a.items.filter(x => x.p < 0.30), check = a.items.filter(x => x.flags.some(f => /^Xem lại/.test(f)));
  const worst = a.items.filter(x => x.wrong > 0).sort((x, y) => y.wrong - x.wrong).slice(0, 5);
  const qChips = (list, fg, bg, extra) => list.length ? list.map(x => emPill_('Câu ' + esc_(x.q) + (extra ? ' · ' + extra(x) : ''), fg, bg)).join(' ') :
    '<span style="color:' + EM.muted + '">không có</span>';
  const pc = p => p === null ? EM.muted : p < 0.45 ? EM.danger : p < 0.65 ? EM.warning : EM.success;
  const dc = d => d === null ? EM.muted : d < 0.20 ? EM.danger : d < 0.30 ? EM.warning : EM.success;
  let body = emHeader_('Phân tích câu hỏi', esc_(cw[C['Tiêu đề']]) + ' – ' + SKILL_NAMES[ctx.k], esc_(cw[C['Lớp']]));
  body += emRow_(emStats_([
    { v: a.n + '<span style="font-size:15px;color:' + EM.muted + '">/' + roster + '</span>', label: 'HS đã làm' },
    { v: round2_(a.avg) + '<span style="font-size:15px;color:' + EM.muted + '">/' + a.total + '</span>', label: 'điểm trung bình' },
    { v: a.g || '—', label: 'HS mỗi nhóm G/Y' + (a.g ? (a.n < 20 ? ' (chia đôi)' : ' (27%)') : '') },
  ]), '20px 24px 0');
  body += emRow_('<div style="font-size:13px;color:' + EM.muted + '">Phân bố: <span style="color:' + EM.text + '">' + esc_(levelDistribution_(a, ctx)) + '</span></div>' +
    (a.g < 3 ? '<div style="font-size:12px;color:' + EM.muted + ';margin-top:4px"><i>Mỗi nhóm dưới 3 HS nên D chỉ để tham khảo, không dùng để đánh dấu câu.</i></div>' : ''), '10px 28px 0');
  body += emRow_(emBox_('<b>Cần chữa kỹ trên lớp</b> (p &lt; 0.30)<div style="margin-top:6px">' + qChips(review, EM.danger, '#ffffff') + '</div>', 'danger'), '16px 28px 0');
  body += emRow_(emBox_('<b>Nên xem lại câu hỏi / đáp án</b> (D thấp hoặc âm)<div style="margin-top:6px">' + qChips(check, EM.warning, '#ffffff', x => 'D ' + f2(x.d)) + '</div>', 'warn'), '10px 28px 0');
  body += emRow_(emBox_('<b>Nhiều HS sai nhất</b><div style="margin-top:6px">' + qChips(worst, EM.onBrand, '#ffffff', x => x.wrong + ' sai') + '</div>'), '10px 28px 0');

  const th = 'style="padding:8px 6px;text-align:left;font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:' + EM.onBrand + ';background:' + EM.brand + '"';
  let tbl = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:' + EM.font + ';font-size:13px;color:' + EM.text + '">' +
    '<tr><th ' + th + '>Câu</th><th ' + th + '>Đáp án</th><th ' + th + '>Đúng/Sai</th><th ' + th + '>p</th><th ' + th + '>D</th><th ' + th + '>Dự kiến</th><th ' + th + '>Sai hay gặp</th><th ' + th + '>Chú ý</th></tr>';
  a.items.forEach(x => {
    const inf = ctx.info[x.q] || {};
    const exp = [inf.p !== '' && inf.p !== undefined ? 'p≈' + inf.p : '', inf.d !== '' && inf.d !== undefined ? 'D≈' + inf.d : ''].filter(String).join(' ');
    const td = 'style="padding:7px 6px;border-bottom:1px solid ' + EM.border + ';vertical-align:top"';
    tbl += '<tr' + (x.flags.length ? ' style="background:' + EM.warningSoft + '"' : '') + '><td ' + td + '><b>' + esc_(x.q) + '</b></td><td ' + td + '>' + esc_(displayKey_(ctx.key[x.q])) +
      '</td><td ' + td + '><span style="color:' + EM.success + '">' + x.right + '</span>/<span style="color:' + (x.wrong ? EM.danger : EM.muted) + '">' + x.wrong + '</span></td>' +
      '<td ' + td + '><b style="color:' + pc(x.p) + '">' + f2(x.p) + '</b><br><span style="font-size:11px;color:' + EM.muted + '">' + pLabel_(x.p) + '</span></td>' +
      '<td ' + td + '><b style="color:' + dc(x.d) + '">' + f2(x.d) + '</b>' + (x.d === null ? '' : '<br><span style="font-size:11px;color:' + EM.muted + '">' + dLabel_(x.d) + '</span>') + '</td>' +
      '<td ' + td + '><span style="color:' + EM.muted + '">' + esc_(exp) + '</span></td><td ' + td + '>' + esc_(x.common) + '</td>' +
      '<td ' + td + '>' + (x.flags.length ? '<b style="color:' + EM.warning + '">' + esc_(x.flags.join('; ')) + '</b>' : '') + '</td></tr>';
  });
  tbl += '</table>';
  body += emH2_('Chi tiết từng câu');
  body += emRow_('<div style="overflow-x:auto">' + tbl + '</div>', '6px 20px 0');
  body += emRow_('<div style="font-size:12px;line-height:1.6;color:' + EM.muted + '"><b>p</b> = số HS đúng ÷ số HS làm (≥ 0.65 Dễ · 0.45–0.64 Trung bình · &lt; 0.45 Khó).<br>' +
    '<b>D</b> = (đúng nhóm G − đúng nhóm Y) ÷ số HS mỗi nhóm (≥ 0.40 Rất tốt · 0.30–0.39 Tốt · 0.20–0.29 Chấp nhận · &lt; 0.20 Kém).</div>', '14px 28px 0');
  body += emRow_(emButton_(SpreadsheetApp.getActive().getUrl(), 'Mở sheet "Phân tích câu hỏi"'), '18px 28px 26px');
  return emShell_(body, a.n + '/' + roster + ' HS · TB ' + round2_(a.avg) + '/' + a.total + ' · ' + review.length + ' câu cần chữa kỹ', 'Báo cáo tự động sau hạn nộp.', 720);
}

// ---------------------------------------------------------------------------
// FILE PHẠT CỦA LỚP (Done / Late / Missed 10k)
//  Mỗi lớp có 1 file phạt riêng (link ở cột "Link file phạt", sheet Lớp học). Trong file, khối BTVN có:
//   dòng "Tuần …" · dòng buổi "L22 R + W" · dòng kỹ năng Reading/Writing/… · dòng "TT | Họ và tên | ngày" · các dòng HS
//   · dòng "TỔNG HỢP YÊU THƯƠNG" (danh sách bị phạt theo tuần).
//  Sau hạn nộp, hệ thống điền ô còn trống của từng HS × kỹ năng. Không bao giờ ghi đè ô giáo viên đã chọn.
// ---------------------------------------------------------------------------
const PEN = { DONE: 'Done', LATE: 'Late', MISSED: 'Missed 10k', FINE: 10 };
const PEN_SKILL = { R: 'reading', L: 'listening', W: 'writing', S: 'speaking' };
const PEN_SUM_TEMPLATE = /^-\s*Tổng yêu thương tuần:\s*-\s*Danh sách yêu thương:\s*$/i;

/** "Hoàng Quang Vinh" -> ["hoang","quang","vinh"] (bỏ dấu, số, ký tự lạ) */
function nameTokens_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(String);
}

/**
 * Ghép HS trên Classroom ({email, name}) với tên trong file phạt.
 * Ưu tiên: ghép tay đã có trong sheet "Ghép tên HS" -> email trong tab "Danh sách Pairs" -> tên (mọi chữ trong tên Classroom đều có trong tên file phạt, và chỉ khớp 1 người).
 */
function matchPenaltyNames_(roster, sheetNames, pairEmails, manual) {
  const key = n => nameTokens_(n).join(' ');
  const byKey = {};
  sheetNames.forEach(n => { byKey[key(n)] = n; });
  const out = {};
  const claims = {};
  roster.forEach(st => {
    const e = st.email.toLowerCase();
    if (manual[e] !== undefined) { out[e] = { name: manual[e], how: 'giữ nguyên (đã có)' }; return; }
    const pn = pairEmails[e];
    if (pn && byKey[key(pn)]) { out[e] = { name: byKey[key(pn)], how: 'email (Danh sách Pairs)' }; return; }
    const tk = nameTokens_(st.name);
    const cands = tk.length ? sheetNames.filter(n => { const sn = nameTokens_(n); return tk.every(t => sn.indexOf(t) >= 0); }) : [];
    if (cands.length === 1) { out[e] = { name: cands[0], how: 'tên' }; (claims[cands[0]] = claims[cands[0]] || []).push(e); }
    else out[e] = { name: '', how: cands.length ? 'nhiều tên giống: ' + cands.join(' / ') + ' — chọn tay' : 'không tìm thấy trong file phạt' };
  });
  // 2 tài khoản Classroom cùng khớp 1 tên -> không đoán, để giáo viên chọn
  const taken = {};
  Object.keys(out).forEach(e => { if (out[e].name && !/^tên$/.test(out[e].how)) taken[out[e].name] = true; });
  Object.keys(claims).forEach(n => {
    if (claims[n].length > 1 || taken[n]) claims[n].forEach(e => { out[e] = { name: '', how: 'trùng tên "' + n + '" với tài khoản khác — chọn tay' }; });
  });
  return out;
}

/** Đọc các khối BTVN trong file phạt. */
function readPenaltyBook_(ss) {
  const tabs = [], pairEmails = {}, names = {};
  ss.getSheets().forEach(sh => {
    const v = sh.getDataRange().getDisplayValues();
    const tab = { sh, name: sh.getName(), v, blocks: [] };
    if (/pair/i.test(sh.getName())) {
      // Danh sách Pairs: cột Name + Email (nếu có)
      const h = v.findIndex(r => r.some(c => /^name$/i.test(String(c).trim())));
      if (h >= 0) {
        const ni = v[h].findIndex(c => /^name$/i.test(String(c).trim())), ei = v[h].findIndex(c => /^e-?mail$/i.test(String(c).trim()));
        if (ei >= 0) v.slice(h + 1).forEach(r => { if (r[ei] && r[ni]) pairEmails[String(r[ei]).trim().toLowerCase()] = String(r[ni]).trim(); });
      }
      return;
    }
    for (let r = 2; r < v.length; r++) {
      const nc = v[r].findIndex(c => /^họ và tên$/i.test(String(c).trim()));
      if (nc < 0) continue;
      const sessRow = v[r - 2] || [], skillRow = v[r - 1] || [], weekRow = v[r - 3] || [];
      const sessions = [];
      for (let c = nc + 1; c < sessRow.length; c++) {
        const m = String(sessRow[c]).trim().match(/^L\s*(\d+)(?!\d)/i);
        if (!m) continue;
        const cols = [];
        for (let j = c; j < skillRow.length && (j === c || !String(sessRow[j]).trim()); j++) {
          const sk = String(skillRow[j]).trim().toLowerCase();
          if (!/^(reading|listening|writing|speaking)$/.test(sk)) break;
          cols.push({ col: j, skill: sk });
        }
        if (cols.length) sessions.push({ num: Number(m[1]), label: String(sessRow[c]).trim(), col: c, cols });
      }
      if (!sessions.length) continue;
      const students = [];
      let rr = r + 1;
      for (; rr < v.length; rr++) {
        const nm = String(v[rr][nc] || '').trim();
        if (!nm || /^tổng/i.test(nm)) break;
        students.push({ row: rr, name: nm });
        names[nm] = true;
      }
      let sumRow = -1;
      for (let k = rr; k < Math.min(v.length, rr + 6); k++) if (/TỔNG HỢP YÊU THƯƠNG/i.test(String(v[k][nc]))) { sumRow = k; break; }
      const weekStarts = [];
      weekRow.forEach((c, j) => { if (j > nc && /tuần/i.test(String(c))) weekStarts.push(j); });
      tab.blocks.push({ nameRow: r, nameCol: nc, sessions, students, sumRow, weekStarts });
    }
    tabs.push(tab);
  });
  return { tabs, pairEmails, sheetNames: Object.keys(names) };
}

/** Tìm khối + cột của buổi (VD 22) trong file phạt; ưu tiên tab của tháng hạn nộp (VD "T10"). */
function findPenaltySession_(book, num, due) {
  const month = due instanceof Date ? due.getMonth() + 1 : 0;
  const cands = [];
  book.tabs.forEach(tab => tab.blocks.forEach(b => b.sessions.forEach(s => { if (s.num === num) cands.push({ tab, block: b, sess: s }); })));
  if (!cands.length) return null;
  const re = new RegExp('T0?' + month + '(?!\\d)', 'i');
  return cands.filter(x => month && re.test(x.tab.name))[0] || cands[0];
}

/** Kết quả từng kỹ năng của 1 HS trong 1 bài: Done / Late / Missed 10k, hoặc '' (chưa đủ thông tin, để giáo viên xem). */
function penaltyValues_(cw, rows, formCache) {
  const due = cw[C['Hạn nộp']];
  const lateAt = t => t instanceof Date && due instanceof Date && t.getTime() > due.getTime() + 60000;
  const r0 = rows[0];
  const st = r0[S['Trạng thái']];
  const turnedAt = r0[S['Nộp lúc']] instanceof Date ? r0[S['Nộp lúc']] : null;
  const turned = [STATUS.ON_TIME, STATUS.LATE, STATUS.RETURNED].indexOf(st) >= 0;
  const whole = turned ? (st === STATUS.LATE || lateAt(turnedAt) ? PEN.LATE : PEN.DONE) : PEN.MISSED;
  const d = cwData_(cw);
  if (!d.components) return { all: whole }; // bài giao tay trước đây: chỉ biết HS có bấm Nộp hay không

  const res = {};
  const add = (k, v) => { (res[k] = res[k] || []).push(v); };
  rows.forEach(r => {
    const comp = String(r[S['Kỹ năng']]);
    const gs = String(r[S['Trạng thái chấm']] || '');
    if (/^Reading|^Listening/.test(comp)) {
      const k = /^Listening/.test(comp) ? 'L' : 'R';
      const src = rlSource_(cw, comp);
      if (src.formUrl) {
        let resp = null;
        try { resp = getFormResponses_(src.formUrl, formCache)[String(r[S['Email']]).toLowerCase()]; } catch (e) { /* Form lỗi */ }
        add(k, resp ? (lateAt(resp.ts) ? PEN.LATE : PEN.DONE) : PEN.MISSED);
      } else add(k, whole);
    } else if (/^Writing|^Speaking/.test(comp)) {
      const k = /^Writing/.test(comp) ? 'W' : 'S';
      if (!turned) add(k, PEN.MISSED);
      else if (/^Bỏ qua/.test(gs)) add(k, PEN.MISSED);        // nộp nhưng bỏ trống phần này / không có ghi âm
      else if (!gs || /^Lỗi/.test(gs)) add(k, '');            // chưa chấm xong hoặc cần xem tay
      else add(k, whole);
    }
  });
  const out = {};
  Object.keys(res).forEach(k => {
    const a = res[k];
    out[k] = a.indexOf('') >= 0 ? '' : a.indexOf(PEN.MISSED) >= 0 ? PEN.MISSED : a.indexOf(PEN.LATE) >= 0 ? PEN.LATE : PEN.DONE;
  });
  return out;
}

function a1_(row0, col0) {
  let c = col0 + 1, s = '';
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s + (row0 + 1);
}

/**
 * Điền file phạt cho các bài đã hết hạn. dryRun: chỉ báo sẽ điền gì.
 * Trả về { summary (1 dòng cho Nhật ký), report (chi tiết) }.
 */
function fillPenaltySheets_(dryRun) {
  const cfg = getConfig_();
  if (!dryRun) safeStep_('HS mới', syncNewStudents_); // HS mới vào lớp: thêm vào file phạt trước khi ghép tên
  ensureHeaders_(SH.COURSES, COURSE_HEADERS);
  const courses = readTable_(SH.COURSES, COURSE_HEADERS).rows.filter(r => r[0] === true && r[C_LINKPEN_()]);
  if (!courses.length) return { summary: '', report: 'Chưa có lớp nào có "Link file phạt" (sheet Lớp học).' };
  const cwT = readTable_(SH.CW, CW_HEADERS);
  const subT = readTable_(SH.SUB, SUB_HEADERS);
  const mapT = initTable_(SH.PENMAP, PENMAP_HEADERS);
  const mapRows = readTable_(SH.PENMAP, PENMAP_HEADERS).rows;
  const now = Date.now();
  const formCache = {};
  const lines = [], problems = [];
  let nWrite = 0;
  const props = PropertiesService.getScriptProperties();

  courses.forEach(course => {
    const courseId = String(course[4]), className = String(course[1]);
    const ssId = (String(course[C_LINKPEN_()]).match(/\/d\/([\w-]+)/) || [])[1] || String(course[C_LINKPEN_()]).trim();
    let ss;
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { problems.push(className + ': không mở được file phạt (' + e.message + ')'); return; }
    const book = readPenaltyBook_(ss);

    // Ghép tên HS (giữ các ô giáo viên đã điền tay trong sheet "Ghép tên HS")
    const roster = {}, manual = {};
    subT.rows.forEach(r => { if (String(r[S['Course ID']]) === courseId && r[S['Email']]) roster[String(r[S['Email']]).toLowerCase()] = String(r[S['Học sinh']]); });
    mapRows.forEach(r => { if (String(r[0]) === className && r[1] && String(r[3]).trim()) manual[String(r[1]).toLowerCase()] = String(r[3]).trim(); });
    const match = matchPenaltyNames_(Object.keys(roster).map(e => ({ email: e, name: roster[e] })), book.sheetNames, book.pairEmails, manual);
    writePenaltyMap_(mapT, className, roster, match, dryRun);

    // Các bài đã hết hạn trong N ngày
    cwT.rows.forEach((cw, ci) => {
      if (String(cw[C['Course ID']]) !== courseId) return;
      const due = cw[C['Hạn nộp']];
      if (!(due instanceof Date) || due.getTime() > now || now - due.getTime() > cfg.penaltyDays * 86400e3) return;
      const m = String(cw[C['Tiêu đề']]).match(/^\s*L\s*(\d+)/i);
      if (!m) return;
      const found = findPenaltySession_(book, Number(m[1]), due);
      if (!found) { problems.push(className + ' ' + String(cw[C['Tiêu đề']]).trim() + ': file phạt chưa có cột buổi L' + m[1]); return; }
      const { tab, block, sess } = found;
      const byEmail = {};
      subT.rows.forEach(r => { if (String(r[S['CourseWork ID']]) === String(cw[C['CourseWork ID']])) (byEmail[String(r[S['Email']]).toLowerCase()] = byEmail[String(r[S['Email']]).toLowerCase()] || []).push(r); });
      const data = cwData_(cw);
      const prev = data.penalty || {};
      const written = Object.assign({}, prev);
      let nThis = 0, blank = 0;
      Object.keys(byEmail).forEach(email => {
        const who = match[email];
        if (!who || !who.name) return;
        const stRow = block.students.filter(x => x.name === who.name)[0];
        if (!stRow) return;
        const vals = penaltyValues_(cw, byEmail[email], formCache);
        sess.cols.forEach(col => {
          const k = Object.keys(PEN_SKILL).filter(x => PEN_SKILL[x] === col.skill)[0];
          const want = vals.all !== undefined ? vals.all : vals[k];
          if (want === undefined) return;               // kỹ năng không có trong bài
          if (want === '') { blank++; return; }
          const key = email + '|' + col.skill;
          const cur = String(tab.v[stRow.row][col.col] || '').trim();
          if (cur === want) { written[key] = want; return; }
          if (cur && cur !== prev[key]) return;         // giáo viên đã chọn: giữ nguyên
          lines.push((dryRun ? '[xem trước] ' : '') + className + ' · ' + tab.name + '!' + a1_(stRow.row, col.col) + ' · ' + sess.label + ' ' +
            col.skill + ' · ' + who.name + ': ' + (cur ? '"' + cur + '" → ' : '') + want);
          if (!dryRun) tab.sh.getRange(stRow.row + 1, col.col + 1).setValue(want);
          tab.v[stRow.row][col.col] = want;
          written[key] = want;
          nThis++;
        });
      });
      if (blank) problems.push(className + ' ' + String(cw[C['Tiêu đề']]).trim() + ': ' + blank + ' ô chưa điền vì bài chưa chấm xong hoặc cần xem tay');
      nWrite += nThis;
      if (!dryRun && nThis) { data.penalty = written; saveCwData_(cwT, ci, data); }
      if (nThis) updatePenaltySummary_(tab, block, sess.col, dryRun, props, ssId, lines);
    });
  });
  const summary = nWrite ? (dryRun ? 'Xem trước: ' : '') + 'File phạt: điền ' + nWrite + ' ô' : '';
  const report = (lines.length ? lines.join('\n') : 'Không có ô nào cần điền.') + (problems.length ? '\n\nLưu ý:\n- ' + problems.join('\n- ') : '');
  if (!dryRun && (nWrite || problems.length)) log_('File phạt', report);
  return { summary, report };
}

// ---- Tự tạo tab tháng mới trong file phạt ------------------------------------
/** "Tuần 2-7/11" (thứ Hai – thứ Bảy) */
function weekLabel_(mon) {
  const sat = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 5);
  return sat.getMonth() === mon.getMonth()
    ? 'Tuần ' + mon.getDate() + '-' + sat.getDate() + '/' + (mon.getMonth() + 1)
    : 'Tuần ' + mon.getDate() + '/' + (mon.getMonth() + 1) + '-' + sat.getDate() + '/' + (sat.getMonth() + 1);
}

/** Các tuần (thứ Hai) của tháng (month: 0-11); tuần thuộc tháng có ngày thứ Bảy của tuần đó. */
function mondaysOf_(year, month) {
  const out = [];
  for (let d = new Date(year, month, -5); ; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const sat = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 5);
    if (sat.getFullYear() * 12 + sat.getMonth() > year * 12 + month) break;
    if (d.getDay() === 1 && sat.getMonth() === month) out.push(d);
  }
  return out;
}

/** Loại buổi (RW / LS) từ tiêu đề bài trên Classroom, VD "L24 RW" -> RW. */
function sessionTypeFromTitle_(title) {
  const t = String(title).toUpperCase();
  if (/\bRW\b|R\s*\+\s*W|READING/.test(t)) return 'RW';
  if (/\bLS\b|L\s*\+\s*S|LISTENING/.test(t)) return 'LS';
  return '';
}

/**
 * Tab mới cho tháng (month 0-11): nhân bản tab BTVN của tháng trước, xoá dữ liệu cũ của khối BTVN,
 * điền nhãn tuần và tên buổi dự kiến (Lxx R + W / Lxx L + S, nối tiếp buổi cuối của tháng trước).
 */
function createPenaltyMonthTab_(ss, book, year, month, cwTitles) {
  const N = month + 1;
  const reN = new RegExp('T0?' + N + '(?!\\d)', 'i');
  const withBlock = book.tabs.filter(t => t.blocks.length);
  if (withBlock.some(t => reN.test(t.name))) return '';
  const P = month === 0 ? 12 : month;
  const reP = new RegExp('T0?' + P + '(?!\\d)', 'i');
  const src = withBlock.filter(t => reP.test(t.name))[0];
  if (!src) return 'chưa có tab T' + P + ' để nhân bản';
  const newName = src.name.replace(/T0?\d{1,2}(?!\d)/i, 'T' + N);
  if (ss.getSheetByName(newName)) return '';

  const sh = src.sh.copyTo(ss).setName(newName);
  try { ss.setActiveSheet(sh); ss.moveActiveSheet(1); } catch (e) { /* để cuối cũng được */ }

  const notes = [];
  src.blocks.forEach(b => {
    // Tên buổi dự kiến: nối tiếp buổi lớn nhất của tháng trước, xen kẽ R + W / L + S (ưu tiên loại theo bài đã giao trên Classroom)
    const maxS = b.sessions.reduce((m, s) => (s.num > m.num ? s : m), b.sessions[0]);
    const prevType = maxS.cols[0].skill === 'reading' || maxS.cols[0].skill === 'writing' ? 'RW' : 'LS';
    const r = resetPenaltyBlock_(sh, src.v, b, year, month, { prevNum: maxS.num, prevType, cwTitles });
    notes.push('buổi dự kiến: ' + r.labels.join(', '));
    notes.push.apply(notes, r.notes);
  });
  return 'đã tạo tab "' + newName + '" (' + notes.join('; ') + ')';
}

/** Cột đầu của mỗi buổi trong khối (ô kỹ năng Reading/Listening ở dòng ngay trên "Họ và tên"). */
function penaltySlots_(v, b) {
  const skillRow = v[b.nameRow - 1] || [];
  const slots = [];
  let last = -1;
  for (let c = b.nameCol + 1; c < skillRow.length; c++) {
    const sk = String(skillRow[c]).trim().toLowerCase();
    if (/^(reading|listening|writing|speaking)$/.test(sk)) last = c;
    if (sk === 'reading' || sk === 'listening') slots.push(c);
  }
  return { slots, last, skillRow };
}

/**
 * Xoá dữ liệu cũ của 1 khối BTVN (tên buổi, ngày, Done/Missed, nhãn tuần, ô tổng hợp) rồi điền nhãn tuần của tháng
 * và tên buổi nối tiếp o.prevNum (o.prevType = loại buổi trước đó 'RW'/'LS').
 * o.fromDate: bỏ trống tên buổi của các tuần đã qua (lớp mới bắt đầu giữa tháng).
 */
function resetPenaltyBlock_(sh, v, b, year, month, o) {
  const ps = penaltySlots_(v, b);
  const first = ps.slots.length ? Math.min(ps.slots[0], b.sessions.length ? b.sessions[0].col : ps.slots[0]) : b.sessions[0].col;
  const last = Math.max(ps.last, b.sessions.reduce((m, s) => Math.max(m, s.cols[s.cols.length - 1].col), first));
  const width = last - first + 1;
  // Xoá dữ liệu cũ: tên buổi, ngày, Done/Missed của HS, nhãn tuần
  sh.getRange(b.nameRow - 1, first + 1, 1, width).clearContent();               // dòng tên buổi
  sh.getRange(b.nameRow + 1, first + 1, 1, width).clearContent();               // dòng ngày
  if (b.students.length) sh.getRange(b.students[0].row + 1, first + 1, b.students.length, width).clearContent();
  if (b.nameRow >= 3) sh.getRange(b.nameRow - 2, first + 1, 1, width).clearContent(); // dòng "Tuần …"

  const notes = [];
  const weeks = mondaysOf_(year, month);
  b.weekStarts.forEach((c, i) => {
    if (weeks[i]) sh.getRange(b.nameRow - 2, c + 1).setValue(weekLabel_(weeks[i]));
    if (b.sumRow >= 0) sh.getRange(b.sumRow + 1, c + 1).setValue('- Tổng yêu thương tuần: \n- Danh sách yêu thương:\n');
  });
  if (weeks.length > b.weekStarts.length) notes.push('tháng có ' + weeks.length + ' tuần, tab chỉ có ' + b.weekStarts.length + ' khung tuần (' + weekLabel_(weeks[weeks.length - 1]) + ' chưa có chỗ)');

  const today = o.fromDate ? new Date(o.fromDate.getFullYear(), o.fromDate.getMonth(), o.fromDate.getDate()) : null;
  const bounds = b.weekStarts.length ? b.weekStarts.concat([last + 1]) : [first, last + 1];
  let num = o.prevNum, type = o.prevType;
  const labels = [];
  for (let w = 0; w + 1 < bounds.length; w++) {
    const wk = weeks[w];
    if (today && wk && new Date(wk.getFullYear(), wk.getMonth(), wk.getDate() + 5) < today) continue; // tuần đã qua
    ps.slots.filter(c => c >= bounds[w] && c < bounds[w + 1]).forEach(c => {
      num++;
      const toggle = type === 'RW' ? 'LS' : 'RW';
      type = o.cwTitles && o.cwTitles[num] ? (sessionTypeFromTitle_(o.cwTitles[num]) || toggle) : toggle;
      const label = 'L' + num + (type === 'RW' ? ' R + W' : ' L + S');
      sh.getRange(b.nameRow - 1, c + 1).setValue(label);
      if (/^(writing|speaking)$/i.test(String(ps.skillRow[c + 1] || '').trim())) {
        sh.getRange(b.nameRow, c + 1, 1, 2).setValues([type === 'RW' ? ['Reading', 'Writing'] : ['Listening', 'Speaking']]);
      } else sh.getRange(b.nameRow, c + 1).setValue(type === 'RW' ? 'Reading' : 'Listening');
      labels.push(label);
    });
  }
  return { labels, notes };
}

/** Đảm bảo file phạt có tab của tháng này; từ ngày N trong tháng thì tạo luôn tab tháng sau. */
function ensurePenaltyMonthTabs_(now) {
  const cfg = getConfig_();
  now = now || new Date();
  ensureHeaders_(SH.COURSES, COURSE_HEADERS);
  const courses = readTable_(SH.COURSES, COURSE_HEADERS).rows.filter(r => r[0] === true && r[C_LINKPEN_()]);
  const cwRows = readTable_(SH.CW, CW_HEADERS).rows;
  const out = [];
  courses.forEach(course => {
    const className = String(course[1]), courseId = String(course[4]);
    const ssId = (String(course[C_LINKPEN_()]).match(/\/d\/([\w-]+)/) || [])[1] || String(course[C_LINKPEN_()]).trim();
    let ss;
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { out.push(className + ': không mở được file phạt'); return; }
    const cwTitles = {};
    cwRows.forEach(r => {
      if (String(r[C['Course ID']]) !== courseId) return;
      const m = String(r[C['Tiêu đề']]).match(/^\s*L\s*(\d+)/i);
      if (m) cwTitles[Number(m[1])] = String(r[C['Tiêu đề']]);
    });
    const months = [[now.getFullYear(), now.getMonth()]];
    if (now.getDate() >= cfg.penaltyTabDay) months.push(now.getMonth() === 11 ? [now.getFullYear() + 1, 0] : [now.getFullYear(), now.getMonth() + 1]);
    months.forEach(([y, m]) => {
      const msg = createPenaltyMonthTab_(ss, readPenaltyBook_(ss), y, m, cwTitles);
      if (msg) out.push(className + ': ' + msg);
    });
  });
  if (out.length) log_('Tab tháng mới (file phạt)', out.join('\n'));
  return out.join('\n');
}

/** Cột "Link file phạt" trong sheet Lớp học. */
function C_LINKPEN_() { return COURSE_HEADERS.indexOf('Link file phạt'); }

/** noAdd: chỉ cập nhật dòng đã có (xem trước không ghi HS mới, để bước "HS mới" còn nhận ra họ). */
function writePenaltyMap_(sh, className, roster, match, noAdd) {
  const t = readTable_(SH.PENMAP, PENMAP_HEADERS);
  const idx = {};
  t.rows.forEach((r, i) => { if (String(r[0]) === className) idx[String(r[1]).toLowerCase()] = i; });
  const add = [];
  Object.keys(roster).forEach(e => {
    const m = match[e] || { name: '', how: '' };
    if (idx[e] !== undefined) {
      const r = t.rows[idx[e]];
      if (!String(r[3]).trim() && (r[3] !== m.name || r[4] !== m.how)) sh.getRange(idx[e] + 2, 4, 1, 2).setValues([[m.name, m.how]]);
    } else if (!noAdd) add.push([className, e, roster[e], m.name, m.how]);
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, PENMAP_HEADERS.length).setValues(add);
}

/** Viết lại ô "TỔNG HỢP YÊU THƯƠNG" của tuần chứa buổi vừa điền (chỉ khi ô đang trống/mẫu hoặc do hệ thống viết). */
function updatePenaltySummary_(tab, block, sessCol, dryRun, props, ssId, lines) {
  if (block.sumRow < 0 || !block.weekStarts.length) return;
  const ws = block.weekStarts.filter(c => c <= sessCol).pop();
  if (ws === undefined) return;
  const next = block.weekStarts.filter(c => c > ws)[0];
  const lastCol = block.sessions.reduce((m, s) => Math.max(m, s.cols[s.cols.length - 1].col), ws);
  const we = next !== undefined ? next - 1 : lastCol;
  const fines = [];
  let total = 0;
  block.students.forEach(st => {
    let n = 0;
    for (let c = ws; c <= we; c++) if (String(tab.v[st.row][c]).trim() === PEN.MISSED) n++;
    if (n) { fines.push(st.name + ' - ' + n * PEN.FINE + 'k'); total += n * PEN.FINE; }
  });
  const text = '- Tổng yêu thương tuần: ' + total + 'k\n- Danh sách yêu thương:\n' + fines.join('\n');
  const cur = String(tab.v[block.sumRow][ws] || '');
  const pkey = 'PENSUM|' + ssId + '|' + tab.name + '|' + block.sumRow + '|' + ws;
  const mine = props.getProperty(pkey);
  if (cur === text) return;
  if (!(PEN_SUM_TEMPLATE.test(cur.replace(/\s+/g, ' ').trim()) || !cur.trim() || cur === mine)) return; // giáo viên tự viết: giữ nguyên
  lines.push((dryRun ? '[xem trước] ' : '') + tab.name + '!' + a1_(block.sumRow, ws) + ' · Tổng hợp tuần: ' + total + 'k (' + fines.length + ' HS)');
  if (dryRun) return;
  tab.sh.getRange(block.sumRow + 1, ws + 1).setValue(text);
  tab.v[block.sumRow][ws] = text;
  props.setProperty(pkey, text);
}

// ---------------------------------------------------------------------------
// LỚP MỚI: TỰ TẠO FILE PHẠT, THÊM HỌC SINH MỚI, THÊM LỚP VÀO WEB WRITING
// ---------------------------------------------------------------------------
function ssIdFrom_(link) {
  const s = String(link || '').trim();
  return (s.match(/\/d\/([\w-]+)/) || [])[1] || s;
}

/** "K233 5.5 TC - BTVN" -> "K233 TC" (giống tên file phạt các lớp cũ: "Check BTVN - K232 TM"). */
function shortClassCode_(name) {
  const base = String(name || '').replace(/\s*-\s*BTVN\s*$/i, '').trim();
  const short = base.split(/\s+/).filter(t => !/^\d+([.,]\d+)?$/.test(t)).join(' ');
  return short || base;
}

/** Tên lớp trên web Writing: tên lớp Classroom bỏ đuôi " - BTVN". */
function writingClassLabel_(name) {
  return String(name || '').replace(/\s*-\s*BTVN\s*$/i, '').trim().slice(0, 80) || String(name).slice(0, 80);
}

/** Tên HS trên Classroom -> tên ghi vào file phạt (bỏ số thứ tự ở đầu, VD "31.Dương Văn Tiến"). */
function cleanStudentName_(name) {
  return String(name || '').replace(/^[\d\s.)\-_]+(?=\S)/, '').replace(/\s+/g, ' ').trim();
}

/** Danh sách HS của lớp trên Classroom: [{ email, name }] (theo tên). */
function classroomRoster_(courseId) {
  const out = [];
  listAll_(tok => Classroom.Courses.Students.list(courseId, { pageSize: 100, pageToken: tok }), 'students').forEach(st => {
    const email = String((st.profile && st.profile.emailAddress) || '').trim().toLowerCase();
    const name = (st.profile && st.profile.name && st.profile.name.fullName) || '';
    if (email) out.push({ email, name: cleanStudentName_(name) || email });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

/**
 * Tài khoản không phải học sinh thật (tài khoản thử của giáo viên…): email của bạn, hoặc email đã có trong sheet
 * "Ghép tên HS" ở lớp khác nhưng chưa bao giờ ghép được với 1 tên trong file phạt.
 */
function nonStudentEmails_(mapRows, exceptClass) {
  const seen = {}, real = {};
  mapRows.forEach(r => {
    const e = String(r[1] || '').trim().toLowerCase();
    if (!e || String(r[0]) === exceptClass) return;
    seen[e] = true;
    const n = String(r[3] || '').trim();
    if (n && !/^\(bỏ qua\)$/i.test(n)) real[e] = true;
  });
  const out = {};
  Object.keys(seen).forEach(e => { if (!real[e]) out[e] = true; });
  try { out[Session.getEffectiveUser().getEmail().toLowerCase()] = true; } catch (e) { /* bỏ qua */ }
  return out;
}

/**
 * Đổi số dòng HS của 1 khối BTVN thành n: thêm/xoá dòng ở giữa khối (giữ dòng đầu và dòng cuối để công thức
 * kiểu =COUNTIF(C31:F45, …) tự co giãn), dòng thêm mới chép định dạng + danh sách chọn (Done/Late/Missed) của dòng đầu.
 * Trả về số dòng (1-based) của HS đầu tiên.
 */
function resizePenaltyBlock_(sh, b, n) {
  const m = b.students.length;
  if (!m) throw new PermanentError('khối BTVN không có dòng học sinh nào để làm mẫu');
  const firstRow = b.students[0].row + 1;
  if (n > m) {
    const after = m >= 2 ? b.students[m - 2].row + 1 : firstRow;
    sh.insertRowsAfter(after, n - m);
    const cols = sh.getMaxColumns();
    const src = sh.getRange(firstRow, 1, 1, cols), dst = sh.getRange(after + 1, 1, n - m, cols);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  } else if (n < m) {
    sh.deleteRows(m >= 2 ? b.students[1].row + 1 : firstRow, m - n);
  }
  return firstRow;
}

/** Cột STT/TT bên trái cột "Họ và tên" (nếu có). */
function penaltyTtCol_(v, b) {
  const c = b.nameCol - 1;
  return c >= 0 && /^s?tt$/i.test(String((v[b.nameRow] || [])[c] || '').trim()) ? c : -1;
}

/** Tab "Danh sách Pairs": xoá dữ liệu lớp mẫu, ghi Name + Email của lớp mới (cột Pair/SĐT để trống cho giáo viên). */
function resetPairsTab_(sh, students, fromCode, toCode) {
  const v = sh.getDataRange().getDisplayValues();
  const h = v.findIndex(r => r.some(c => /^name$/i.test(String(c).trim())));
  if (h < 0) return;
  const ni = v[h].findIndex(c => /^name$/i.test(String(c).trim())), ei = v[h].findIndex(c => /^e-?mail$/i.test(String(c).trim()));
  const width = v[h].length;
  const lastRow = Math.max(sh.getLastRow(), h + 2);
  if (lastRow > h + 1) {
    const data = sh.getRange(h + 2, 1, lastRow - h - 1, width);
    data.breakApart();
    data.clearContent();
  }
  if (students.length) {
    const rows = students.map(st => { const r = new Array(width).fill(''); r[ni] = st.name; if (ei >= 0) r[ei] = st.email; return r; });
    sh.getRange(h + 2, 1, rows.length, width).setValues(rows);
  }
  if (fromCode && toCode) {
    for (let r = 0; r < h; r++) v[r].forEach((c, j) => {
      if (String(c).indexOf(fromCode) >= 0) sh.getRange(r + 1, j + 1).setValue(String(c).split(fromCode).join(toCode));
    });
  }
}

/**
 * Tạo file phạt cho lớp mới bằng cách nhân bản file phạt của lớp mẫu:
 *  - giữ tab BTVN của tháng này (đổi tên theo tháng) + tab Danh sách Pairs, xoá các tab tháng khác;
 *  - xoá phần nằm trên khối BTVN (bài tập thêm của HS lớp mẫu);
 *  - thay danh sách HS bằng HS trên Classroom, xoá dữ liệu cũ, điền tên buổi từ opts.startLesson (opts.startType 'RW'/'LS');
 *  - chia sẻ giống file mẫu.
 * Trả về { url, name, message }.
 */
function createClassPenaltyFile_(course, templateLink, students, opts) {
  const now = opts.now || new Date();
  const tplFile = DriveApp.getFileById(ssIdFrom_(templateLink));
  const parents = tplFile.getParents();
  const folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const code = shortClassCode_(course.name);
  const tplCode = String(tplFile.getName()).replace(/^.*?-\s*/, '').trim();
  const file = tplFile.makeCopy('Check BTVN - ' + code, folder);
  const notes = [];
  try { file.setSharing(tplFile.getSharingAccess(), tplFile.getSharingPermission()); } catch (e) { /* tài khoản không cho đổi chia sẻ */ }
  try {
    const owner = (tplFile.getOwner() && tplFile.getOwner().getEmail() || '').toLowerCase();
    const editors = tplFile.getEditors().map(u => u.getEmail()).filter(e => e && e.toLowerCase() !== owner);
    if (editors.length) { file.addEditors(editors); notes.push('chia sẻ quyền sửa cho ' + editors.length + ' người như file mẫu'); }
  } catch (e) { /* bỏ qua */ }

  const ss = SpreadsheetApp.openById(file.getId());
  let book = readPenaltyBook_(ss);
  const withBlock = book.tabs.filter(t => t.blocks.length);
  if (!withBlock.length) throw new PermanentError('File phạt mẫu không có khối BTVN (dòng "Họ và tên" + các buổi Lxx)');
  const N = now.getMonth() + 1;
  const reN = new RegExp('T0?' + N + '(?!\\d)', 'i');
  const keep = withBlock.filter(t => reN.test(t.name))[0] || withBlock[0];
  // Xoá các tab theo tháng khác (dữ liệu của lớp mẫu), giữ tab Pairs và các tab không theo tháng
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    if (name === keep.name || /pair/i.test(name)) return;
    if (/T0?\d{1,2}(?!\d)/i.test(name) || book.tabs.some(t => t.name === name && t.blocks.length)) ss.deleteSheet(sh);
  });
  const tabName = /T0?\d{1,2}(?!\d)/i.test(keep.name) ? keep.name.replace(/T0?\d{1,2}(?!\d)/i, 'T' + N) : keep.name;
  if (tabName !== keep.name) keep.sh.setName(tabName);
  // Phần nằm trên khối BTVN đầu tiên (bảng bài tập thêm của HS lớp mẫu)
  const top = keep.blocks[0].nameRow - 3;
  if (top > 0) { keep.sh.deleteRows(1, top); notes.push('bỏ phần bài tập thêm của lớp mẫu phía trên bảng BTVN'); }

  // Danh sách HS: đổi số dòng (khối dưới trước để không lệch dòng), rồi ghi STT + tên
  const n = Math.max(students.length, 1);
  let tab = readPenaltyBook_(ss).tabs.filter(t => t.name === tabName)[0];
  tab.blocks.slice().sort((a, b) => b.nameRow - a.nameRow).forEach(b => {
    const ttCol = penaltyTtCol_(tab.v, b);
    const firstRow = resizePenaltyBlock_(tab.sh, b, n);
    tab.sh.getRange(firstRow, b.nameCol + 1, n, 1).setValues(students.length ? students.map(s => [s.name]) : [['(chưa có HS)']]);
    if (ttCol >= 0) tab.sh.getRange(firstRow, ttCol + 1, n, 1).setValues(Array.from({ length: n }, (_, i) => [i + 1]));
  });
  SpreadsheetApp.flush();

  // Tên buổi + nhãn tuần + xoá dữ liệu cũ; link Classroom ở ô đầu dòng "Tuần"
  tab = readPenaltyBook_(ss).tabs.filter(t => t.name === tabName)[0];
  const startType = opts.startType === 'LS' ? 'LS' : 'RW';
  const labels = [];
  tab.blocks.forEach(b => {
    const r = resetPenaltyBlock_(tab.sh, tab.v, b, now.getFullYear(), now.getMonth(),
      { prevNum: opts.startLesson - 1, prevType: startType === 'RW' ? 'LS' : 'RW', cwTitles: opts.cwTitles || {}, fromDate: now });
    labels.push.apply(labels, r.labels);
    notes.push.apply(notes, r.notes);
    const wr = b.nameRow - 3;
    if (wr >= 0) (tab.v[wr] || []).slice(0, b.nameCol + 1).forEach((c, j) => {
      if (/classroom\.google\.com/.test(String(c))) tab.sh.getRange(wr + 1, j + 1).setValue(String(c).replace(/https?:\/\/classroom\.google\.com\S*/g, course.link));
    });
  });
  const pairs = ss.getSheets().filter(sh => /pair/i.test(sh.getName()))[0];
  if (pairs) resetPairsTab_(pairs, students, tplCode, code);
  try { ss.setActiveSheet(tab.sh); ss.moveActiveSheet(1); } catch (e) { /* bỏ qua */ }
  return {
    url: ss.getUrl(), name: file.getName(),
    message: 'Đã tạo file phạt "' + file.getName() + '" (' + students.length + ' HS, tab "' + tabName + '"' +
      (labels.length ? ', buổi: ' + labels.join(', ') : '') + (notes.length ? '; ' + notes.join('; ') : '') + ')',
  };
}

/**
 * Thêm HS mới vào file phạt: 1 dòng trong mỗi khối BTVN của tab tháng này và tháng sau (nếu đã có), và 1 dòng ở tab Pairs.
 * Dòng mới chèn trước HS cuối khối (để công thức tổng tự mở rộng), rồi đánh lại STT.
 */
function addStudentsToPenaltyBook_(ss, book, students, now) {
  const months = [now.getMonth() + 1, now.getMonth() === 11 ? 1 : now.getMonth() + 2];
  const withBlock = book.tabs.filter(t => t.blocks.length);
  let tabs = withBlock.filter(t => months.some(m => new RegExp('T0?' + m + '(?!\\d)', 'i').test(t.name)));
  if (!tabs.length) tabs = withBlock.slice(0, 1);
  const k = students.length;
  tabs.forEach(tab => {
    tab.blocks.slice().sort((a, b) => b.nameRow - a.nameRow).forEach(b => {
      const m = b.students.length;
      if (!m) return;
      const ttCol = penaltyTtCol_(tab.v, b);
      const after = m >= 2 ? b.students[m - 2].row + 1 : b.students[0].row + 1;
      tab.sh.insertRowsAfter(after, k);
      const cols = tab.sh.getMaxColumns();
      const src = tab.sh.getRange(b.students[0].row + 1, 1, 1, cols), dst = tab.sh.getRange(after + 1, 1, k, cols);
      src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
      tab.sh.getRange(after + 1, b.nameCol + 1, k, 1).setValues(students.map(s => [s.name]));
      if (ttCol >= 0) tab.sh.getRange(b.students[0].row + 1, ttCol + 1, m + k, 1).setValues(Array.from({ length: m + k }, (_, i) => [i + 1]));
    });
  });
  const pairs = book.tabs.filter(t => /pair/i.test(t.name))[0] || null;
  const pairSh = pairs ? pairs.sh : ss.getSheets().filter(sh => /pair/i.test(sh.getName()))[0];
  if (pairSh) {
    const v = pairSh.getDataRange().getDisplayValues();
    const h = v.findIndex(r => r.some(c => /^name$/i.test(String(c).trim())));
    if (h >= 0) {
      const ni = v[h].findIndex(c => /^name$/i.test(String(c).trim())), ei = v[h].findIndex(c => /^e-?mail$/i.test(String(c).trim()));
      let last = h;
      for (let r = h + 1; r < v.length; r++) if (v[r].some(c => String(c).trim())) last = r;
      students.forEach((st, i) => {
        pairSh.getRange(last + 2 + i, ni + 1).setValue(st.name);
        if (ei >= 0) pairSh.getRange(last + 2 + i, ei + 1).setValue(st.email);
      });
    }
  }
  return tabs.map(t => t.name);
}

/**
 * Mỗi giờ: HS mới vào lớp đang theo dõi (lần đầu xuất hiện trong bài nộp) ->
 *  - file phạt: nếu chưa có tên trong file thì thêm dòng (tab tháng này + tháng sau + Pairs) và ghi vào "Ghép tên HS";
 *  - web Writing: thêm vào lớp tương ứng (nếu lớp đã được thêm vào web Writing).
 * Chỉ áp dụng cho lớp đã có sẵn dữ liệu "Ghép tên HS" (để không thêm nhầm HS cũ chưa ghép được tên).
 */
function syncNewStudents_() {
  ensureHeaders_(SH.COURSES, COURSE_HEADERS);
  const courses = readTable_(SH.COURSES, COURSE_HEADERS).rows.filter(r => r[0] === true && r[4]);
  if (!courses.length) return '';
  const subRows = readTable_(SH.SUB, SUB_HEADERS).rows;
  const mapSh = initTable_(SH.PENMAP, PENMAP_HEADERS);
  const mapRows = readTable_(SH.PENMAP, PENMAP_HEADERS).rows;
  const props = PropertiesService.getScriptProperties();
  const now = new Date();
  const out = [];
  courses.forEach(course => {
    const courseId = String(course[4]), className = String(course[1]);
    const roster = {};
    subRows.forEach(r => { if (String(r[S['Course ID']]) === courseId && r[S['Email']]) roster[String(r[S['Email']]).trim().toLowerCase()] = String(r[S['Học sinh']]); });
    const skip = nonStudentEmails_(mapRows, className);

    if (course[C_LINKPEN_()]) {
      const known = {};
      let any = false;
      mapRows.forEach(r => { if (String(r[0]) === className) { any = true; known[String(r[1]).trim().toLowerCase()] = true; } });
      const newcomers = any ? Object.keys(roster).filter(e => !known[e] && !skip[e]) : [];
      if (newcomers.length) {
        let ss;
        try { ss = SpreadsheetApp.openById(ssIdFrom_(course[C_LINKPEN_()])); } catch (e) { out.push(className + ': không mở được file phạt'); return; }
        const book = readPenaltyBook_(ss);
        const match = matchPenaltyNames_(newcomers.map(e => ({ email: e, name: roster[e] })), book.sheetNames, book.pairEmails, {});
        const toAdd = newcomers.filter(e => !match[e].name && /không tìm thấy/.test(match[e].how))
          .map(e => ({ email: e, name: cleanStudentName_(roster[e]) || e }));
        if (toAdd.length) {
          const tabs = addStudentsToPenaltyBook_(ss, book, toAdd, now);
          toAdd.forEach(st => { match[st.email] = { name: st.name, how: 'HS mới — đã thêm vào file phạt' }; });
          out.push(className + ': thêm ' + toAdd.map(s => s.name).join(', ') + ' vào file phạt (' + tabs.join(', ') + ')');
        }
        const sub = {};
        newcomers.forEach(e => { sub[e] = roster[e]; });
        writePenaltyMap_(mapSh, className, sub, match);
      }
    }

    const label = props.getProperty('WRCLASS_' + courseId);
    if (label) {
      const list = Object.keys(roster).filter(e => !skip[e]).sort();
      const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, label + '|' + list.join(',')));
      if (list.length && props.getProperty('WRCLASS_H_' + courseId) !== hash) {
        try {
          const r = ensureWritingClass_(label, list.map(e => ({ email: e, name: cleanStudentName_(roster[e]) || e })));
          props.setProperty('WRCLASS_H_' + courseId, hash);
          if (r.added) out.push(className + ': thêm ' + r.added + ' HS vào lớp "' + r.label + '" trên web Writing');
        } catch (e) { out.push(className + ': chưa thêm được HS vào web Writing (' + e.message + ')'); }
      }
    }
  });
  if (out.length) log_('HS mới', out.join('\n'));
  return out.length ? out.length + ' cập nhật HS mới' : '';
}

/** Web Writing: tạo lớp (hoặc dùng lớp cùng tên) và xếp HS chưa có lớp vào đó. */
function ensureWritingClass_(label, students) {
  const conn = writingConn_();
  if (!conn) throw new PermanentError('chưa kết nối web chấm Writing (menu IELTS Checker > 3)');
  return callWritingApi_(conn, 'portal.classes.ensure', { label, students: students.slice(0, 200) });
}

// ---- Web: lớp mới chờ xác nhận ----
function pNewCourses_() {
  ensureHeaders_(SH.COURSES, COURSE_HEADERS);
  const st = COURSE_HEADERS.indexOf('Trạng thái');
  return readTable_(SH.COURSES, COURSE_HEADERS).rows
    .filter(r => r[4] && r[0] !== true && String(r[st]) === COURSE_STATE.NEW)
    .map(r => ({ id: String(r[4]), name: String(r[1]), section: String(r[2] || ''), link: String(r[5] || ''), students: Number(r[3]) || 0 }));
}

function pCourseRow_(courseId) {
  const t = readTable_(SH.COURSES, COURSE_HEADERS);
  const i = t.rows.findIndex(r => String(r[4]) === String(courseId || ''));
  if (i < 0) throw new PortalError('not_found', 'Không tìm thấy lớp này trong sheet Lớp học.');
  return { t, i, row: t.rows[i] };
}

/** Kiểm tra lớp Classroom: tìm lớp mới ngay (không chờ job mỗi giờ). */
function portalRefreshCourses_() {
  const r = refreshCourses_();
  return { added: r.added, newClasses: pNewCourses_() };
}

/**
 * Bắt đầu theo dõi 1 lớp mới: { courseId, createPenalty, templateCourseId, startLesson, startType ('RW'|'LS'), addToWriting }.
 */
function portalTrackCourse_(p) {
  const { t, i, row } = pCourseRow_(p.courseId);
  const course = { id: String(row[4]), name: String(row[1]), link: String(row[5] || '') };
  const lines = [];
  let penaltyLink = String(row[C_LINKPEN_()] || '');
  const needRoster = p.createPenalty || p.addToWriting;
  const mapRows = readTable_(SH.PENMAP, PENMAP_HEADERS).rows;
  const skip = nonStudentEmails_(mapRows, course.name);
  const roster = needRoster ? classroomRoster_(course.id) : [];
  const students = roster.filter(s => !skip[s.email]);
  const skipped = roster.filter(s => skip[s.email]);

  if (p.createPenalty && !penaltyLink) {
    const tpl = t.rows.filter(r => String(r[4]) === String(p.templateCourseId || '') && r[C_LINKPEN_()])[0];
    if (!tpl) throw new PortalError('bad_request', 'Chọn lớp mẫu đã có file phạt.');
    const startLesson = Math.floor(Number(p.startLesson));
    if (!(startLesson >= 1 && startLesson <= 300)) throw new PortalError('bad_request', 'Buổi bắt đầu phải là số từ 1 đến 300.');
    const res = createClassPenaltyFile_(course, tpl[C_LINKPEN_()], students, { startLesson, startType: p.startType === 'LS' ? 'LS' : 'RW' });
    penaltyLink = res.url;
    t.sh.getRange(i + 2, C_LINKPEN_() + 1).setValue(penaltyLink);
    // "Ghép tên HS": tên trong file = tên Classroom; tài khoản không phải HS ghi sẵn để không bị thêm vào file sau này
    const mapSh = initTable_(SH.PENMAP, PENMAP_HEADERS);
    const names = {}, match = {};
    students.forEach(s => { names[s.email] = s.name; match[s.email] = { name: s.name, how: 'tên (file tự tạo)' }; });
    skipped.forEach(s => { names[s.email] = s.name; match[s.email] = { name: '', how: 'không phải HS (tài khoản thử?) — không đưa vào file phạt' }; });
    writePenaltyMap_(mapSh, course.name, names, match);
    lines.push(res.message);
  } else if (p.createPenalty) lines.push('Lớp đã có file phạt — giữ nguyên.');

  if (p.addToWriting) {
    const label = writingClassLabel_(course.name);
    try {
      const r = ensureWritingClass_(label, students.map(s => ({ email: s.email, name: s.name })));
      PropertiesService.getScriptProperties().setProperty('WRCLASS_' + course.id, label);
      lines.push('Web Writing: ' + (r.created ? 'đã tạo lớp "' : 'dùng lớp có sẵn "') + r.label + '", xếp ' + r.added + ' HS vào lớp' +
        (r.keptInOtherClass ? ' (' + r.keptInOtherClass + ' HS đang ở lớp khác, giữ nguyên)' : ''));
    } catch (e) {
      PropertiesService.getScriptProperties().setProperty('WRCLASS_' + course.id, label); // job mỗi giờ sẽ thử lại
      lines.push('Web Writing: chưa thêm được lớp (' + e.message + ') — hệ thống sẽ tự thử lại mỗi giờ.');
    }
  }
  if (skipped.length) lines.push('Không tính là HS: ' + skipped.map(s => s.email).join(', '));

  if (p.fromToday !== false) {
    PropertiesService.getScriptProperties().setProperty('TRACK_FROM_' + course.id, new Date().toISOString());
    lines.push('Bài giao trước hôm nay chỉ được theo dõi nộp bài, không tự chấm và không gửi lên web Writing.');
  } else {
    PropertiesService.getScriptProperties().setProperty('TRACK_FROM_' + course.id, '0');
  }
  t.sh.getRange(i + 2, 1).setValue(true);
  t.sh.getRange(i + 2, COURSE_HEADERS.indexOf('Trạng thái') + 1).setValue(COURSE_STATE.ON);
  if (roster.length) t.sh.getRange(i + 2, 4).setValue(roster.length);
  lines.unshift('Đã bắt đầu theo dõi "' + course.name + '". Bài tập và bài nộp sẽ được đồng bộ ở lần chạy tự động tiếp theo (tối đa 1 giờ).');
  log_('Lớp mới', lines.join('\n'));
  return { message: lines.join('\n'), penaltyLink };
}

function portalIgnoreCourse_(p) {
  const { t, i } = pCourseRow_(p.courseId);
  t.sh.getRange(i + 2, 1).setValue(false);
  t.sh.getRange(i + 2, COURSE_HEADERS.indexOf('Trạng thái') + 1).setValue(COURSE_STATE.IGNORED);
  return { ignored: true };
}

// ---------------------------------------------------------------------------
// GỬI NHẬN XÉT ĐÃ DUYỆT
// ---------------------------------------------------------------------------
function sendApprovedFeedback_() {
  const cfg = getConfig_();
  const t = readTable_(SH.SUB, SUB_HEADERS);
  let sent = 0, skipped = 0;
  let cwById = null, keys = null, info = null;
  const formCache = {};
  for (let i = 0; i < t.rows.length; i++) {
    const r = t.rows[i];
    if (r[S['Duyệt gửi']] !== true || r[S['Đã gửi lúc']] || !r[S['Email']]) continue;
    if (/web/i.test(String(r[S['Trạng thái chấm']]))) continue; // web chấm Writing tự gửi email kết quả
    if (MailApp.getRemainingDailyQuota() < 1) { skipped++; continue; }
    if (timeUp_()) break;
    // Reading/Listening có đáp án: gửi bản đầy đủ (câu sai + giải thích)
    if (/^Reading|^Listening/.test(String(r[S['Kỹ năng']])) && String(r[S['Trạng thái chấm']]) === 'Đã chấm') {
      if (!cwById) {
        cwById = {};
        readTable_(SH.CW, CW_HEADERS).rows.forEach(w => { cwById[String(w[C['CourseWork ID']])] = w; });
        keys = loadAnswerKeys_(); info = loadKeyInfo_();
      }
      const w = cwById[String(r[S['CourseWork ID']])];
      const ctx = w ? rlContext_(w, String(r[S['Kỹ năng']]), keys, info) : null;
      if (ctx) {
        let answers = null;
        if (ctx.formUrl) {
          const resp = getFormResponses_(ctx.formUrl, formCache)[String(r[S['Email']]).toLowerCase()];
          answers = resp ? resp.answers : null;
        }
        const mail = rlResultEmail_(r, ctx, answers, cfg);
        MailApp.sendEmail({ to: r[S['Email']], subject: mail.subject, body: mail.text, htmlBody: mail.html, name: cfg.teacherName || undefined });
        t.sh.getRange(i + 2, S['Đã gửi lúc'] + 1).setValue(new Date());
        sent++;
        continue;
      }
    }
    const attachments = [];
    const m = String(r[S['File nhận xét']] || '').match(/\/d\/([\w-]+)/);
    if (m) {
      try { attachments.push(DriveApp.getFileById(m[1]).getAs(MimeType.PDF).setName('Nhan xet - ' + r[S['Bài tập']] + '.pdf')); }
      catch (e) { /* gửi không đính kèm */ }
    }
    if (String(r[S['Kỹ năng']]) === 'Speaking') { try { recordSpeakingFinal_(r); } catch (e) { /* bỏ qua */ } }
    const mail = feedbackEmail_(r, cfg, attachments.length > 0);
    MailApp.sendEmail({
      to: r[S['Email']], subject: mail.subject, body: mail.text, htmlBody: mail.html,
      attachments, name: cfg.teacherName || undefined,
    });
    t.sh.getRange(i + 2, S['Đã gửi lúc'] + 1).setValue(new Date());
    sent++;
  }
  return sent || skipped ? 'Đã gửi ' + sent + ' nhận xét' + (skipped ? ', ' + skipped + ' chờ vì hết hạn mức email hôm nay' : '') + '.' : '';
}

// ---------------------------------------------------------------------------
// NHẮC NHỞ & BÁO CÁO
// ---------------------------------------------------------------------------
function sendReminders_() {
  const cfg = getConfig_();
  const tz = Session.getScriptTimeZone();
  const t = readTable_(SH.SUB, SUB_HEADERS);
  const now = Date.now();
  const today = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const byEmail = {};
  const cwLinks = {};
  readTable_(SH.CW, CW_HEADERS).rows.forEach(w => { cwLinks[String(w[C['CourseWork ID']])] = String(w[C['Link']] || ''); });
  t.rows.forEach((r, i) => {
    const st = r[S['Trạng thái']];
    const due = r[S['Hạn nộp']];
    if (!r[S['Email']] || !(due instanceof Date) || [STATUS.NOT_YET, STATUS.MISSING].indexOf(st) < 0) return;
    const last = r[S['Nhắc lần cuối']];
    if (last instanceof Date && Utilities.formatDate(last, tz, 'yyyyMMdd') === today) return;
    const diff = due.getTime() - now;
    let kind = null;
    if (diff > 0 && diff <= cfg.remindBeforeH * 3600e3) kind = 'soon';
    else if (diff <= 0 && cfg.remindOverdue && -diff <= cfg.remindMaxDays * 86400e3) kind = 'late';
    if (!kind) return;
    const e = String(r[S['Email']]);
    const g = byEmail[e] = byEmail[e] || { name: r[S['Học sinh']], items: [], rows: [], seen: {} };
    g.rows.push(i);
    const cwId = String(r[S['CourseWork ID']]);
    const formDone = /^Đã chấm/.test(String(r[S['Trạng thái chấm']] || '')) && /^Reading|^Listening/.test(String(r[S['Kỹ năng']]));
    if (!g.seen[cwId]) { g.seen[cwId] = { formDone }; g.items.push({ i, r, kind, link: cwLinks[cwId] || '', state: g.seen[cwId] }); } // bài gộp: nhắc 1 lần
    else if (formDone) g.seen[cwId].formDone = true;
  });

  let sent = 0, skipped = 0;
  const stamp = new Date();
  Object.keys(byEmail).forEach(email => {
    if (MailApp.getRemainingDailyQuota() < 1) { skipped++; return; }
    const g = byEmail[email];
    const mail = reminderEmail_(g, cfg, tz, now);
    MailApp.sendEmail({ to: email, subject: mail.subject, body: mail.text, htmlBody: mail.html, name: cfg.teacherName || undefined });
    g.rows.forEach(i => t.sh.getRange(i + 2, S['Nhắc lần cuối'] + 1).setValue(stamp));
    sent++;
  });
  return 'Đã gửi nhắc nhở cho ' + sent + ' học sinh' + (skipped ? ', ' + skipped + ' chưa gửi được vì hết hạn mức email' : '') + '.';
}

// ---- Kiểm tra sức khoẻ hệ thống (chạy cùng báo cáo ngày; giáo viên bấm "Kiểm tra ngay" trên Tổng quan) ----
/**
 * - Trang web cần bản nào (version.json trên GitHub Pages) và 2 web app đang chạy bản nào
 * - Web Writing có trả lời không
 * - Lỗi trình duyệt / lỗi portal trong 24 giờ qua (sheet Nhật ký)
 * - Trigger tự động còn không
 * Lưu kết quả vào Script Properties (HEALTH_LAST) để trang Tổng quan hiện lại.
 */
function healthCheck_() {
  const cfg = getConfig_();
  const problems = [], notes = [];
  let expected = null;
  try {
    const r = UrlFetchApp.fetch(cfg.writingAppUrl + 'version.json?t=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
    if (r.getResponseCode() === 200) expected = JSON.parse(r.getContentText());
    else notes.push('Không đọc được version.json của trang web (HTTP ' + r.getResponseCode() + ').');
  } catch (e) { notes.push('Không đọc được version.json của trang web: ' + e.message); }

  let writingVersion = null;
  try {
    const p = PropertiesService.getScriptProperties();
    const res = rawWritingCall_(p.getProperty('WRITING_API_URL') || DEFAULT_WRITING_API, { action: 'config.get' });
    if (res && res.ok) writingVersion = String((res.data && res.data.serverVersion) || 'cũ (chưa báo phiên bản)');
    else problems.push('Web app Writing trả lỗi: ' + ((res && res.error && res.error.message) || 'không rõ'));
  } catch (e) { problems.push('Không gọi được web app Writing: ' + e.message); }

  if (expected && writingVersion && expected.backend && writingVersion !== expected.backend) {
    problems.push('Web app Writing đang chạy bản ' + writingVersion + ', trang web cần bản ' + expected.backend +
      ' → mở dự án "IELTS Writing Checker" > Triển khai > Quản lý tùy chọn triển khai > bút chì > Phiên bản mới > Triển khai.');
  }
  if (expected && expected.classroom && expected.classroom !== CLASSROOM_VERSION) {
    problems.push('Code của hệ thống Lớp học là bản ' + CLASSROOM_VERSION + ', trang web cần bản ' + expected.classroom + '.');
  }

  // Lỗi trong 24 giờ qua
  try {
    const sh = sheet_(SH.LOG), last = sh.getLastRow();
    if (last > 1) {
      const since = Date.now() - 86400e3;
      const rows = sh.getRange(Math.max(2, last - 499), 1, Math.min(500, last - 1), 3).getValues()
        .filter(r => r[0] instanceof Date && r[0].getTime() >= since);
      const client = rows.filter(r => r[1] === LOG_CLIENT_ERROR), portal = rows.filter(r => r[1] === LOG_PORTAL_ERROR);
      if (client.length) problems.push(client.length + ' lỗi hiển thị trên trang web trong 24 giờ qua (sheet Nhật ký, dòng "' + LOG_CLIENT_ERROR + '"). Gần nhất: ' + String(client[client.length - 1][2]).split('\n')[0].slice(0, 200));
      if (portal.length) problems.push(portal.length + ' lỗi máy chủ Lớp học trong 24 giờ qua (sheet Nhật ký, dòng "' + LOG_PORTAL_ERROR + '"). Gần nhất: ' + String(portal[portal.length - 1][2]).split('\n')[0].slice(0, 200));
    }
  } catch (e) { notes.push('Không đọc được sheet Nhật ký: ' + e.message); }

  const down = PropertiesService.getScriptProperties().getProperty('AI_DOWN_SINCE');
  if (down && Date.now() - new Date(down).getTime() > 3 * 3600e3) {
    problems.push('Gemini quá tải liên tục từ ' + Utilities.formatDate(new Date(down), Session.getScriptTimeZone(), 'HH:mm dd/MM') +
      ': bài Speaking và bài viết tay đang chờ (các bài khác vẫn chấm). Có thể đổi "Model Gemini" trong Cấu hình sang gemini-flash-lite-latest.');
  }
  const fns = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  if (fns.indexOf('hourlyJob') < 0) problems.push('Không thấy trigger chạy mỗi giờ (hourlyJob): bài nộp sẽ không được chấm tự động. Menu IELTS Checker > Bật tự động.');

  const out = { checkedAt: new Date().toISOString(), ok: !problems.length, problems, notes, versions: { site: expected, writing: writingVersion, classroom: CLASSROOM_VERSION } };
  try { PropertiesService.getScriptProperties().setProperty('HEALTH_LAST', JSON.stringify(out).slice(0, 8000)); } catch (e) { /* bỏ qua */ }
  return out;
}

function lastHealth_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('HEALTH_LAST') || 'null'); } catch (e) { return null; }
}

/**
 * Việc cần làm hôm nay (trang Tổng quan + email báo cáo sáng):
 * review: Speaking/bài AI chấm chờ duyệt · web: Writing chờ chấm trên web · manual: cần xem tay
 * formPending: HS đã làm Form R/L nhưng chưa bấm Nộp trên Classroom (bài chưa quá hạn quá N ngày).
 */
function todoLists_(subs, cfg) {
  const now = Date.now();
  const out = { review: [], web: [], manual: [], formPending: [] };
  const seenForm = {};
  subs.forEach(r => {
    const gs = String(r[S['Trạng thái chấm']] || '');
    const item = { student: pStr_(r[S['Học sinh']]), title: pStr_(r[S['Bài tập']]), className: pStr_(r[S['Lớp']]), skill: pStr_(r[S['Kỹ năng']]), id: pStr_(r[S['Submission ID']]), status: gs.slice(0, 160) };
    const kind = pGradeKind_(gs, r);
    if (kind === 'review') out.review.push(item);
    else if (kind === 'web') out.web.push(item);
    else if (kind === 'error') out.manual.push(item);
    const st = r[S['Trạng thái']];
    const due = r[S['Hạn nộp']];
    if ([STATUS.NOT_YET, STATUS.MISSING].indexOf(st) >= 0 && /^Đã chấm/.test(gs) && /^Reading|^Listening/.test(item.skill) &&
        due instanceof Date && now - due.getTime() <= cfg.remindMaxDays * 86400e3) {
      const k = r[S['Email']] + '|' + r[S['CourseWork ID']];
      if (!seenForm[k]) { seenForm[k] = true; out.formPending.push(Object.assign(item, { dueAt: pIso_(due) })); }
    }
  });
  return out;
}

function sendTeacherReport_() {
  const cfg = getConfig_();
  const tz = Session.getScriptTimeZone();
  const cw = readTable_(SH.CW, CW_HEADERS).rows;
  const subs = readTable_(SH.SUB, SUB_HEADERS).rows;
  const now = Date.now();
  const recent = cw.filter(r => r[C['Hạn nộp']] instanceof Date && Math.abs(r[C['Hạn nộp']].getTime() - now) <= 7 * 86400e3)
    .sort((a, b) => a[C['Hạn nộp']] - b[C['Hạn nộp']]);
  const pending = subs.filter(r => /chờ duyệt/.test(String(r[S['Trạng thái chấm']])) && r[S['Duyệt gửi']] !== true).length;
  const errors = subs.filter(r => String(r[S['Trạng thái chấm']]).indexOf('Lỗi') === 0).length;
  const webPending = subs.filter(r => String(r[S['Trạng thái chấm']]).indexOf('Đã gửi lên web') === 0).length;

  let health = null;
  try { health = healthCheck_(); } catch (e) { health = { ok: false, problems: ['Không chạy được bước kiểm tra hệ thống: ' + e.message], notes: [] }; }
  const mail = teacherReportEmail_(cfg, tz, recent, subs, pending, webPending, errors, health, todoLists_(subs, cfg));
  MailApp.sendEmail({ to: cfg.reportEmail, subject: (health && !health.ok ? '⚠ ' : '') + mail.subject, htmlBody: mail.html });
  return 'Đã gửi báo cáo tới ' + cfg.reportEmail;
}

function buildOverview_() {
  const subs = readTable_(SH.SUB, SUB_HEADERS).rows;
  const now = new Date();
  const map = {};
  const counted = {};
  subs.forEach(r => {
    const k = r[S['Course ID']] + '|' + r[S['User ID']];
    const o = map[k] = map[k] || { cls: r[S['Lớp']], name: r[S['Học sinh']], email: r[S['Email']], due: 0, on: 0, late: 0, miss: 0, b: { R: [], L: [], W: [], S: [] } };
    const st = r[S['Trạng thái']];
    const due = r[S['Hạn nộp']];
    const submitted = !!r[S['Nộp lúc']];
    const once = k + '|' + r[S['CourseWork ID']]; // bài gộp nhiều phần: chỉ đếm 1 lần
    const first = !counted[once];
    counted[once] = true;
    if (first && due instanceof Date && due <= now) {
      o.due++;
      if (!submitted) o.miss++;
    }
    if (first && submitted) { if (st === STATUS.LATE || (due instanceof Date && r[S['Nộp lúc']] > due)) o.late++; else o.on++; }
    const band = Number(r[S['Band']]);
    if (r[S['Band']] !== '' && !isNaN(band)) {
      const sk = String(r[S['Kỹ năng']]).charAt(0);
      if (o.b[sk]) o.b[sk].push(band);
    }
  });
  const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : '');
  const rows = Object.keys(map).map(k => {
    const o = map[k];
    const rate = o.due ? (o.due - o.miss) / o.due : '';
    return [o.cls, o.name, o.email, o.due, o.on, o.late, o.miss, rate, avg(o.b.R), avg(o.b.L), avg(o.b.W), avg(o.b.S)];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
  const sh = sheet_(SH.OVERVIEW);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 12).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 12).setValues(rows);
    sh.getRange(2, 8, rows.length, 1).setNumberFormat('0%');
  }
}

// ---------------------------------------------------------------------------
// TIỆN ÍCH
// ---------------------------------------------------------------------------
function indexMap_(headers) { const m = {}; headers.forEach((h, i) => { m[h] = i; }); return m; }

function sheet_(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function initTable_(name, headers) {
  const sh = sheet_(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader_(sh, headers.length);
  }
  return sh;
}

function styleHeader_(sh, n) {
  sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#3949ab').setFontColor('#ffffff');
  sh.setFrozenRows(1);
}

function readTable_(name, headers) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, headers.length).getValues() : [];
  return { sh, rows, headers };
}

function writeCols_(t, c0, c1) {
  if (!t.rows.length) return;
  t.sh.getRange(2, c0 + 1, t.rows.length, c1 - c0 + 1).setValues(t.rows.map(r => r.slice(c0, c1 + 1)));
}

function indexBy_(rows, col) {
  const m = {};
  rows.forEach((r, i) => { if (r[col] !== '') m[String(r[col])] = i; });
  return m;
}

function listAll_(fetchPage, key) {
  let out = [], token;
  do {
    const res = fetchPage(token) || {};
    out = out.concat(res[key] || []);
    token = res.nextPageToken;
  } while (token);
  return out;
}

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function log_(event, detail) {
  try {
    const sh = sheet_(SH.LOG);
    sh.appendRow([new Date(), event, String(detail || '').slice(0, 5000)]);
    if (sh.getLastRow() > 1000) sh.deleteRows(2, 200);
  } catch (e) { console.error(e); }
}

/** Chạy từ trình chỉnh sửa Apps Script: kiểm tra Gemini API key bằng 1 lượt gọi nhỏ. */
function kiemTraGemini() {
  const cfg = getConfig_();
  const res = callGemini_([{ text: 'Reply with JSON only: {"ok": true}' }], cfg);
  const msg = 'Gemini OK — model ' + cfg.model + ' trả lời: ' + JSON.stringify(res);
  console.log(msg);
  return msg;
}

/** Chạy từ trình chỉnh sửa Apps Script: xem trước sẽ điền gì vào file phạt (không ghi gì vào file phạt). */
function xemTruocFilePhat() {
  const r = fillPenaltySheets_(true);
  const parts = r.report.split('\n\nLưu ý:\n');
  const lines = parts[0].split('\n');
  const count = re => lines.filter(l => re.test(l)).length;
  console.log('Sẽ điền ' + count(/: (Done|Late|Missed 10k)$/) + ' ô: Done ' + count(/: Done$/) + ', Late ' + count(/: Late$/) +
    ', Missed 10k ' + count(/: Missed 10k$/) + '\nTổng hợp tuần:\n' + lines.filter(l => /Tổng hợp tuần/.test(l)).join('\n') +
    '\nMissed:\n' + lines.filter(l => /Missed 10k$/.test(l)).join('\n'));
  console.log('Lưu ý:\n' + (parts[1] || 'không có'));
  return r.summary;
}

/** Chạy từ trình chỉnh sửa Apps Script: điền file phạt ngay (giống menu "File phạt: điền ngay"). */
function dienFilePhat() {
  const r = fillPenaltySheets_(false);
  console.log(r.summary || 'Không có ô nào cần điền');
  console.log(r.report.split('\n').filter(l => /Tổng hợp tuần|Lưu ý|^- /.test(l)).join('\n'));
  return r.summary;
}

/** Chạy từ trình chỉnh sửa Apps Script: tạo tab tháng mới trong file phạt ngay. */
function taoTabThangMoi() {
  const r = ensurePenaltyMonthTabs_();
  console.log(r || 'Các file phạt đã có đủ tab tháng.');
  return r;
}

// ---------------------------------------------------------------------------
// WEB PORTAL API (khu "Lớp học" trên web Writing)
//  Web Writing gửi {action, token, payload}. token là phiên đăng nhập của web Writing:
//  hệ thống hỏi lại web Writing (me.get) để biết ai đang đăng nhập — không bao giờ tin vai trò/email do trình duyệt gửi.
//  Giáo viên (role admin trên web Writing): xem/sửa mọi thứ. Học sinh: chỉ dữ liệu có email của chính mình.
//  Triển khai: Triển khai > Bản triển khai mới > Ứng dụng web · Thực thi: Tôi · Ai có quyền: Bất kỳ ai.
// ---------------------------------------------------------------------------
class PortalError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function doGet() { return portalJson_({ ok: true, data: { service: 'ielts-classroom', version: CLASSROOM_VERSION } }); }

function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || ''); } catch (err) { body = null; }
  if (!body || typeof body.action !== 'string') return portalJson_({ ok: false, error: { code: 'bad_request', message: 'Yêu cầu không hợp lệ.' } });
  return portalJson_(portalHandle_(body.action, String(body.token || ''), body.payload || {}));
}

function portalJson_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

const PORTAL_TEACHER = {
  'writing.scoresNow': () => writingScoresNow_(),
  'sync.now': () => syncNow_(),
  'overview': p => portalOverview_(p),
  'submissions.list': p => portalSubmissions_(p),
  'submissions.update': p => portalLocked_(() => portalUpdateSubmission_(p)),
  'submissions.regrade': p => portalLocked_(() => portalRegrade_(p)),
  'submissions.files': p => portalFiles_(p),
  'submissions.feedback': p => portalFeedbackText_(p),
  'submissions.approveMany': p => portalLocked_(() => portalApproveMany_(p)),
  'submissions.sendApproved': () => portalLocked_(() => ({ message: sendApprovedFeedback_() || 'Không có nhận xét nào chờ gửi.' })),
  'assign.options': () => portalAssignOptions_(),
  'assign.list': () => portalAssignList_(),
  'assign.check': p => portalAssign_(p, true),
  'assign.create': p => portalLocked_(() => portalAssign_(p, false)),
  'assign.upload': p => portalUploadAudio_(p),
  'results.items': p => portalItems_(p),
  'results.scores': p => portalScores_(p),
  'penalty.class': p => portalPenaltyClass_(p),
  'system.health': () => healthCheck_(),
  'student.list': () => portalStudentList_(),
  'student.progress': p => studentProgress_(String(p.email || '').trim().toLowerCase(), false),
  'class.refresh': () => portalLocked_(() => portalRefreshCourses_()),
  'class.track': p => portalLocked_(() => portalTrackCourse_(p)),
  'class.ignore': p => portalLocked_(() => portalIgnoreCourse_(p)),
};
const PORTAL_STUDENT = {
  'me.classroom': (p, user) => portalStudent_(user),
  'me.progress': (p, user) => studentProgress_(user.email, true),
};
/** Không cần đăng nhập: phiên bản (trang web so với bản nó cần) và lỗi trình duyệt (ghi Nhật ký). */
const PORTAL_PUBLIC = {
  'system.version': () => ({ version: CLASSROOM_VERSION }),
  'client.error': p => portalClientError_(p),
};

/** Lỗi JavaScript trên trang web -> sheet Nhật ký (tối đa 30 lỗi/giờ để không bị spam). */
function portalClientError_(p) {
  const cache = CacheService.getScriptCache();
  const k = 'cerr_' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHH');
  const n = Number(cache.get(k) || 0);
  if (n >= 30) return { logged: false };
  cache.put(k, String(n + 1), 3600);
  const s = v => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ');
  log_(LOG_CLIENT_ERROR, (s(p.where).slice(0, 60) + ' ' + s(p.path).slice(0, 200) + ': ' + s(p.message).slice(0, 300) + '\n' + s(p.stack).slice(0, 1500)).trim());
  return { logged: true };
}
const LOG_CLIENT_ERROR = 'Lỗi trình duyệt';
const LOG_PORTAL_ERROR = 'Lỗi web portal';

/** Xử lý 1 yêu cầu từ web. Tách riêng khỏi doPost để kiểm thử được. */
function portalHandle_(action, token, payload) {
  try {
    if (PORTAL_PUBLIC[action]) return { ok: true, data: PORTAL_PUBLIC[action](payload || {}) };
    if (!PORTAL_TEACHER[action] && !PORTAL_STUDENT[action]) throw new PortalError('bad_request', 'Không có thao tác "' + String(action).slice(0, 40) + '".');
    const user = portalUser_(token);
    if (PORTAL_TEACHER[action]) {
      if (user.role !== 'admin') throw new PortalError('forbidden', 'Chỉ giáo viên được dùng mục này.');
      return { ok: true, data: PORTAL_TEACHER[action](payload, user) };
    }
    return { ok: true, data: PORTAL_STUDENT[action](payload, user) };
  } catch (err) {
    if (err instanceof PortalError) return { ok: false, error: { code: err.code, message: err.message } };
    if (err instanceof PermanentError) return { ok: false, error: { code: 'bad_request', message: err.message } };
    log_(LOG_PORTAL_ERROR, action + ': ' + (err.stack || err.message));
    return { ok: false, error: { code: 'server_error', message: 'Có lỗi ở hệ thống Classroom: ' + err.message } };
  }
}

/** Ai đang đăng nhập web Writing? Hỏi web Writing bằng token; nhớ 5 phút. */
function portalUser_(token) {
  if (!token || token.length > 128) throw new PortalError('unauthenticated', 'Vui lòng đăng nhập lại.');
  const cache = CacheService.getScriptCache();
  const key = 'pu_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const p = PropertiesService.getScriptProperties();
  const res = rawWritingCall_(p.getProperty('WRITING_API_URL') || DEFAULT_WRITING_API, { action: 'me.get', token });
  if (!res || !res.ok) {
    if (res && res.error && res.error.code === 'unauthenticated') throw new PortalError('unauthenticated', 'Vui lòng đăng nhập lại.');
    throw new PortalError('server_error', 'Không kiểm tra được đăng nhập với web Writing.');
  }
  const u = res.data || {};
  const user = { email: String(u.email || '').trim().toLowerCase(), name: String(u.name || ''), role: u.role === 'admin' ? 'admin' : 'student' };
  if (!user.email) throw new PortalError('unauthenticated', 'Vui lòng đăng nhập lại.');
  cache.put(key, JSON.stringify(user), 300);
  return user;
}

function portalLocked_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) throw new PortalError('busy', 'Hệ thống đang chạy tác vụ tự động (đồng bộ, chấm bài…). Thử lại sau 1–2 phút.');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---- tiện ích ----
const pIso_ = d => (d instanceof Date && !isNaN(d) ? d.toISOString() : '');
const pStr_ = v => (v === null || v === undefined ? '' : String(v));
function pDriveLinks_(ids) {
  return String(ids || '').split(',').filter(String).map(id => 'https://drive.google.com/file/d/' + id + '/view');
}
function pCourses_() {
  ensureHeaders_(SH.COURSES, COURSE_HEADERS);
  return readTable_(SH.COURSES, COURSE_HEADERS).rows
    .filter(r => r[0] === true && r[4])
    .map(r => ({ id: String(r[4]), name: String(r[1]), section: String(r[2] || ''), link: String(r[5] || ''), penaltyLink: String(r[C_LINKPEN_()] || '') }));
}
/** Nhóm trạng thái chấm cho giao diện. */
function pGradeKind_(gs, r) {
  gs = String(gs || '');
  if (r && r[S['Đã gửi lúc']]) return 'sent';
  if (/^Lỗi/.test(gs) || /cần kiểm tra/i.test(gs) || /^Bỏ qua: HS chưa viết/.test(gs)) return 'error';
  if (/chờ duyệt/.test(gs)) return r && r[S['Duyệt gửi']] === true ? 'approved' : 'review';
  if (/^Đã gửi lên web/.test(gs)) return 'web';
  if (/^Bỏ qua/.test(gs)) return 'skipped';
  if (/^Đã chấm/.test(gs)) return 'graded';
  if (!gs || /^Chờ/.test(gs)) return 'waiting';
  return 'other';
}
function pSubView_(r, cwLinks) {
  return {
    id: pStr_(r[S['Submission ID']]),
    className: pStr_(r[S['Lớp']]), title: pStr_(r[S['Bài tập']]), skill: pStr_(r[S['Kỹ năng']]),
    student: pStr_(r[S['Học sinh']]), email: pStr_(r[S['Email']]),
    status: pStr_(r[S['Trạng thái']]), turnedInAt: pIso_(r[S['Nộp lúc']]), dueAt: pIso_(r[S['Hạn nộp']]),
    score: pStr_(r[S['Điểm']]), band: pStr_(r[S['Band']]), summary: pStr_(r[S['Nhận xét tóm tắt']]),
    feedbackFile: pStr_(r[S['File nhận xét']]), gradeStatus: pStr_(r[S['Trạng thái chấm']]), gradeKind: pGradeKind_(r[S['Trạng thái chấm']], r),
    gradedAt: pIso_(r[S['Chấm lúc']]), approved: r[S['Duyệt gửi']] === true, sentAt: pIso_(r[S['Đã gửi lúc']]),
    files: pDriveLinks_(r[S['File IDs']]), courseWorkId: pStr_(r[S['CourseWork ID']]), courseId: pStr_(r[S['Course ID']]),
    assignmentLink: (cwLinks && cwLinks[pStr_(r[S['CourseWork ID']])]) || '',
  };
}
function pCwLinks_(cwRows) {
  const m = {};
  cwRows.forEach(w => { m[String(w[C['CourseWork ID']])] = String(w[C['Link']] || ''); });
  return m;
}

// ---- Tổng quan ----
function portalOverview_() {
  const cfg = getConfig_();
  const courses = pCourses_();
  const cw = readTable_(SH.CW, CW_HEADERS).rows;
  const subs = readTable_(SH.SUB, SUB_HEADERS).rows;
  const now = Date.now();
  const todo = { review: 0, approved: 0, error: 0, web: 0 };
  const students = {};
  subs.forEach(r => {
    const k = pGradeKind_(r[S['Trạng thái chấm']], r);
    if (todo[k] !== undefined) todo[k]++;
    if (r[S['Email']]) (students[String(r[S['Course ID']])] = students[String(r[S['Course ID']])] || {})[String(r[S['Email']]).toLowerCase()] = true;
  });
  const assignments = cw.filter(w => w[C['Hạn nộp']] instanceof Date && w[C['Hạn nộp']].getTime() > now - 7 * 86400e3 && w[C['Hạn nộp']].getTime() < now + 14 * 86400e3)
    .sort((a, b) => a[C['Hạn nộp']] - b[C['Hạn nộp']])
    .map(w => {
      const id = String(w[C['CourseWork ID']]);
      const missing = {};
      subs.forEach(s => { if (String(s[S['CourseWork ID']]) === id && [STATUS.NOT_YET, STATUS.MISSING].indexOf(s[S['Trạng thái']]) >= 0) missing[String(s[S['Học sinh']])] = true; });
      return {
        id, title: pStr_(w[C['Tiêu đề']]), className: pStr_(w[C['Lớp']]), courseId: pStr_(w[C['Course ID']]), dueAt: pIso_(w[C['Hạn nộp']]),
        total: Number(w[C['Tổng HS']]) || 0, onTime: Number(w[C['Đã nộp']]) || 0, late: Number(w[C['Nộp muộn']]) || 0, missing: Number(w[C['Chưa nộp']]) || 0,
        missingNames: Object.keys(missing), link: pStr_(w[C['Link']]), skills: componentsOf_(w),
      };
    });
  let log = [];
  try {
    const sh = sheet_(SH.LOG), last = sh.getLastRow();
    if (last > 1) log = sh.getRange(Math.max(2, last - 7), 1, Math.min(8, last - 1), 3).getValues().reverse()
      .map(r => ({ at: pIso_(r[0]), event: pStr_(r[1]), detail: pStr_(r[2]).slice(0, 300) }));
  } catch (e) { /* bỏ qua */ }
  return {
    teacherName: cfg.teacherName,
    sheetUrl: SpreadsheetApp.getActive().getUrl(),
    classes: courses.map(c => ({ id: c.id, name: c.name, section: c.section, link: c.link, students: Object.keys(students[c.id] || {}).length, hasPenaltyFile: !!c.penaltyLink })),
    todo, assignments, log, health: lastHealth_(), version: CLASSROOM_VERSION,
    runtime: { usedMin: Math.round(runtimeTodayMs_() / 60000), limitMin: RUNTIME_LIMIT_MIN, warnMin: RUNTIME_WARN_MIN,
      lastBackup: PropertiesService.getScriptProperties().getProperty('LAST_BACKUP_MS') ? new Date(Number(PropertiesService.getScriptProperties().getProperty('LAST_BACKUP_MS'))).toISOString() : '' },
    newClasses: pNewCourses_(),
    aiDownSince: PropertiesService.getScriptProperties().getProperty('AI_DOWN_SINCE') || '',
    todoItems: (function () { const tl = todoLists_(subs, cfg); return { manual: tl.manual.slice(0, 30), formPending: tl.formPending.slice(0, 30) }; })(),
    templates: courses.filter(c => c.penaltyLink).map(c => ({ id: c.id, name: c.name })),
  };
}

// ---- Bài nộp ----
const PORTAL_VIEWS = {
  review: v => v.gradeKind === 'review',
  approved: v => v.gradeKind === 'approved',
  error: v => v.gradeKind === 'error',
  web: v => v.gradeKind === 'web',
  missing: v => v.status === STATUS.NOT_YET || v.status === STATUS.MISSING,
  all: () => true,
};
function portalSubmissions_(p) {
  const view = PORTAL_VIEWS[p.view] ? p.view : 'review';
  const cw = readTable_(SH.CW, CW_HEADERS).rows;
  const links = pCwLinks_(cw);
  let rows = readTable_(SH.SUB, SUB_HEADERS).rows.filter(r => r[S['Submission ID']]).map(r => pSubView_(r, links));
  if (p.courseId) rows = rows.filter(v => v.courseId === String(p.courseId));
  if (p.courseWorkId) rows = rows.filter(v => v.courseWorkId === String(p.courseWorkId));
  if (p.skill) rows = rows.filter(v => v.skill.indexOf(String(p.skill)) === 0);
  if (p.q) { const q = String(p.q).toLowerCase(); rows = rows.filter(v => (v.student + ' ' + v.email + ' ' + v.title).toLowerCase().indexOf(q) >= 0); }
  const counts = {};
  Object.keys(PORTAL_VIEWS).forEach(k => { counts[k] = rows.filter(PORTAL_VIEWS[k]).length; });
  rows = rows.filter(PORTAL_VIEWS[view]).sort((a, b) => (b.turnedInAt || b.dueAt).localeCompare(a.turnedInAt || a.dueAt));
  const assignments = cw.filter(w => !p.courseId || String(w[C['Course ID']]) === String(p.courseId))
    .sort((a, b) => (b[C['Hạn nộp']] || 0) - (a[C['Hạn nộp']] || 0)).slice(0, 40)
    .map(w => ({ id: pStr_(w[C['CourseWork ID']]), title: pStr_(w[C['Tiêu đề']]), className: pStr_(w[C['Lớp']]) }));
  return { view, counts, total: rows.length, rows: rows.slice(0, 300), classes: pCourses_().map(c => ({ id: c.id, name: c.name })), assignments };
}

function pFindSub_(id) {
  const t = readTable_(SH.SUB, SUB_HEADERS);
  const i = t.rows.findIndex(r => String(r[S['Submission ID']]) === String(id || ''));
  if (i < 0) throw new PortalError('not_found', 'Không tìm thấy bài nộp này (có thể đã bị xoá khỏi sheet).');
  return { t, i, r: t.rows[i] };
}

function portalUpdateSubmission_(p) {
  const { t, i, r } = pFindSub_(p.id);
  if (r[S['Đã gửi lúc']]) throw new PortalError('bad_request', 'Bài này đã gửi kết quả cho học sinh, không sửa được nữa.');
  const row = i + 2;
  if (p.band !== undefined) {
    const b = String(p.band).trim();
    if (b && !(Number(b) >= 0 && Number(b) <= 9 && Number(b) * 2 === Math.round(Number(b) * 2))) throw new PortalError('bad_request', 'Band phải từ 0 đến 9, bước 0.5.');
    r[S['Band']] = b === '' ? '' : Number(b);
    t.sh.getRange(row, S['Band'] + 1).setValue(r[S['Band']]);
  }
  if (p.summary !== undefined) {
    r[S['Nhận xét tóm tắt']] = String(p.summary).slice(0, 5000);
    t.sh.getRange(row, S['Nhận xét tóm tắt'] + 1).setValue(r[S['Nhận xét tóm tắt']]);
  }
  if (p.approve !== undefined) {
    if (p.approve === true && !/chờ duyệt|^Đã chấm/.test(String(r[S['Trạng thái chấm']] || ''))) throw new PortalError('bad_request', 'Chỉ duyệt được bài đã chấm xong.');
    r[S['Duyệt gửi']] = p.approve === true;
    t.sh.getRange(row, S['Duyệt gửi'] + 1).setValue(r[S['Duyệt gửi']]);
  }
  let message = 'Đã lưu.';
  if (p.approve === true && p.sendNow === true) message = sendApprovedFeedback_() || 'Đã duyệt. Email sẽ gửi ở lần chạy tự động kế tiếp.';
  const fresh = pFindSub_(p.id).r;
  return { message, row: pSubView_(fresh, pCwLinks_(readTable_(SH.CW, CW_HEADERS).rows)) };
}

/** Tên + loại của các file HS nộp (để biết file nào là ghi âm). */
function portalFiles_(p) {
  const { r } = pFindSub_(p.id);
  return {
    files: String(r[S['File IDs']] || '').split(',').filter(String).slice(0, 20).map(id => {
      try {
        const f = DriveApp.getFileById(id);
        const mime = f.getMimeType();
        return { id, name: f.getName(), mime, kind: /^audio\//.test(mime) || /\.(mp3|m4a|wav|aac|ogg|opus|flac|3gp)$/i.test(f.getName()) ? 'audio' : /^video\//.test(mime) ? 'video' : /^image\//.test(mime) ? 'image' : 'doc', size: f.getSize(), url: 'https://drive.google.com/file/d/' + id + '/view' };
      } catch (e) { return { id, name: '(không mở được file)', mime: '', kind: 'error', size: 0, url: 'https://drive.google.com/file/d/' + id + '/view' }; }
    }),
  };
}

/** Nội dung file nhận xét AI (Google Docs) để giáo viên đọc ngay trên trang Bài nộp. */
function portalFeedbackText_(p) {
  const { r } = pFindSub_(p.id);
  const url = pStr_(r[S['File nhận xét']]);
  const id = (url.match(/\/d\/([\w-]{10,})/) || [])[1];
  if (!id) throw new PortalError('not_found', 'Bài này chưa có file nhận xét.');
  let text;
  try { text = DocumentApp.openById(id).getBody().getText(); } catch (e) { throw new PortalError('bad_request', 'Không mở được file nhận xét (có thể đã bị xoá).'); }
  return { text: String(text).replace(/\n{3,}/g, '\n\n').slice(0, 30000) };
}

/** Duyệt nhiều bài "chờ duyệt" một lần; sendNow: gửi email ngay. */
function portalApproveMany_(p) {
  const ids = (Array.isArray(p.ids) ? p.ids : []).map(String).slice(0, 200);
  if (!ids.length) throw new PortalError('bad_request', 'Chưa chọn bài nào.');
  const t = readTable_(SH.SUB, SUB_HEADERS);
  let n = 0, skipped = 0;
  t.rows.forEach((r, i) => {
    if (ids.indexOf(String(r[S['Submission ID']])) < 0) return;
    if (r[S['Đã gửi lúc']] || !/chờ duyệt|^Đã chấm/.test(String(r[S['Trạng thái chấm']] || ''))) { skipped++; return; }
    if (r[S['Duyệt gửi']] !== true) t.sh.getRange(i + 2, S['Duyệt gửi'] + 1).setValue(true);
    n++;
  });
  let message = 'Đã duyệt ' + n + ' bài' + (skipped ? ' (bỏ qua ' + skipped + ' bài đã gửi hoặc chưa chấm xong)' : '') + '.';
  if (p.sendNow === true && n) message += ' ' + (sendApprovedFeedback_() || 'Email sẽ gửi ở lần chạy tự động kế tiếp.');
  else if (n) message += ' Email sẽ gửi ở lần chạy tự động kế tiếp (trong vòng 1 giờ).';
  return { message, approved: n, skipped };
}

function portalRegrade_(p) {
  const { t, i, r } = pFindSub_(p.id);
  if (r[S['Đã gửi lúc']]) throw new PortalError('bad_request', 'Bài này đã gửi kết quả cho học sinh.');
  t.sh.getRange(i + 2, S['Trạng thái chấm'] + 1, 1, 2).setValues([['Chờ chấm', '']]);
  return { message: 'Hệ thống sẽ chấm lại bài này ở lần chạy tự động kế tiếp (trong vòng 1 giờ).' };
}

// ---- Giao bài ----
function portalAssignOptions_() {
  return { classes: pCourses_().map(c => ({ id: c.id, name: c.name })), types: Object.keys(ASSIGN_TYPES), timeZone: Session.getScriptTimeZone() };
}

function portalAssignList_() {
  initAssignSheet_();
  const t = readTable_(SH.ASSIGN, ASSIGN_HEADERS);
  return {
    rows: t.rows.map((r, i) => ({ row: i + 2, r })).filter(x => x.r[A['Lớp']] || x.r[A['Link thư mục Drive']]).reverse().slice(0, 40).map(x => ({
      row: x.row, className: pStr_(x.r[A['Lớp']]), session: pStr_(x.r[A['Buổi']]), type: pStr_(x.r[A['Loại bài']]),
      folder: pStr_(x.r[A['Link thư mục Drive']]), dueAt: pIso_(x.r[A['Hạn nộp']]), publish: x.r[A['Đăng ngay']] === true,
      status: pStr_(x.r[A['Trạng thái']]), link: pStr_(x.r[A['Bài trên Classroom']]), detail: pStr_(x.r[A['Chi tiết']]).slice(0, 1500),
    })),
  };
}

/** "2026-11-10T18:00" (giờ của script) -> Date */
function pParseLocal_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

function portalAssign_(p, dryRun) {
  const courses = {};
  pCourses_().forEach(c => { courses[c.name.trim()] = c.id; });
  const className = String(p.className || '').trim();
  const row = new Array(ASSIGN_HEADERS.length).fill('');
  row[A['Lớp']] = className;
  row[A['Buổi']] = String(p.session || '').trim().slice(0, 40);
  row[A['Loại bài']] = String(p.type || '');
  row[A['Link thư mục Drive']] = String(p.folder || '').trim();
  row[A['Hạn nộp']] = pParseLocal_(p.dueAt) || '';
  row[A['Ghi chú thêm cho HS']] = String(p.note || '').slice(0, 2000);
  row[A['Đăng ngay']] = p.publish === true;
  if (!row[A['Hạn nộp']]) throw new PortalError('bad_request', 'Chọn hạn nộp.');
  const plan = buildAssignPlan_(row, courses); // báo lỗi rõ ràng nếu thiếu file, sai đáp án…
  if (dryRun) return { ok: true, summary: plan.summary, warnings: plan.warnings || [], preview: assignPreview_(plan), folderId: driveIdFromUrl_(row[A['Link thư mục Drive']]) };
  initAssignSheet_();
  const sh = sheet_(SH.ASSIGN);
  const at = sh.getLastRow() + 1;
  sh.getRange(at, 1, 1, ASSIGN_HEADERS.length).setValues([row]);
  processAssignRows_(false, at);
  const r = sh.getRange(at, 1, 1, ASSIGN_HEADERS.length).getValues()[0];
  const status = pStr_(r[A['Trạng thái']]);
  if (/^Lỗi/.test(status)) throw new PortalError('bad_request', status);
  return { ok: true, status, link: pStr_(r[A['Bài trên Classroom']]), summary: pStr_(r[A['Chi tiết']]) };
}

/** Xem trước những gì sẽ tạo: từng câu trên Google Form + đáp án + có giải thích chưa; file đính kèm. */
function assignPreview_(plan) {
  return {
    parts: plan.rl.map(item => ({
      name: item.name,
      total: item.total,
      groups: item.groups.map(g => ({ a: g.a, b: g.b, label: g.label, pair: !!g.pair })),
      questions: item.questions.map(q => {
        const info = item.info && item.info[q.n];
        return {
          n: q.n, type: q.type, options: q.options || [], key: displayKey_(item.key[q.n] || ''),
          explained: !!(info && info.text), level: (info && info.level) || '', err: (info && info.err) || '',
        };
      }),
      scale: (item.scale || []).map(x => x[0] + '–' + x[1] + ': ' + x[2]),
    })),
    attachments: plan.attach.map(a => ({ name: a.name, mode: a.mode === 'STUDENT_COPY' ? 'Mỗi HS 1 bản' : a.toPdf ? 'Xem (tự chuyển PDF)' : 'Xem' })),
    writing: plan.writingTypes || '',
    speaking: plan.skills.indexOf('S') >= 0 ? (plan.speakingPrompt ? 'Có đề Speaking cho AI' : 'Không có file đề Speaking') : '',
    missingAudio: plan.skills.indexOf('L') >= 0 && (plan.warnings || []).some(w => /chưa có file nghe/i.test(w)),
  };
}

/** Tải file nghe (mp3/m4a…) từ trang Giao bài lên thư mục đề. Tối đa 25 MB. */
function portalUploadAudio_(p) {
  const id = driveIdFromUrl_(p.folder);
  if (!id) throw new PortalError('bad_request', 'Thiếu link thư mục Drive.');
  const name = String(p.name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 120);
  const mime = String(p.mime || '');
  if (!name || !/^audio\//.test(mime) && !/\.(mp3|m4a|wav|aac|ogg)$/i.test(name)) throw new PortalError('bad_request', 'Chỉ tải được file âm thanh (mp3, m4a, wav…).');
  const data = String(p.data || '');
  if (!data || data.length > 34 * 1024 * 1024) throw new PortalError('bad_request', 'File trống hoặc lớn hơn 25 MB. Hãy tải trực tiếp lên Google Drive.');
  let folder;
  try { folder = DriveApp.getFolderById(id); } catch (e) { throw new PortalError('bad_request', 'Không mở được thư mục Drive (link sai hoặc không có quyền).'); }
  // Tên có chữ "Listening" để hệ thống nhận ra là file nghe của phần Listening
  const finalName = /listening|nghe/i.test(name) ? name : 'Listening - ' + name;
  const f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(data), /^audio\//.test(mime) ? mime : 'audio/mpeg', finalName));
  log_('Tải file nghe', finalName + ' → ' + folder.getName());
  return { name: f.getName(), size: f.getSize(), url: f.getUrl() };
}

// ---- Kết quả ----
function portalItems_(p) {
  const t = readTable_(SH.ITEM, ITEM_HEADERS);
  const groups = {}, order = [];
  t.rows.forEach(r => {
    const id = pStr_(r[I['CourseWork ID']]) + '|' + pStr_(r[I['Phần']]);
    if (!groups[id]) { groups[id] = { key: id, courseWorkId: pStr_(r[I['CourseWork ID']]), className: pStr_(r[I['Lớp']]), title: pStr_(r[I['Bài tập']]), part: pStr_(r[I['Phần']]), updatedAt: '', summary: null, items: [] }; order.push(id); }
    const g = groups[id];
    if (/^Cả lớp$/i.test(pStr_(r[I['Câu']]))) {
      g.summary = { average: pStr_(r[I['Đáp án']]).replace(/^Điểm TB\s*/, ''), students: Number(r[I['Số HS làm']]) || 0, notDone: pStr_(r[I['Sai']]), note: pStr_(r[I['Cần chú ý']]), distribution: pStr_(r[I['Câu trả lời sai hay gặp']]), groups: pStr_(r[I["Dự kiến (Teacher's Book)"]]) };
      return;
    }
    const num = v => (v === '' || v === null || isNaN(Number(v)) ? null : Number(v));
    g.items.push({
      q: pStr_(r[I['Câu']]), key: pStr_(r[I['Đáp án']]), n: Number(r[I['Số HS làm']]) || 0, right: Number(r[I['Đúng']]) || 0, wrong: Number(r[I['Sai']]) || 0,
      p: num(r[I['p (độ khó)']]), pLabel: pStr_(r[I['Mức độ']]), d: num(r[I['D (phân hoá)']]), dLabel: pStr_(r[I['Độ phân hoá']]),
      expected: pStr_(r[I["Dự kiến (Teacher's Book)"]]), common: pStr_(r[I['Câu trả lời sai hay gặp']]), flags: pStr_(r[I['Cần chú ý']]),
    });
    if (r[I['Cập nhật']] instanceof Date) g.updatedAt = pIso_(r[I['Cập nhật']]);
  });
  const list = order.map(k => groups[k]).reverse();
  const selected = p.key ? list.filter(g => g.key === p.key)[0] || null : list[0] || null;
  return { list: list.map(g => ({ key: g.key, className: g.className, title: g.title, part: g.part, updatedAt: g.updatedAt })), selected };
}

function portalScores_(p) {
  const courses = pCourses_();
  const courseId = String(p.courseId || (courses[0] && courses[0].id) || '');
  const cw = readTable_(SH.CW, CW_HEADERS).rows.filter(w => String(w[C['Course ID']]) === courseId && w[C['Hạn nộp']] instanceof Date)
    .sort((a, b) => b[C['Hạn nộp']] - a[C['Hạn nộp']]).slice(0, Math.min(Number(p.limit) || 8, 20)).reverse();
  const ids = {};
  cw.forEach(w => { ids[String(w[C['CourseWork ID']])] = true; });
  const students = {};
  readTable_(SH.SUB, SUB_HEADERS).rows.forEach(r => {
    if (String(r[S['Course ID']]) !== courseId || !ids[String(r[S['CourseWork ID']])]) return;
    const e = String(r[S['Email']]).toLowerCase();
    const st = students[e] = students[e] || { email: e, name: pStr_(r[S['Học sinh']]), cells: {} };
    (st.cells[String(r[S['CourseWork ID']])] = st.cells[String(r[S['CourseWork ID']])] || []).push({
      skill: pStr_(r[S['Kỹ năng']]), status: pStr_(r[S['Trạng thái']]), score: pStr_(r[S['Điểm']]), band: pStr_(r[S['Band']]),
      gradeKind: pGradeKind_(r[S['Trạng thái chấm']], r), id: pStr_(r[S['Submission ID']]),
    });
  });
  return {
    courseId, classes: courses.map(c => ({ id: c.id, name: c.name })),
    assignments: cw.map(w => ({ id: pStr_(w[C['CourseWork ID']]), title: pStr_(w[C['Tiêu đề']]), dueAt: pIso_(w[C['Hạn nộp']]) })),
    students: Object.keys(students).map(k => students[k]).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
  };
}

// ---- Phạt (đọc thẳng file phạt của lớp: đúng cả các ô giáo viên tự sửa) ----
function pPenaltyBook_(course) {
  const ssId = (String(course.penaltyLink).match(/\/d\/([\w-]+)/) || [])[1] || String(course.penaltyLink).trim();
  const cache = CacheService.getScriptCache();
  const ck = 'pen_' + ssId;
  const hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  let ss;
  try { ss = SpreadsheetApp.openById(ssId); } catch (e) { throw new PortalError('bad_request', 'Không mở được file phạt của lớp ' + course.name + '.'); }
  const book = readPenaltyBook_(ss);
  const tabs = book.tabs.filter(t => t.blocks.length).map(t => ({
    name: t.name,
    blocks: t.blocks.map(b => {
      const weekOf = col => { const ws = b.weekStarts.filter(c => c <= col).pop(); return ws === undefined ? '' : String(t.v[b.nameRow - 3][ws]).trim(); };
      return {
        sessions: b.sessions.map(s => ({ label: s.label, week: weekOf(s.col), cols: s.cols.map(c => ({ col: c.col, skill: c.skill })) })),
        students: b.students.map(st => ({ name: st.name, values: b.sessions.reduce((o, s) => { s.cols.forEach(c => { o[c.col] = String(t.v[st.row][c.col] || '').trim(); }); return o; }, {}) })),
      };
    }),
  }));
  const out = { tabs, url: ss.getUrl() };
  try { cache.put(ck, JSON.stringify(out), 300); } catch (e) { /* quá lớn để nhớ: đọc lại lần sau */ }
  return out;
}

/** Chọn tab của tháng (VD "T11"); không có thì tab cuối. */
function pPenaltyTab_(book, month) {
  const re = new RegExp('T0?' + month + '(?!\\d)', 'i');
  return book.tabs.filter(t => re.test(t.name))[0] || book.tabs[book.tabs.length - 1] || null;
}

function pPenaltyRows_(tab) {
  // Gộp các khối của tab thành: danh sách cột (buổi × kỹ năng, kèm tuần) + từng HS
  const columns = [], students = {};
  tab.blocks.forEach(b => {
    b.sessions.forEach(s => s.cols.forEach(c => columns.push({ key: b.sessions.indexOf(s) + ':' + c.col + ':' + tab.blocks.indexOf(b), session: s.label, week: s.week, skill: c.skill, col: c.col, block: tab.blocks.indexOf(b) })));
    b.students.forEach(st => { (students[st.name] = students[st.name] || {})[tab.blocks.indexOf(b)] = st.values; });
  });
  const rows = Object.keys(students).map(name => {
    const values = columns.map(c => (students[name][c.block] || {})[c.col] || '');
    const weeks = {};
    columns.forEach((c, i) => { if (values[i] === PEN.MISSED) weeks[c.week] = (weeks[c.week] || 0) + PEN.FINE; });
    return { name, values, fine: Object.keys(weeks).reduce((s, w) => s + weeks[w], 0), weeks };
  });
  return { columns: columns.map(c => ({ session: c.session, week: c.week, skill: c.skill })), rows };
}

function portalPenaltyClass_(p) {
  const courses = pCourses_().filter(c => c.penaltyLink);
  if (!courses.length) return { classes: [], message: 'Chưa có lớp nào có "Link file phạt" (sheet Lớp học).' };
  const course = courses.filter(c => c.id === String(p.courseId || ''))[0] || courses[0];
  const book = pPenaltyBook_(course);
  const month = Number(p.month) || new Date().getMonth() + 1;
  const tab = pPenaltyTab_(book, month);
  if (!tab) return { classes: courses.map(c => ({ id: c.id, name: c.name })), courseId: course.id, message: 'File phạt chưa có tab nào đúng mẫu.' };
  const data = pPenaltyRows_(tab);
  return {
    classes: courses.map(c => ({ id: c.id, name: c.name })), courseId: course.id, tab: tab.name, tabs: book.tabs.map(t => t.name), url: book.url,
    columns: data.columns, rows: data.rows.sort((a, b) => b.fine - a.fine || a.name.localeCompare(b.name, 'vi')),
    total: data.rows.reduce((s, r) => s + r.fine, 0), fineUnit: PEN.FINE,
  };
}

// ---- Tiến bộ & ôn câu sai (HS xem của mình; giáo viên xem từng HS) ----
/** 'Sai 2 câu. Câu 3: "glu" → glue; Câu 7: "—" → B (band…)' -> [{q, given, expected}] */
function parseWrongList_(summary) {
  const out = [];
  const re = /Câu (\d{1,3}): "(.*?)" → (.*?)(?=; Câu \d{1,3}: "| \(band quy đổi| \[AI |$)/g;
  let m;
  while ((m = re.exec(String(summary || '')))) out.push({ q: m[1], given: m[2] === '—' ? '' : m[2], expected: m[3].trim() });
  return out;
}

function portalStudentList_() {
  const seen = {}, out = [];
  readTable_(SH.SUB, SUB_HEADERS).rows.forEach(r => {
    const e = String(r[S['Email']] || '').trim().toLowerCase();
    if (!e || seen[e]) return;
    seen[e] = true;
    out.push({ email: e, name: pStr_(r[S['Học sinh']]), className: pStr_(r[S['Lớp']]) });
  });
  return { students: out.sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name, 'vi')) };
}

/**
 * Band theo thời gian (R/L/W/S), lỗi hay lặp lại (theo "Lỗi dự kiến" trong Teacher's Book của các câu sai)
 * và danh sách câu sai gần đây để ôn. sentOnly: HS chỉ thấy kết quả đã gửi qua email.
 */
function studentProgress_(email, sentOnly) {
  if (!email) throw new PortalError('bad_request', 'Chọn học sinh.');
  const subs = readTable_(SH.SUB, SUB_HEADERS).rows.filter(r => String(r[S['Email']]).trim().toLowerCase() === email);
  if (!subs.length) return { matched: false, email };
  const cwById = {};
  readTable_(SH.CW, CW_HEADERS).rows.forEach(w => { cwById[String(w[C['CourseWork ID']])] = w; });
  const info = loadKeyInfo_();
  const now = Date.now();
  const points = [], review = [], errCount = {};
  let wrongTotal = 0, answered = 0;
  subs.forEach(r => {
    const sent = !!r[S['Đã gửi lúc']];
    if (sentOnly && !sent) return;
    const skill = pStr_(r[S['Kỹ năng']]);
    const k = /^Reading/.test(skill) ? 'R' : /^Listening/.test(skill) ? 'L' : /^Writing/.test(skill) ? 'W' : /^Speaking/.test(skill) ? 'S' : '';
    const when = r[S['Hạn nộp']] instanceof Date ? r[S['Hạn nộp']] : r[S['Nộp lúc']] instanceof Date ? r[S['Nộp lúc']] : null;
    const band = Number(r[S['Band']]);
    if (k && r[S['Band']] !== '' && !isNaN(band)) {
      points.push({ at: pIso_(when), title: pStr_(r[S['Bài tập']]), skill: SKILL_NAMES[k], band, score: pStr_(r[S['Điểm']]) });
    }
    if ((k === 'R' || k === 'L') && /^\d+\/\d+$/.test(pStr_(r[S['Điểm']]))) {
      const total = Number(pStr_(r[S['Điểm']]).split('/')[1]);
      answered += total;
      const wrong = parseWrongList_(r[S['Nhận xét tóm tắt']]);
      wrongTotal += wrong.length;
      const w = cwById[String(r[S['CourseWork ID']])];
      const code = w ? rlSource_(w, skill).keyCode : '';
      const qi = info[code] || {};
      const recent = when && now - when.getTime() <= 21 * 86400e3;
      wrong.forEach(x => {
        const inf = qi[x.q] || {};
        if (inf.err) errCount[inf.err] = (errCount[inf.err] || 0) + 1;
        if (recent) review.push({
          courseWorkId: pStr_(r[S['CourseWork ID']]), title: pStr_(r[S['Bài tập']]), skill: SKILL_NAMES[k], q: Number(x.q),
          given: x.given, key: displayKey_(x.expected), err: inf.err || '', explanation: String(inf.text || '').slice(0, 2000), at: pIso_(when),
        });
      });
    }
  });
  points.sort((a, b) => (a.at || '').localeCompare(b.at || ''));
  const bySkill = {};
  ['Reading', 'Listening', 'Writing', 'Speaking'].forEach(sk => {
    const xs = points.filter(p => p.skill === sk);
    if (!xs.length) return;
    const avg = xs.reduce((s2, p) => s2 + p.band, 0) / xs.length;
    bySkill[sk] = { count: xs.length, latest: xs[xs.length - 1].band, average: Math.round(avg * 10) / 10, change: xs.length > 1 ? xs[xs.length - 1].band - xs[0].band : 0 };
  });
  const errors = Object.keys(errCount).map(label => ({ label, count: errCount[label] })).sort((a, b) => b.count - a.count).slice(0, 6);
  review.sort((a, b) => (b.at || '').localeCompare(a.at || '') || a.q - b.q);
  return {
    matched: true, email, name: pStr_(subs[0][S['Học sinh']]), className: pStr_(subs[0][S['Lớp']]),
    points, bySkill, errors, wrongTotal, answered, review: review.slice(0, 60),
  };
}

/** Chủ nhật: email mỗi HS các câu R/L làm sai trong 7 ngày qua (mỗi tuần 1 lần). */
function sendWeeklyReview_(cfg) {
  if (!cfg.weeklyReview) return '';
  const tz = Session.getScriptTimeZone();
  if (Utilities.formatDate(new Date(), tz, 'u') !== '7') return ''; // 7 = Chủ nhật
  const props = PropertiesService.getScriptProperties();
  const week = Utilities.formatDate(new Date(), tz, 'YYYY-ww');
  if (props.getProperty('REVIEW_WEEK') === week) return '';
  const emails = {};
  readTable_(SH.SUB, SUB_HEADERS).rows.forEach(r => {
    const sentAt = r[S['Đã gửi lúc']];
    if (sentAt instanceof Date && Date.now() - sentAt.getTime() <= 7 * 86400e3 && /^(Reading|Listening)/.test(String(r[S['Kỹ năng']])) && /Câu \d/.test(String(r[S['Nhận xét tóm tắt']])))
      emails[String(r[S['Email']]).trim().toLowerCase()] = true;
  });
  const list = Object.keys(emails).filter(String);
  if (!list.length) { props.setProperty('REVIEW_WEEK', week); return 'Không có HS nào cần ôn.'; }
  if (MailApp.getRemainingDailyQuota() < list.length + 10) return 'Bỏ qua email ôn tập: không đủ hạn mức gửi email hôm nay.';
  let sent = 0;
  list.forEach(email => {
    const pr = studentProgress_(email, true);
    const items = (pr.review || []).filter(x => x.at && Date.now() - Date.parse(x.at) <= 8 * 86400e3);
    if (!items.length) return;
    const mail = weeklyReviewEmail_(pr, items, cfg);
    MailApp.sendEmail({ to: email, subject: mail.subject, body: mail.text, htmlBody: mail.html, name: cfg.teacherName || undefined });
    sent++;
  });
  props.setProperty('REVIEW_WEEK', week);
  return 'Đã gửi email ôn tập cho ' + sent + ' học sinh.';
}

function weeklyReviewEmail_(pr, items, cfg) {
  const teacher = cfg.teacherName || 'Thầy/cô';
  let body = emHeader_('Ôn tập cuối tuần', esc_(pr.name), esc_(pr.className));
  body += emRow_('Chào <b>' + esc_(pr.name) + '</b>,<br>Đây là ' + items.length + ' câu em làm sai trong tuần này. Đọc lại giải thích và thử tự trả lời trước khi xem đáp án nhé.', '24px 28px 8px');
  if (pr.errors && pr.errors.length) {
    body += emRow_(emBox_('<b>Lỗi em hay gặp:</b> ' + pr.errors.slice(0, 3).map(e => esc_(e.label) + ' (' + e.count + ' câu)').join(' · '), 'warn'), '8px 28px 0');
  }
  const byTitle = {};
  items.slice(0, 30).forEach(x => { (byTitle[x.title + ' – ' + x.skill] = byTitle[x.title + ' – ' + x.skill] || []).push(x); });
  Object.keys(byTitle).forEach(t => {
    body += emH2_(esc_(t));
    byTitle[t].forEach(x => {
      const expl = String(x.explanation || '').split('\n').filter(l => !/^Cặp câu|^Câu hỏi:/.test(l)).slice(0, 4).join('<br>');
      body += emRow_(emCard_('<div style="font-family:' + EM.font + ';font-size:14px;color:' + EM.text + ';line-height:1.6"><b>Câu ' + x.q + '</b> · em trả lời: <span style="color:' + EM.danger + '">' + esc_(x.given || '(bỏ trống)') + '</span> → đáp án: <b style="color:' + EM.success + '">' + esc_(x.key) + '</b>' +
        (x.err ? '<br><span style="color:' + EM.muted + '">Lỗi: ' + esc_(x.err) + '</span>' : '') +
        (expl ? '<div style="margin-top:6px;color:' + EM.muted + ';font-size:13px">' + esc_(expl).replace(/&lt;br&gt;/g, '<br>') + '</div>' : '') + '</div>'), '8px 28px 0');
    });
  });
  if (cfg.writingAppUrl) body += emRow_(emButton_(cfg.writingAppUrl + '#/lop-cua-em/tien-bo', 'Xem tiến bộ của em'), '18px 28px 0');
  body += emSign_(teacher, 'Cố lên nhé!');
  const text = ['Chào ' + pr.name + ',', '', 'Các câu em làm sai trong tuần:'].concat(items.slice(0, 30).map(x => x.title + ' – ' + x.skill + ' câu ' + x.q + ': em trả lời "' + (x.given || '—') + '" → đáp án ' + x.key), ['', teacher]);
  return { subject: 'Ôn tập cuối tuần – ' + items.length + ' câu cần xem lại', html: emShell_(body, items.length + ' câu cần xem lại tuần này', 'Email tự động từ hệ thống bài tập lớp ' + esc_(pr.className) + '.'), text: text.join('\n') };
}

// ---- Học sinh: chỉ dữ liệu của chính mình ----
function portalStudent_(user) {
  const email = user.email;
  const subs = readTable_(SH.SUB, SUB_HEADERS).rows.filter(r => String(r[S['Email']]).trim().toLowerCase() === email);
  if (!subs.length) return { matched: false, email };
  const cwRows = readTable_(SH.CW, CW_HEADERS).rows;
  const cwById = {};
  cwRows.forEach(w => { cwById[String(w[C['CourseWork ID']])] = w; });
  const byCw = {}, order = [];
  subs.forEach(r => {
    const id = String(r[S['CourseWork ID']]);
    if (!byCw[id]) { byCw[id] = []; order.push(id); }
    byCw[id].push(r);
  });
  const now = Date.now();
  const assignments = order.map(id => {
    const rows = byCw[id], r0 = rows[0], w = cwById[id];
    const due = r0[S['Hạn nộp']];
    return {
      id, title: pStr_(r0[S['Bài tập']]), className: pStr_(r0[S['Lớp']]), dueAt: pIso_(due), status: pStr_(r0[S['Trạng thái']]),
      turnedInAt: pIso_(r0[S['Nộp lúc']]), link: w ? pStr_(w[C['Link']]) : '',
      overdue: due instanceof Date && due.getTime() < now && [STATUS.NOT_YET, STATUS.MISSING].indexOf(r0[S['Trạng thái']]) >= 0,
      parts: rows.map(r => {
        const sent = !!r[S['Đã gửi lúc']]; // chỉ hiện điểm/nhận xét HS đã nhận qua email
        const kind = pGradeKind_(r[S['Trạng thái chấm']], r);
        return {
          skill: pStr_(r[S['Kỹ năng']]),
          state: sent ? 'sent' : kind === 'skipped' ? 'skipped' : r[S['Nộp lúc']] ? 'grading' : 'todo',
          score: sent ? pStr_(r[S['Điểm']]) : '', band: sent ? pStr_(r[S['Band']]) : '',
          summary: sent ? pStr_(r[S['Nhận xét tóm tắt']]) : '', sentAt: pIso_(r[S['Đã gửi lúc']]),
          feedbackFile: sent && /^https:\/\/docs\.google\.com\//.test(pStr_(r[S['File nhận xét']])) ? pStr_(r[S['File nhận xét']]) : '',
          // Bài Writing đã gửi lên web: HS mở bài (và bài chữa khi có điểm) ngay trên web, cùng tài khoản
          essayId: (String(r[S['File nhận xét']] || '').match(/#\/admin\/score\/([\w-]+)/) || [])[1] || '',
        };
      }),
    };
  }).sort((a, b) => (b.dueAt || '').localeCompare(a.dueAt || ''));

  // Band trung bình theo kỹ năng (chỉ bài đã gửi kết quả)
  const bands = { Reading: [], Listening: [], Writing: [], Speaking: [] };
  assignments.forEach(a => a.parts.forEach(pt => {
    const k = Object.keys(bands).filter(x => pt.skill.indexOf(x) === 0)[0];
    if (k && pt.band !== '' && !isNaN(Number(pt.band))) bands[k].push(Number(pt.band));
  }));
  const avg = {};
  Object.keys(bands).forEach(k => { avg[k] = bands[k].length ? Math.round(bands[k].reduce((s, x) => s + x, 0) / bands[k].length * 10) / 10 : null; });
  const past = assignments.filter(a => a.dueAt && Date.parse(a.dueAt) < now);
  const done = past.filter(a => a.turnedInAt).length;

  // Phạt tháng này (theo tên của em trong file phạt)
  const penalty = [];
  const mapRows = readTable_(SH.PENMAP, PENMAP_HEADERS).rows;
  const classNames = {};
  subs.forEach(r => { classNames[String(r[S['Course ID']])] = String(r[S['Lớp']]); });
  pCourses_().filter(c => classNames[c.id] && c.penaltyLink).forEach(course => {
    const m = mapRows.filter(r => String(r[0]) === course.name && String(r[1]).toLowerCase() === email)[0];
    const name = m ? String(m[3] || '').trim() : '';
    if (!name || name === '(bỏ qua)') return;
    try {
      const book = pPenaltyBook_(course);
      const tab = pPenaltyTab_(book, new Date().getMonth() + 1);
      if (!tab) return;
      const data = pPenaltyRows_(tab);
      const me = data.rows.filter(r => r.name === name)[0];
      if (!me) return;
      penalty.push({
        className: course.name, tab: tab.name, fine: me.fine, weeks: me.weeks,
        items: data.columns.map((c, i) => ({ session: c.session, week: c.week, skill: c.skill, value: me.values[i] })).filter(x => x.value),
      });
    } catch (e) { /* file phạt lỗi: bỏ qua phần phạt */ }
  });

  return {
    matched: true, email, name: pStr_(subs[0][S['Học sinh']]),
    classes: Object.keys(classNames).map(id => classNames[id]),
    stats: { assignments: assignments.length, pastDue: past.length, submitted: done, pending: assignments.filter(a => !a.turnedInAt && !a.overdue).length, overdue: assignments.filter(a => a.overdue).length, bands: avg },
    assignments: assignments.slice(0, 60), penalty,
  };
}
