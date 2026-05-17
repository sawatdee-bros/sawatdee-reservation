/**
 * サワディ兄弟 予約メール送信
 *
 * 【再デプロイ手順・絶対厳守】
 * ✅ 正:「デプロイを管理」→ 既存デプロイの鉛筆 →「新しいバージョン」→「デプロイ」
 *    （URL は変わらない・reservation_settings の email_endpoint の再設定不要）
 * ❌ 誤:「新しいデプロイ」を選ぶ
 *    （新 URL が発行され、本店 reservation_settings の email_endpoint は古いコードを指したまま）
 *
 * 過去事例: 2026-04-23 売上バックアップ GAS でこの誤手順により1週間売上欠損。
 *
 * 【MVP 段階の制約】
 * テンプレートは GAS 内ハードコード。
 * SaaS 化時に Firebase reservation_settings/email_template への移行検討。
 * 差し込み変数（店名・電話・予約日時等）と本文の境界を明確に保つこと（移行容易化のため）。
 *
 * 【店名の取得元】
 * 店名は POS 側 /store_config/store_name から取得（重複データ回避）。
 * 電話・住所は予約側 /tenants/{tid}/reservation_settings/store_info から取得。
 * 将来 SaaS 化時に store_info を POS store_config に統合する想定。
 *
 * 【プロジェクト管理】
 * このスクリプトはスタンドアロン GAS プロジェクト「サワディ兄弟 予約メール送信」として
 * 単独運用。POS の firebase_export.gs / 売上バックアップ用 GAS とは別プロジェクト。
 */

// Firebase Realtime Database ベース URL（POS と共通プロジェクト・asia-southeast1）
var FIREBASE_BASE = 'https://sawatdee-bros-default-rtdb.asia-southeast1.firebasedatabase.app';

/**
 * Web App エントリポイント。
 * リクエスト形式（reservation 側 admin.html から POST）:
 * {
 *   tenant_id:      string,    // 必須・テナント ID（本店時 "sawatdee-bros"）
 *   reservation_id: string,    // 必須・Firebase push ID
 *   date:           "YYYY-MM-DD",
 *   time_slot:      "HH:MM-HH:MM",
 *   party_size:     number (1-20),
 *   email:          string,    // 必須・送信先
 *   name:           string,    // 必須・お客様名
 *   reservation_no: string,    // 必須・予約番号（push ID 末尾6文字）
 *   course_name:    string,    // 任意・選択コース名
 *   child_count:    number     // 任意・お子様人数（小学生以下）
 * }
 *
 * レスポンス: { ok: boolean, error?: string }
 */
function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: 'invalid_json' });
  }

  // パラメータ検証（必須フィールド）
  var required = ['tenant_id', 'reservation_id', 'date', 'time_slot', 'party_size', 'email', 'name', 'reservation_no'];
  for (var i = 0; i < required.length; i++) {
    var k = required[i];
    if (payload[k] === undefined || payload[k] === null || payload[k] === '') {
      return jsonResponse({ ok: false, error: 'missing_field:' + k });
    }
  }

  // 形式バリデーション（abuse 防止）
  if (typeof payload.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || payload.email.length > 254) {
    return jsonResponse({ ok: false, error: 'invalid_email' });
  }
  if (typeof payload.party_size !== 'number' || payload.party_size < 1 || payload.party_size > 20) {
    return jsonResponse({ ok: false, error: 'invalid_party_size' });
  }
  if (typeof payload.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    return jsonResponse({ ok: false, error: 'invalid_date' });
  }
  if (typeof payload.time_slot !== 'string' || payload.time_slot.length > 20) {
    return jsonResponse({ ok: false, error: 'invalid_time_slot' });
  }
  if (typeof payload.name !== 'string' || payload.name.length < 1 || payload.name.length > 50) {
    return jsonResponse({ ok: false, error: 'invalid_name' });
  }
  if (typeof payload.reservation_no !== 'string' || payload.reservation_no.length > 16) {
    return jsonResponse({ ok: false, error: 'invalid_reservation_no' });
  }
  if (typeof payload.tenant_id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(payload.tenant_id)) {
    return jsonResponse({ ok: false, error: 'invalid_tenant_id' });
  }
  if (typeof payload.reservation_id !== 'string' || payload.reservation_id.length > 40) {
    return jsonResponse({ ok: false, error: 'invalid_reservation_id' });
  }
  // 任意フィールド検証
  if (payload.course_name !== undefined && payload.course_name !== null && payload.course_name !== '') {
    if (typeof payload.course_name !== 'string' || payload.course_name.length > 100) {
      return jsonResponse({ ok: false, error: 'invalid_course_name' });
    }
  }
  if (payload.child_count !== undefined && payload.child_count !== null) {
    if (typeof payload.child_count !== 'number' || payload.child_count < 0 || payload.child_count > 20) {
      return jsonResponse({ ok: false, error: 'invalid_child_count' });
    }
  }

  try {
    // 店名（POS 共有）と店舗連絡先（予約側）を取得
    var storeName = fetchJson(FIREBASE_BASE + '/store_config/store_name.json') || 'サワディ兄弟';
    var storeInfo = fetchJson(FIREBASE_BASE + '/tenants/' + encodeURIComponent(payload.tenant_id) + '/reservation_settings/store_info.json') || {};

    var ctx = {
      name: payload.name,
      date: payload.date,
      time_slot: payload.time_slot,
      party_size: payload.party_size,
      child_count: (typeof payload.child_count === 'number' && payload.child_count > 0) ? payload.child_count : 0,
      course_name: payload.course_name || '',
      reservation_no: payload.reservation_no,
      store_name: storeName,
      store_phone: storeInfo.phone || '',
      store_address: storeInfo.address || ''
    };

    // メール送信
    var subject = buildSubject(ctx);
    var body = buildBody(ctx);
    var sendOpts = {
      to: payload.email,
      subject: subject,
      body: body,
      name: storeName  // From: の表示名
    };
    if (storeInfo.reply_email) {
      sendOpts.replyTo = storeInfo.reply_email;
    }
    MailApp.sendEmail(sendOpts);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'send_failed:' + (err && err.message ? err.message : String(err)) });
  }
}

/**
 * 件名テンプレ。差し込み変数を使う形で本文と分離（将来 Firebase 化時に対応容易）。
 */
function buildSubject(v) {
  return '【' + v.store_name + '】ご予約を承りました';
}

/**
 * 本文テンプレ。プレーンテキスト・差し込み値を変数 v.* で受ける。
 *
 * 【SaaS 化移行時の注意】
 * テンプレ文字列を Firebase 化する時は、{name} {date} {time_slot} 等の
 * 差し込み変数を {} 形式に置き換え、ここの buildBody は単純な置換ロジックに
 * 置き換える想定。本文の文言と差し込み箇所の境界をここで明確に保つ。
 */
function buildBody(v) {
  var partyLine = 'ご人数:     ' + v.party_size + '名様';
  if (v.child_count > 0) partyLine += '（うちお子様 ' + v.child_count + '名）';

  var lines = [
    v.name + ' 様',
    '',
    'このたびは ' + v.store_name + ' へのご予約ありがとうございます。',
    '以下の内容でお席をご用意してお待ちしております。',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    'ご予約日時: ' + formatDateJa(v.date) + ' ' + v.time_slot,
    partyLine
  ];
  if (v.course_name) lines.push('コース:     ' + v.course_name);
  lines.push('予約番号:   ' + v.reservation_no);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('【ご来店時のお願い】');
  lines.push('・ご予約時刻を15分過ぎてもご連絡いただけない場合、');
  lines.push('  キャンセル扱いとなる場合がございます。');
  lines.push('・ご変更・キャンセルはお電話でご連絡ください。');
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(v.store_name);
  if (v.store_phone) lines.push('TEL: ' + v.store_phone);
  if (v.store_address) lines.push('住所: ' + v.store_address);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

function formatDateJa(ymd) {
  // "2026-05-09" → "2026年5月9日(土)"
  var parts = ymd.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  var date = new Date(y, m - 1, d);
  var dows = ['日', '月', '火', '水', '木', '金', '土'];
  return y + '年' + m + '月' + d + '日(' + dows[date.getDay()] + ')';
}

function fetchJson(url) {
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) {
    var text = resp.getContentText();
    if (!text || text === 'null') return null;
    return JSON.parse(text);
  }
  return null;
}

/**
 * Apps Script Web App は HTTP ステータスコードを直接返せないため、
 * クライアント（admin.html）は body の `ok` フィールドで成否を判定する。
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 手動テスト用。GAS エディタで実行ボタンから叩いて、Firebase 接続と送信が動くか確認する。
 * 送信先は引数のメアドに置き換えてから実行すること（実行前に手動編集）。
 */
function _manualTest() {
  var fakeEvent = {
    postData: {
      contents: JSON.stringify({
        tenant_id: 'sawatdee-bros',
        reservation_id: 'test_xxxxxxxxxxxx',
        date: '2026-12-31',
        time_slot: '19:00-21:00',
        party_size: 4,
        child_count: 1,
        course_name: 'サワディ兄弟コース（飲み放題付き）',
        email: 'REPLACE_ME@example.com',  // ← 自分のメアドに置き換えて実行
        name: 'テスト 太郎',
        reservation_no: 'TEST01'
      })
    }
  };
  var result = doPost(fakeEvent);
  Logger.log(result.getContent());
}
