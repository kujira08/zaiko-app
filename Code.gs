// ============================================================
// 在庫管理アプリ - Google Apps Script バックエンド v2
// データ保存: シート行方式（上限なし）
// PRODUCTS / MATERIALS / MOVEMENTS / META / LOGS シート
// ============================================================

var SHEET_PRODUCTS  = 'PRODUCTS';
var SHEET_MATERIALS = 'MATERIALS';
var SHEET_MOVEMENTS = 'MOVEMENTS';
var SHEET_META      = 'META';       // 委託先・棚卸しなど小さいデータ
var SHEET_LOGS      = 'LOGS';

// PRODUCTSシートのカラム順
var PROD_COLS = ['id','name','sku','unit','stock','min','price','sellingPrice','category','supplier','notes','imageData','imageUrl'];
// MATERIALSシートのカラム順
// ⚠️ 読み書きは「列の位置」で行う（sheetToObjects/objectsToSheetはヘッダー名を見ない）。
//    追加は必ず末尾。途中に挿すと全レコードが列ズレする。
// 2026-08-07 追加：officialName（請求書どおりの正式名称）・supplier（仕入先）
//    ⚠️ GAS連携/Code.gs と必ず同じ内容にすること（同じシートを見ているため片方だけだと消える）
var MAT_COLS  = ['id','name','sku','type','dyeKind','weightKg','tareKg','pricePerKg','minStock',
                 'diamMm','coreMm','thickMm','pricePerM','stock','unit','price','sellingPrice','notes',
                 'officialName','supplier'];
// MOVEMENTSシートのカラム順
var MOV_COLS  = ['id','cat','itemId','type','qty','unit','consigneeId','date','notes','userName','bulkId'];

// ============================================================
// Webアプリのエントリーポイント
// ============================================================
function doGet(e) {
  if (e && e.parameter && e.parameter.action) {
    return handleApiGet(e);
  }
  var productId = (e && e.parameter && e.parameter.pid) ? e.parameter.pid : '';
  var template = HtmlService.createTemplateFromFile('index');
  template.initialProductId = productId;
  template.webAppUrl = ScriptApp.getService().getUrl();
  return template.evaluate()
    .setTitle('在庫管理アプリ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    if (!verifyToken(body.token)) {
      return jsonResponse({ ok: false, error: 'パスワードが違います' });
    }
    if (action === 'saveData')   return jsonResponse(saveAllData(body.data));
    if (action === 'addLog')     return jsonResponse(addLog(body.logAction, body.target, body.detail, body.userName));
    if (action === 'saveNotificationSettings') return jsonResponse(saveNotificationSettings(body.settings));
    if (action === 'saveReportSettings')       return jsonResponse(saveReportSettings(body.settings));
    if (action === 'setupEmailTrigger')   { setupEmailTrigger(body.enabled);   return jsonResponse({ ok: true }); }
    if (action === 'setupMonthlyTrigger') { setupMonthlyTrigger(body.enabled); return jsonResponse({ ok: true }); }
    if (action === 'sendMonthlyReportNow') { sendMonthlyReportNow(); return jsonResponse({ ok: true }); }
    if (action === 'sendTestNotificationEmail') { sendTestNotificationEmail(body.email); return jsonResponse({ ok: true }); }
    if (action === 'uploadImage') return jsonResponse(uploadProductImage(body.imageData, body.filename));
    if (action === 'deleteImage') return jsonResponse(deleteProductImage(body.fileId));
    if (action === 'addConsignmentSales') return jsonResponse(addConsignmentSales(body));
    return jsonResponse({ ok: false, error: '不明なアクション: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function handleApiGet(e) {
  var action = e.parameter.action;
  if (action === 'auth') {
    var ok = verifyPassword(e.parameter.password);
    return jsonResponse({ ok: ok, error: ok ? null : 'パスワードが違います' });
  }
  if (!verifyToken(e.parameter.token)) {
    return jsonResponse({ ok: false, error: '認証エラー。再ログインしてください' });
  }
  if (action === 'getData')                return jsonResponse({ ok: true, data: loadAllData() });
  if (action === 'getUser')               return jsonResponse({ ok: true, user: getUser() });
  if (action === 'getLogs')               return jsonResponse({ ok: true, logs: getLogs() });
  if (action === 'getNotificationSettings') return jsonResponse({ ok: true, settings: getNotificationSettings() });
  if (action === 'getReportSettings')     return jsonResponse({ ok: true, settings: getReportSettings() });
  if (action === 'getWebAppUrl')          return jsonResponse({ ok: true, url: ScriptApp.getService().getUrl() });
  if (action === 'getDriveSpreadsheets')  return jsonResponse({ ok: true, files: getDriveSpreadsheets(e.parameter.q) });
  if (action === 'getSpreadsheetSheets')  return jsonResponse({ ok: true, sheets: getSpreadsheetSheets(e.parameter.id) });
  if (action === 'getSpreadsheetSheetData') return jsonResponse({ ok: true, data: getSpreadsheetSheetData(e.parameter.id, e.parameter.sheet) });
  return jsonResponse({ ok: false, error: '不明なアクション' });
}

// ============================================================
// 認証
// ============================================================
function verifyToken(token) {
  if (!token) return false;
  var stored = PropertiesService.getScriptProperties().getProperty('APP_PASSWORD');
  if (!stored) return true;
  return token === stored;
}
function verifyPassword(password) {
  var stored = PropertiesService.getScriptProperties().getProperty('APP_PASSWORD');
  if (!stored) return true;
  return password === stored;
}
function setAppPassword(newPassword) {
  PropertiesService.getScriptProperties().setProperty('APP_PASSWORD', newPassword);
  return { ok: true };
}
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

// ============================================================
// スプレッドシート取得
// ============================================================
function getSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('SPREADSHEET_ID');
  if (!ssId) throw new Error('スプレッドシートIDが設定されていません。setupSpreadsheetを実行してください。');
  return SpreadsheetApp.openById(ssId);
}

// シートを取得（なければ作成）
function getSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    initSheet(sheet, name);
  }
  return sheet;
}

function initSheet(sheet, name) {
  if (name === SHEET_PRODUCTS) {
    sheet.getRange(1, 1, 1, PROD_COLS.length).setValues([PROD_COLS]);
    sheet.setFrozenRows(1);
    styleHeader(sheet, PROD_COLS.length);
  } else if (name === SHEET_MATERIALS) {
    sheet.getRange(1, 1, 1, MAT_COLS.length).setValues([MAT_COLS]);
    sheet.setFrozenRows(1);
    styleHeader(sheet, MAT_COLS.length);
  } else if (name === SHEET_MOVEMENTS) {
    sheet.getRange(1, 1, 1, MOV_COLS.length).setValues([MOV_COLS]);
    sheet.setFrozenRows(1);
    styleHeader(sheet, MOV_COLS.length);
  } else if (name === SHEET_META) {
    sheet.getRange('A1').setValue('{}');
  } else if (name === SHEET_LOGS) {
    sheet.getRange('A1:F1').setValues([['日時','メール','ユーザー名','操作','品名/対象','詳細']]);
    sheet.setFrozenRows(1);
    styleHeader(sheet, 6);
  }
}

function styleHeader(sheet, cols) {
  var r = sheet.getRange(1, 1, 1, cols);
  r.setBackground('#1a1a2e');
  r.setFontColor('#ffffff');
  r.setFontWeight('bold');
}

// ============================================================
// データ読み込み（シート行→JSON変換）
// ============================================================
function loadAllData() {
  try {
    var ss = getSpreadsheet();

    // 商品
    var products = sheetToObjects(getSheet(ss, SHEET_PRODUCTS), PROD_COLS);

    // 素材
    var materials = sheetToObjects(getSheet(ss, SHEET_MATERIALS), MAT_COLS);

    // 入出庫履歴
    var movements = sheetToObjects(getSheet(ss, SHEET_MOVEMENTS), MOV_COLS);

    // META（委託先・棚卸し・その他）
    var meta = {};
    try {
      var metaVal = getSheet(ss, SHEET_META).getRange('A1').getValue();
      meta = JSON.parse(metaVal || '{}');
    } catch(e) {}

    var result = Object.assign({}, meta, {
      products:  products,
      materials: materials,
      movements: movements
    });

    return JSON.stringify(result);
  } catch(e) {
    return JSON.stringify({ _error: e.message });
  }
}

// ============================================================
// データ保存（JSON→シート行変換）
// ============================================================
function saveAllData(jsonStr) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);  // 他の保存処理が終わるまで最大15秒待つ
    var data = JSON.parse(jsonStr);
    var ss = getSpreadsheet();

    // 商品シート更新
    objectsToSheet(getSheet(ss, SHEET_PRODUCTS), PROD_COLS, data.products || []);

    // 素材シート更新
    objectsToSheet(getSheet(ss, SHEET_MATERIALS), MAT_COLS, data.materials || []);

    // 入出庫履歴シート更新
    objectsToSheet(getSheet(ss, SHEET_MOVEMENTS), MOV_COLS, data.movements || []);

    // METAシート（商品・素材・履歴以外）
    var meta = {};
    Object.keys(data).forEach(function(k) {
      if (k !== 'products' && k !== 'materials' && k !== 'movements') {
        meta[k] = data[k];
      }
    });
    getSheet(ss, SHEET_META).getRange('A1').setValue(JSON.stringify(meta));

    SpreadsheetApp.flush();
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch(e2) {}
  }
}

// ============================================================
// シート↔オブジェクト変換ユーティリティ
// ============================================================
// 日付フィールド（Sheetsが自動的にDate型にしてしまう列名）
var DATE_COLS = { 'date': true };

function sheetToObjects(sheet, cols) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var tz = Session.getScriptTimeZone();
  var values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
  return values
    .filter(function(row) { return row[0] !== '' && row[0] !== null; })
    .map(function(row) {
      var obj = {};
      cols.forEach(function(col, i) {
        var v = row[i];
        if (v === '' || v === null || v === undefined) {
          obj[col] = undefined;
        } else if (v instanceof Date) {
          // Date型は yyyy-MM-dd 文字列に変換
          obj[col] = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        } else if (typeof v === 'number') {
          obj[col] = v;
        } else if (typeof v === 'boolean') {
          obj[col] = v;
        } else {
          // 数値文字列は数値に変換（ただし日付フィールドは除外）
          if (DATE_COLS[col]) {
            obj[col] = String(v);
          } else {
            var n = Number(v);
            obj[col] = (!isNaN(n) && v !== '') ? n : String(v);
          }
        }
      });
      // undefinedキーを削除
      Object.keys(obj).forEach(function(k) {
        if (obj[k] === undefined) delete obj[k];
      });
      return obj;
    });
}

function objectsToSheet(sheet, cols, objects) {
  // ヘッダー行を確認（なければ作成）
  var headerVal = sheet.getRange(1, 1).getValue();
  if (headerVal !== cols[0]) {
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    sheet.setFrozenRows(1);
    styleHeader(sheet, cols.length);
  }

  // 既存データをクリア（ヘッダー以外）
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, cols.length).clearContent();
  }

  if (objects.length === 0) return;

  // 新しいデータを書き込み
  var rows = objects.map(function(obj) {
    return cols.map(function(col) {
      var v = obj[col];
      if (v === undefined || v === null) return '';
      return v;
    });
  });

  sheet.getRange(2, 1, rows.length, cols.length).setValues(rows);
}

// ============================================================
// ユーザー情報
// ============================================================
function getUser() {
  try {
    var email = Session.getActiveUser().getEmail();
    var name = email ? email.split('@')[0] : '不明';
    return { email: email || '', name: name };
  } catch(e) {
    return { email: '', name: '不明' };
  }
}

// ============================================================
// 操作ログ
// ============================================================
function addLog(action, target, detail, userName) {
  try {
    var ss = getSpreadsheet();
    var sheet = getSheet(ss, SHEET_LOGS);
    var email = '';
    try { email = Session.getActiveUser().getEmail() || ''; } catch(e2) {}
    var name = userName || (email ? email.split('@')[0] : '不明');
    var tz = Session.getScriptTimeZone();
    var now = Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd HH:mm:ss');
    sheet.appendRow([now, email, name, action || '', target || '', detail || '']);
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function getLogs() {
  try {
    var ss = getSpreadsheet();
    var sheet = getSheet(ss, SHEET_LOGS);
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];
    var startRow = Math.max(2, lastRow - 299);
    var numRows = lastRow - startRow + 1;
    var data = sheet.getRange(startRow, 1, numRows, 6).getValues();
    data.reverse();
    var tz = Session.getScriptTimeZone();
    return data.map(function(row) {
      var dt = row[0];
      if (dt instanceof Date) dt = Utilities.formatDate(dt, tz, 'yyyy/MM/dd HH:mm:ss');
      else dt = String(dt);
      return {
        datetime: dt,
        email: row[1],
        name: row[2] || (row[1] ? String(row[1]).split('@')[0] : '不明'),
        action: row[3],
        target: row[4],
        detail: row[5]
      };
    });
  } catch(e) {
    return [];
  }
}

// ============================================================
// メール通知設定
// ============================================================
function getNotificationSettings() {
  try {
    var props = PropertiesService.getScriptProperties();
    return {
      email:   props.getProperty('NOTIFY_EMAIL') || '',
      enabled: props.getProperty('NOTIFY_ENABLED') === 'true'
    };
  } catch(e) {
    return { email: '', enabled: false };
  }
}

function saveNotificationSettings(settings) {
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('NOTIFY_EMAIL',   settings.email || '');
    props.setProperty('NOTIFY_ENABLED', settings.enabled ? 'true' : 'false');
    setupEmailTrigger(settings.enabled);
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function setupEmailTrigger(enabled) {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'checkAndNotifyLowStock') ScriptApp.deleteTrigger(t);
  });
  if (enabled) {
    ScriptApp.newTrigger('checkAndNotifyLowStock').timeBased().everyDays(1).atHour(8).create();
  }
}

function checkAndNotifyLowStock() {
  var props = PropertiesService.getScriptProperties();
  var email   = props.getProperty('NOTIFY_EMAIL');
  var enabled = props.getProperty('NOTIFY_ENABLED') === 'true';
  if (!enabled || !email) return;

  var data;
  try { data = JSON.parse(loadAllData()); } catch(e) { return; }

  var lowItems = [];
  (data.products || []).forEach(function(p) {
    if ((p.min || 0) > 0 && (p.stock || 0) <= p.min) {
      lowItems.push({ name: p.name, stock: p.stock || 0, min: p.min, unit: p.unit || '個', type: '商品' });
    }
  });
  (data.materials || []).forEach(function(m) {
    if ((m.minStock || 0) <= 0) return;
    var stock = m.type === '染料' ? Math.max(0, (m.weightKg||0) - (m.tareKg||0)) : (m.stock || 0);
    if (stock <= m.minStock) {
      lowItems.push({ name: m.name, stock: stock, min: m.minStock, unit: m.type === '染料' ? 'kg' : (m.unit||'個'), type: m.type });
    }
  });

  if (lowItems.length === 0) return;

  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd');
  var subject = '【在庫アラート】低在庫商品が ' + lowItems.length + ' 件あります (' + today + ')';
  var body = '以下の商品が最低在庫を下回っています。\n\n';
  lowItems.forEach(function(item) {
    body += '▶ [' + item.type + '] ' + item.name + '\n';
    body += '   現在: ' + item.stock + item.unit + ' / 最低: ' + item.min + item.unit + '\n\n';
  });
  body += '在庫管理アプリで確認してください。';
  try { MailApp.sendEmail({ to: email, subject: subject, body: body }); } catch(e) {}
}

function sendTestNotificationEmail(email) {
  try {
    MailApp.sendEmail({
      to: email,
      subject: '【テスト】在庫管理アプリ メール通知テスト',
      body: 'このメールは在庫管理アプリからのテスト送信です。\n正常に受信できていれば設定は完了です。'
    });
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
// 月次レポート設定
// ============================================================
function getReportSettings() {
  try {
    var props = PropertiesService.getScriptProperties();
    return {
      email:   props.getProperty('REPORT_EMAIL') || '',
      enabled: props.getProperty('REPORT_ENABLED') === 'true',
      day:     parseInt(props.getProperty('REPORT_DAY') || '1', 10)
    };
  } catch(e) {
    return { email: '', enabled: false, day: 1 };
  }
}

function saveReportSettings(settings) {
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('REPORT_EMAIL',   settings.email || '');
    props.setProperty('REPORT_ENABLED', settings.enabled ? 'true' : 'false');
    props.setProperty('REPORT_DAY',     String(settings.day || 1));
    setupMonthlyTrigger(settings.enabled);
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function setupMonthlyTrigger(enabled) {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendMonthlyReport') ScriptApp.deleteTrigger(t);
  });
  if (enabled) {
    var props = PropertiesService.getScriptProperties();
    var day = parseInt(props.getProperty('REPORT_DAY') || '1', 10);
    ScriptApp.newTrigger('sendMonthlyReport').timeBased().onMonthDay(day).atHour(8).create();
  }
}

function sendMonthlyReport() {
  var props = PropertiesService.getScriptProperties();
  var email   = props.getProperty('REPORT_EMAIL');
  var enabled = props.getProperty('REPORT_ENABLED') === 'true';
  if (!enabled || !email) return;

  var data;
  try { data = JSON.parse(loadAllData()); } catch(e) { return; }

  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var yyyy = prevMonth.getFullYear();
  var mm   = String(prevMonth.getMonth() + 1).padStart(2, '0');
  var prefix = yyyy + '-' + mm;

  var movements = (data.movements || []).filter(function(m) {
    return m.cat === 'product' && String(m.date || '').startsWith(prefix);
  });

  var inMap = {}, outMap = {};
  movements.forEach(function(m) {
    if (m.type === 'in') inMap[m.itemId] = (inMap[m.itemId] || 0) + (m.qty || 0);
    else outMap[m.itemId] = (outMap[m.itemId] || 0) + (m.qty || 0);
  });

  var subject = '【月次レポート】' + yyyy + '年' + mm + '月 在庫サマリ';
  var body = yyyy + '年' + mm + '月の入出庫サマリです。\n\n';
  body += '■ 入庫件数: ' + movements.filter(function(m){return m.type==='in';}).length + '件\n';
  body += '■ 出庫件数: ' + movements.filter(function(m){return m.type!=='in';}).length + '件\n\n';
  body += '--- 商品別入出庫 ---\n';
  var allIds = Object.keys(Object.assign({}, inMap, outMap));
  if (allIds.length === 0) {
    body += '（当月の入出庫記録なし）\n';
  } else {
    allIds.forEach(function(pid) {
      var p = (data.products || []).find(function(x){ return x.id === pid; });
      var name = p ? p.name : pid;
      var unit = p ? (p.unit || '個') : '';
      body += '▶ ' + name + '\n';
      if (inMap[pid])  body += '   入庫: +' + inMap[pid]  + unit + '\n';
      if (outMap[pid]) body += '   出庫: -' + outMap[pid] + unit + '\n';
    });
  }
  body += '\n在庫管理アプリより自動送信';
  try { MailApp.sendEmail({ to: email, subject: subject, body: body }); } catch(e) {}
}

function sendMonthlyReportNow() {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('REPORT_EMAIL');
  if (!email) return { ok: false, error: 'メールアドレスが設定されていません' };
  try { sendMonthlyReport(); return { ok: true }; } catch(e) { return { ok: false, error: e.message }; }
}

// ============================================================
// 商品画像（Google Drive）
// ============================================================
function uploadProductImage(base64Data, filename) {
  try {
    var props = PropertiesService.getScriptProperties();
    var folderId = props.getProperty('IMAGE_FOLDER_ID');
    var folder;
    if (folderId) {
      try { folder = DriveApp.getFolderById(folderId); } catch(e) { folderId = null; }
    }
    if (!folderId) {
      folder = DriveApp.createFolder('在庫管理アプリ_商品画像');
      props.setProperty('IMAGE_FOLDER_ID', folder.getId());
    }
    var parts = base64Data.split(',');
    var mime  = parts[0].match(/:(.*?);/)[1];
    var bytes = Utilities.base64Decode(parts[1]);
    var blob  = Utilities.newBlob(bytes, mime, filename);
    var existing = folder.getFilesByName(filename);
    while (existing.hasNext()) { existing.next().setTrashed(true); }
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://lh3.googleusercontent.com/d/' + file.getId();
    return { ok: true, url: url, fileId: file.getId() };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function deleteProductImage(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
// Google Drive スプレッドシートインポート用
// ============================================================
function getDriveSpreadsheets(searchQuery) {
  try {
    var q = 'mimeType="application/vnd.google-apps.spreadsheet" and trashed=false';
    if (searchQuery && searchQuery.trim()) {
      q += ' and title contains "' + searchQuery.replace(/"/g, '') + '"';
    }
    var files = DriveApp.searchFiles(q);
    var result = [];
    var count = 0;
    while (files.hasNext() && count < 200) {
      var f = files.next();
      result.push({ id: f.getId(), name: f.getName(), modified: Utilities.formatDate(f.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy/MM/dd') });
      count++;
    }
    return result;
  } catch(e) {
    throw new Error('Driveファイル一覧取得エラー: ' + e.message);
  }
}

function getSpreadsheetSheets(spreadsheetId) {
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    return ss.getSheets().map(function(s) { return { name: s.getName(), index: s.getIndex() - 1 }; });
  } catch(e) {
    throw new Error('スプレッドシートを開けませんでした: ' + e.message);
  }
}

function getSpreadsheetSheetData(spreadsheetId, sheetName) {
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
    if (!sheet) throw new Error('シートが見つかりません: ' + sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow === 0 || lastCol === 0) return [];
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    return values.filter(function(row) { return row.some(function(cell) { return cell !== ''; }); });
  } catch(e) {
    throw new Error('データ取得に失敗しました: ' + e.message);
  }
}

// ============================================================
// 自動タスク（月次バックアップ・古い履歴削除）
// ============================================================
function autoMonthlyBackup() {
  try {
    var ss = getSpreadsheet();
    var now = new Date();
    var label = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM');
    var sheetName = 'バックアップ_' + label;
    var existing = ss.getSheetByName(sheetName);
    if (existing) ss.deleteSheet(existing);
    var backup = ss.insertSheet(sheetName);
    backup.getRange('A1').setValue(loadAllData());
    backup.getRange('B1').setValue('バックアップ日時: ' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'));
    var cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 6);
    var cutoffLabel = Utilities.formatDate(cutoff, 'Asia/Tokyo', 'yyyy-MM');
    ss.getSheets().forEach(function(s) {
      var n = s.getName();
      if (n.indexOf('バックアップ_') === 0) {
        var m = n.replace('バックアップ_', '');
        if (m < cutoffLabel) ss.deleteSheet(s);
      }
    });
    Logger.log('✅ 月次バックアップ完了: ' + sheetName);
  } catch(e) {
    Logger.log('❌ バックアップエラー: ' + e.message);
  }
}

function autoTrimMovements() {
  try {
    var data = JSON.parse(loadAllData());
    var cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6);
    var cutoffStr = Utilities.formatDate(cutoff, 'Asia/Tokyo', 'yyyy-MM-dd');
    var before = (data.movements || []).length;
    data.movements = (data.movements || []).filter(function(m) {
      return !m.date || m.date >= cutoffStr;
    });
    var deleted = before - data.movements.length;
    if (deleted > 0) {
      saveAllData(JSON.stringify(data));
      Logger.log('✅ 古い履歴削除完了: ' + deleted + '件');
    }
  } catch(e) {
    Logger.log('❌ 履歴削除エラー: ' + e.message);
  }
}

function setupAutoTasks() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'autoMonthlyBackup' || fn === 'autoTrimMovements') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('autoMonthlyBackup').timeBased().onMonthDay(1).atHour(3).create();
  ScriptApp.newTrigger('autoTrimMovements').timeBased().onMonthDay(1).atHour(4).create();
  Logger.log('✅ 自動タスク設定完了\n・毎月1日 03:00 バックアップ\n・毎月1日 04:00 古い履歴削除（6ヶ月以上）');
}

// ============================================================
// 初回セットアップ（手動実行）
// ============================================================
function setupSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty('SPREADSHEET_ID');
  if (existingId) {
    try {
      var existing = SpreadsheetApp.openById(existingId);
      Logger.log('既存のスプレッドシートを使用します: ' + existing.getUrl());
      return existing.getUrl();
    } catch(e) {}
  }
  var ss = SpreadsheetApp.create('在庫管理データ');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  var dataSheet = ss.getActiveSheet();
  dataSheet.setName(SHEET_PRODUCTS);
  initSheet(dataSheet, SHEET_PRODUCTS);
  [SHEET_MATERIALS, SHEET_MOVEMENTS, SHEET_META, SHEET_LOGS].forEach(function(name) {
    initSheet(ss.insertSheet(name), name);
  });
  var url = ss.getUrl();
  Logger.log('スプレッドシートを作成しました: ' + url);
  return url;
}

// ============================================================
// データ移行（旧セル方式→新シート行方式）
// 手動で一度だけ実行してください
// ============================================================
function migrateFromCells() {
  try {
    var ss = getSpreadsheet();

    // 旧DATAシートからデータ取得
    var dataSheet = ss.getSheetByName('DATA');
    if (!dataSheet) throw new Error('DATAシートが見つかりません');

    var vals = dataSheet.getRange('A1:A5').getValues();
    var d1={}, d2={}, d3={}, d4={}, d5={};
    try { d1 = JSON.parse(vals[0][0] || '{}'); } catch(e) {}
    try { d2 = JSON.parse(vals[1][0] || '{}'); } catch(e) {}
    try { d3 = JSON.parse(vals[2][0] || '{}'); } catch(e) {}
    try { d4 = JSON.parse(vals[3][0] || '{}'); } catch(e) {}
    try { d5 = JSON.parse(vals[4][0] || '{}'); } catch(e) {}

    var merged = Object.assign({}, d4, d3, d2, d1);
    merged.materials = (d2.materials || []).concat(d5.readyMade || []);

    Logger.log('移行対象: 商品' + (merged.products||[]).length + '件 / 素材' + (merged.materials||[]).length + '件 / 履歴' + (merged.movements||[]).length + '件');

    // 新シートに保存
    var result = saveAllData(JSON.stringify(merged));
    if (result.ok) {
      Logger.log('✅ 移行完了！');
    } else {
      Logger.log('❌ 移行エラー: ' + result.error);
    }
    return result;
  } catch(e) {
    Logger.log('❌ 移行エラー: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ============================================================
// 委託先を一括追加（手動で一度だけ実行）
// ============================================================
function addConsigneesOnce() {
  try {
    var data = JSON.parse(loadAllData());
    if (!data.consignees) data.consignees = [];

    var newConsignees = [
      {
        id: 'c_kitahama',
        name: 'kitahama blue stories',
        address: '760-0031 香川県高松市北浜町4-10',
        person: '田村さん',
        email: '',
        contact: '087-823-5220',
        notes: '委託先'
      },
      {
        id: 'c_kurikiruan',
        name: '栗林庵',
        address: '760-0073 香川県高松市栗林町１丁目２０−１６',
        person: '',
        email: '',
        contact: '087-812-3155',
        notes: '委託先'
      },
      {
        id: 'c_omochaya',
        name: '讃岐おもちゃ美術館shop・cafe',
        address: '760-0042 香川県高松市大工町８−１',
        person: '',
        email: '',
        contact: '087-887-6762',
        notes: '委託先'
      },
      {
        id: 'c_shop88',
        name: '四国ショップ 88',
        address: '760-0019 香川県高松市サンポート２−１',
        person: '',
        email: '',
        contact: '087-822-0459',
        notes: '委託先'
      },
      {
        id: 'c_takinomiya',
        name: '道の駅 滝宮',
        address: '761-2305 香川県綾歌郡綾川町滝宮１５７８',
        person: '',
        email: '',
        contact: '087-876-5018',
        notes: '委託先'
      }
    ];

    // 重複チェック（idが存在しないものだけ追加）
    var existingIds = data.consignees.map(function(c) { return c.id; });
    var added = 0;
    newConsignees.forEach(function(nc) {
      if (existingIds.indexOf(nc.id) < 0) {
        data.consignees.push(nc);
        added++;
      }
    });

    var result = saveAllData(JSON.stringify(data));
    Logger.log('✅ 委託先追加完了！ ' + added + '件追加（合計 ' + data.consignees.length + '件）');
    return result;
  } catch(e) {
    Logger.log('❌ エラー: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ============================================================
// 委託売上記録（Telegramボットから呼び出し）
// MOVEMENTSシートに追記 + PRODUCTSシートの在庫を直接減算
// ============================================================
function addConsignmentSales(body) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var ss = getSpreadsheet();
    var movSheet  = getSheet(ss, SHEET_MOVEMENTS);
    var prodSheet = getSheet(ss, SHEET_PRODUCTS);
    var tz = Session.getScriptTimeZone();

    var consigneeId   = body.consigneeId   || '';
    var consigneeName = body.consigneeName || '';
    var date   = body.date  || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var notes  = body.notes || ('委託売上: ' + consigneeName);
    var bulkId = 'bot_' + new Date().getTime();
    var items  = body.items || [];

    // PRODUCTSシートを id→行番号 でマップ化（ヘッダー除く）
    var prodData   = prodSheet.getDataRange().getValues();
    var idCol      = PROD_COLS.indexOf('id');    // 0
    var stockCol   = PROD_COLS.indexOf('stock'); // 4
    var prodRowMap = {};
    for (var i = 1; i < prodData.length; i++) {
      var pid = prodData[i][idCol];
      if (pid) prodRowMap[pid] = i + 1;
    }

    var results = [];
    items.forEach(function(item) {
      var qty = item.qty || 0;

      // MOVEMENTS に追記（'consign_out' タイプで記録）
      var movId = 'mv_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 6);
      movSheet.appendRow([
        movId, 'product', item.productId || '', 'consign_out',
        qty, item.unit || '個', consigneeId, date, notes, 'ふにょりんBot', bulkId
      ]);

      // PRODUCTS の在庫を減算（0以下にはしない）
      var rowNum = prodRowMap[item.productId];
      if (rowNum && qty > 0) {
        var currentStock = Number(prodData[rowNum - 1][stockCol]) || 0;
        var newStock = Math.max(0, currentStock - qty);
        prodSheet.getRange(rowNum, stockCol + 1).setValue(newStock);
        prodData[rowNum - 1][stockCol] = newStock; // 同商品が複数ある場合に対応
      }

      results.push({ productName: item.productName || item.productId, qty: qty });
    });

    SpreadsheetApp.flush();
    return { ok: true, count: items.length, results: results };
  } catch(e) {
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch(e2) {}
  }
}
