/**
 * 旧裏ポケカ_リサーチシート 書き込み受け口（Apps Script ウェブアプリ）
 *
 * 設置手順:
 *  1. リサーチシートを開く → 拡張機能 → Apps Script
 *  2. 既定の「コード.gs」の中身をこのファイルの内容で置き換えて保存（Ctrl+S）
 *  3. 下の TOKEN を好きな文字列に変える（例: 'yoriko-2026-xxxx'）。Tampermonkey側にも同じ文字列を入れる
 *  4. 右上「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *       説明: research api / 次のユーザーとして実行: 自分 / アクセスできるユーザー: 全員
 *     → デプロイ → 初回は「アクセスを承認」（自分のGoogleアカウントで許可）
 *  5. 表示された「ウェブアプリのURL」（https://script.google.com/macros/s/…/exec）をコピーして Tampermonkey のパネルに貼る
 *
 *  ※「全員」にするのは、Tampermonkey からの呼び出しにGoogleのログイン情報が付かないため。
 *    代わりに TOKEN が一致しない要求はすべて拒否するので、URLとTOKENを人に渡さなければ他人は書き込めない。
 *  ※ コードを直したら「デプロイ」→「デプロイを管理」→ 鉛筆 → バージョン「新バージョン」→ デプロイ で更新（URLは変わらない）
 */

const TOKEN = 'CHANGE-ME';                 // ← 好きな文字列に変える
const DEFAULT_TAB = 'シングル';
const SEARCH_TABS = ['シングル', 'セット', '新裏プロモ'];   // fill（K〜M埋め）で行を探すタブ

// 見出しの一部一致で列を探すためのキー（シートの見出し文言が長くても拾える）
const HEAD_KEYS = {
  '実勢価格': ['実勢価格'],
  '参考ページ': ['参考ページ'],
  '実勢メモ': ['実勢メモ'],
  'eBay画像URL': ['eBay画像URL', '画像URL'],
  '上限': ['仕入れ上限', '仕入上限', '上限'],
  '判定': ['判定'],
  '倍率': ['倍率'],
};

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const info = SEARCH_TABS.map(n => { const sh = ss.getSheetByName(n); return sh ? { tab: n, headerRow: headerRow_(sh), cols: headerMap_(sh), lastRow: lastDataRow_(sh) } : { tab: n, missing: true }; });
  return json_({ ok: true, message: 'research api alive', sheet: ss.getName(), tabs: info });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.token !== TOKEN) return json_({ ok: false, error: 'token mismatch' });
    if (body.action === 'append') return json_(append_(body));
    if (body.action === 'fill') return json_(fill_(body));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// 1行追加: { action:'append', tab:'シングル', cells:[A列の値, B列の値, ...] }
function append_(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(body.tab || DEFAULT_TAB);
  if (!sh) return { ok: false, error: 'tab not found: ' + body.tab };
  const cells = (body.cells || []).map(v => (v === null || v === undefined) ? '' : v);
  const row = Math.max(lastDataRow_(sh), headerRow_(sh)) + 1;
  if (cells.length) sh.getRange(row, 1, 1, cells.length).setValues([cells]);
  writeJudgeFormulas_(sh, row);
  return { ok: true, tab: sh.getName(), row: row };
}

// K〜M埋め: { action:'fill', key:'https://i.ebayimg.com/...', values:{ '実勢価格':2180, '参考ページ':'https://jp.mercari.com/item/...', '実勢メモ':'実勢: ...' } }
// key は eBay画像URL 列と一致する行を探す（タブ指定がなければ SEARCH_TABS を順に探す）
function fill_(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabs = body.tab ? [body.tab] : SEARCH_TABS;
  const key = String(body.key || '').trim();
  if (!key) return { ok: false, error: 'key (eBay画像URL) is empty' };
  for (const name of tabs) {
    const sh = ss.getSheetByName(name);
    if (!sh) continue;
    const cols = headerMap_(sh);
    const keyCol = cols['eBay画像URL'];
    if (!keyCol) continue;
    const first = cols._headerRow + 1;
    const last = lastDataRow_(sh);
    if (last < first) continue;
    const vals = sh.getRange(first, keyCol, last - first + 1, 1).getValues().map(r => String(r[0]).trim());
    // 完全一致 → 画像ID部分の一致（s-l400/s-l1200 の違いを許容）
    const idOf = u => (u.match(/images\/g\/([^\/]+)\//) || [])[1] || u;
    let idx = vals.indexOf(key);
    if (idx < 0) idx = vals.findIndex(v => v && idOf(v) === idOf(key));
    if (idx < 0) continue;
    const row = idx + first;
    const written = [];
    Object.keys(body.values || {}).forEach(k => {
      const c = cols[k];
      if (c) { sh.getRange(row, c).setValue(body.values[k]); written.push(k); }
    });
    writeJudgeFormulas_(sh, row);
    return { ok: true, tab: name, row: row, written: written };
  }
  return { ok: false, error: '該当行が見つかりません（eBay画像URL列に同じURLがある行がない）' };
}

// 見出し行を探す（上から10行以内で「記入日」を含む行。見つからなければ1行目）
function headerRow_(sh) {
  const n = Math.min(10, sh.getLastRow());
  if (n < 1) return 1;
  const v = sh.getRange(1, 1, n, sh.getLastColumn()).getValues();
  for (let i = 0; i < v.length; i++) if (v[i].some(x => String(x).indexOf('記入日') >= 0)) return i + 1;
  return 1;
}

// 見出し行から列番号を引く。HEAD_KEYS の部分一致
function headerMap_(sh) {
  const hr = headerRow_(sh);
  const heads = sh.getRange(hr, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).replace(/\s/g, ''));
  const map = { _headerRow: hr };
  Object.keys(HEAD_KEYS).forEach(name => {
    const i = heads.findIndex(h => HEAD_KEYS[name].some(k => h.indexOf(k) >= 0));
    if (i >= 0) map[name] = i + 1;
  });
  return map;
}

// A列基準の最終データ行（画像列だけ長い等のズレを避けるため、A〜D のどれかに値がある最後の行）
function lastDataRow_(sh) {
  const last = sh.getLastRow();
  if (last < 1) return 1;
  const v = sh.getRange(1, 1, last, 4).getValues();
  for (let i = v.length - 1; i >= 0; i--) if (v[i].some(x => x !== '' && x !== null)) return i + 1;
  return 1;
}

// 判定・倍率の列があれば、その行に式を入れる（上限J・実勢K が埋まると自動で ○△× が出る）
function writeJudgeFormulas_(sh, row) {
  const cols = headerMap_(sh);
  if (!cols['上限'] || !cols['実勢価格']) return;
  const J = colLetter_(cols['上限']), K = colLetter_(cols['実勢価格']);
  if (cols['判定']) sh.getRange(row, cols['判定']).setFormula(`=IF(OR(${K}${row}="",${J}${row}=""),"",IF(${J}${row}<=0,"×",IF(${K}${row}<=${J}${row},"○",IF(${K}${row}<=${J}${row}*1.2,"△","×"))))`);
  if (cols['倍率']) sh.getRange(row, cols['倍率']).setFormula(`=IF(OR(${K}${row}="",${J}${row}<=0),"",ROUND(${K}${row}/${J}${row},2))`);
}

function colLetter_(n) { let s = ''; while (n) { s = String.fromCharCode(64 + ((n - 1) % 26) + 1) + s; n = Math.floor((n - 1) / 26); } return s; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
