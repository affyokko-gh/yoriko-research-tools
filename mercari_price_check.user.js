// ==UserScript==
// @name         メルカリ実勢価格チェック（旧裏ポケカ）
// @namespace    yoriko.research
// @version      2.4
// @description  メルカリ検索結果（安い順）から固定価格の出品を安い順に6件ひらき、「商品の状態」を読んで実勢価格の傾向を一覧にする。シートの K実勢価格・L参考ページ・M実勢メモ の3セルを1回でコピーできる
// @match        https://jp.mercari.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        GM_removeValueChangeListener
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ===== 自分の基準に合わせて変更する所 =====
  const N_DEFAULT = 6;              // 安い順に何件ひらくか
  const ADOPT = ['新品、未使用', '未使用に近い', '目立った傷や汚れなし', 'やや傷や汚れあり']; // 実勢価格として採用する状態
  const TIMEOUT = 25000;            // 1件あたりの読み取り待ち時間(ms)
  // ==========================================

  const CONDS = ['新品、未使用', '未使用に近い', '目立った傷や汚れなし', 'やや傷や汚れあり', '傷や汚れあり', '全体的に状態が悪い'];
  const $ = (s, r = document) => r.querySelector(s);
  const yen = n => '¥' + Number(n).toLocaleString('ja-JP');

  // ---------- 商品ページ側：状態を読んで結果を返す ----------
  const itemMatch = location.pathname.match(/^\/(?:item\/(m\d+)|shops\/product\/(\w+))/);
  if (itemMatch) {
    const id = itemMatch[1] || itemMatch[2];
    const job = GM_getValue('yr_job', null);
    if (!job || !job.pending.includes(id)) return;   // 自分で開いたページでは何もしない
    const t0 = Date.now();
    const banner = document.createElement('div');
    banner.textContent = '実勢チェック：商品の状態を読み取り中…（自動で閉じます）';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff0211;color:#fff;padding:6px;text-align:center;z-index:999999;font:14px sans-serif';
    document.body.appendChild(banner);
    const timer = setInterval(() => {
      const text = document.body.innerText;
      const m = text.match(/商品の状態\s*\n?\s*(新品、未使用|未使用に近い|目立った傷や汚れなし|やや傷や汚れあり|傷や汚れあり|全体的に状態が悪い)/);
      const sold = /売り切れ|SOLD/.test(text.slice(0, 3000));
      if (m || Date.now() - t0 > TIMEOUT) {
        clearInterval(timer);
        const title = (document.title || '').replace(/\s*[-|｜].*$/, '').trim();
        GM_setValue('yr_result_' + id, { id, cond: m ? m[1] : '読めず', sold, title, url: location.href, at: Date.now() });
        setTimeout(() => window.close(), 300);
      }
    }, 800);
    return;
  }

  // ---------- 検索ページ側 ----------
  if (!location.pathname.startsWith('/search')) return;

  function collect() {
    const seen = new Set(), out = [];
    document.querySelectorAll('a[href*="/item/m"], a[href*="/shops/product/"]').forEach(a => {
      const mm = a.getAttribute('href').match(/\/(?:item\/(m\d+)|shops\/product\/(\w+))/);
      if (!mm) return;
      const id = mm[1] || mm[2];
      if (seen.has(id)) return;
      const text = a.innerText || '';
      const pm = text.match(/¥\s?([\d,]+)/);
      if (!pm) return;
      const auction = /現在/.test(text);
      const sold = /SOLD|売り切れ/.test(text);
      const name = text.split('\n').map(s => s.trim()).filter(s => s && !/[¥￥]/.test(s) && !/^[\d,]+\s*円?$/.test(s) && !/^(SOLD|売り切れ|現在|送料込み|即購入可)/.test(s))[0] || '';
      const imgEl = a.querySelector('img');
      let raw = '';
      if (imgEl) {
        raw = imgEl.currentSrc || imgEl.src || imgEl.getAttribute('data-src') || '';
        if (!raw || raw.startsWith('data:')) {               // 遅延読み込みでまだ実体がない場合は srcset / source から拾う
          const ss = imgEl.getAttribute('srcset') || (a.querySelector('source') || {}).getAttribute?.('srcset') || '';
          raw = (ss.split(',')[0] || '').trim().split(' ')[0] || '';
        }
      }
      if (!/^https?:/.test(raw) && mm[1]) raw = `https://static.mercdn.net/c!/w=240,f=webp/thumb/photos/${mm[1]}_1.jpg`;   // それでも無ければ商品IDから組み立てる
      const img = raw.replace(/w=\d+/, 'w=720');   // メルカリのサムネURLは w=240 などの指定を大きくすると高解像度になる（失敗時は raw に戻す）
      seen.add(id);
      out.push({ img, raw, id, url: 'https://jp.mercari.com' + (mm[1] ? '/item/' + mm[1] : '/shops/product/' + mm[2]), price: parseInt(pm[1].replace(/,/g, ''), 10), auction, sold, name, on: false });
    });
    return out.sort((a, b) => a.price - b.price);
  }

  let items = [], results = {}, running = false;


  // ---- パネルの表示モード（ヘッダーをドラッグで移動 / 畳む）----
  function setupPanelModes(panel, prefix, headSel) {
    const bar = panel.querySelector(headSel);
    const mk = (id, txt, title) => { const b = document.createElement('button'); b.id = id; b.textContent = txt; b.title = title; b.style.cssText = 'cursor:pointer'; return b; };
    const bMin = mk(prefix + '-min', '▁', '畳む／戻す');
    const closeBtn = bar.querySelector('button:last-child');
    bar.insertBefore(bMin, closeBtn);
    bar.style.cursor = 'move';
    bar.title = 'この帯をドラッグで移動';
    document.body.style.marginRight = '';   // 旧版のサイドバー固定を解除
    panel.style.height = ''; panel.style.borderRadius = '8px'; panel.style.borderWidth = '2px';
    // 帯をダブルクリックで位置と大きさを初期状態（右下）に戻す
    bar.addEventListener('dblclick', e => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      panel.style.left = 'auto'; panel.style.top = 'auto'; panel.style.right = '16px'; panel.style.bottom = '16px';
      GM_setValue(prefix + '_pos', null);
    });
    // 位置の復元
    const pos = GM_getValue(prefix + '_pos', null);
    if (pos && pos.left >= 0 && pos.top >= 0) { panel.style.left = pos.left + 'px'; panel.style.top = pos.top + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto'; }
    // ドラッグ
    let drag = null;
    bar.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx));
      const top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
      panel.style.left = left + 'px'; panel.style.top = top + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return; drag = null;
      const r = panel.getBoundingClientRect();
      GM_setValue(prefix + '_pos', { left: r.left, top: r.top });
    });
    // 畳む
    let collapsed = GM_getValue(prefix + '_min', false);
    const origW = panel.style.width, origMH = panel.style.maxHeight;
    function apply() {
      [...panel.children].forEach(c => { if (c !== bar.parentElement && c !== bar) c.style.display = collapsed ? 'none' : ''; });
      if (bar.parentElement !== panel) [...bar.parentElement.children].forEach(c => { if (c !== bar) c.style.display = collapsed ? 'none' : ''; });
      panel.style.maxHeight = collapsed ? '60px' : origMH;
      panel.style.width = collapsed ? '320px' : origW;
      bMin.textContent = collapsed ? '▔' : '▁';
      GM_setValue(prefix + '_min', collapsed);
    }
    bMin.onclick = () => { collapsed = !collapsed; apply(); };
    apply();
    return () => {};
  }

  function buildPanel() {
    if ($('#ym-panel')) return;
    const p = document.createElement('div');
    p.id = 'ym-panel';
    p.style.cssText = 'position:fixed;right:16px;bottom:16px;width:700px;max-height:90vh;overflow:auto;background:#fff;border:2px solid #333;border-radius:8px;padding:0 12px 12px;font:12px/1.5 sans-serif;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.3);color:#222';
    p.innerHTML = `
      <div id="ym-head" style="position:sticky;top:0;background:#fff;padding:12px 0 6px;border-bottom:2px solid #333;z-index:2">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
        <b style="font-size:14px">実勢価格チェック <small style="color:#888">v2.4</small></b>
        <span style="flex:1"></span>
        <label>件数 <input id="ym-n" type="number" value="${N_DEFAULT}" min="1" max="15" style="width:44px"></label>
        <button id="ym-run" style="cursor:pointer;background:#ff0211;color:#fff;border:0;border-radius:4px;padding:4px 10px;font-weight:bold">チェック開始</button>
        <button id="ym-none" style="cursor:pointer">全て外す</button>
        <button id="ym-all" style="cursor:pointer">全て入れる</button>
        <button id="ym-reload" style="cursor:pointer">再読込</button>
        <button id="ym-gear" title="シートAPIの設定" style="cursor:pointer">⚙</button>
        <button id="ym-close" style="cursor:pointer">×</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <img id="ym-ref" style="width:120px;height:160px;object-fit:contain;border:1px dashed #999;background:#f4f4f4;cursor:zoom-in" title="比較用の基準画像（クリックで拡大）">
        <div style="flex:1">
          <div style="color:#555">基準画像（eBayのs-l400のURLを貼ると横に表示。Seller Hubでコピーした行の =IMAGE("…") のURL部分でOK）</div>
          <input id="ym-refurl" placeholder="https://i.ebayimg.com/images/g/…/s-l400.jpg" style="width:100%">
          <div style="color:#555">最初は全部チェックなしです。写真を見て同じカードだけチェックを入れてから「チェック開始」（1件でも6件でも可）。サムネイルにマウスを乗せると基準画像と並べて大きく表示します。結果が出た後もチェックを外せば集計から抜けます。</div>
        </div>
      </div>
      <div id="ym-sum"></div>
      </div>
      <div id="ym-zoom" style="display:none;position:fixed;right:740px;bottom:16px;background:#fff;border:2px solid #333;border-radius:8px;padding:8px;z-index:100000;box-shadow:0 4px 16px rgba(0,0,0,.3)">
        <div style="display:flex;gap:8px">
          <div style="text-align:center"><div>基準（eBay）</div><img id="ym-zoom-ref" style="width:300px;height:400px;object-fit:contain;background:#f4f4f4"></div>
          <div style="text-align:center"><div id="ym-zoom-label">メルカリ</div><img id="ym-zoom-it" style="width:300px;height:400px;object-fit:contain;background:#f4f4f4"></div>
        </div>
      </div>
      <div id="ym-settings" style="display:none;border:1px solid #f90;background:#fff8e6;border-radius:6px;padding:6px 8px;margin:6px 0">
        <b>シートAPI 設定</b>（通常は触らない。⚙で閉じる）
        <div style="display:grid;grid-template-columns:100px 1fr;gap:2px 6px;margin-top:4px">
          <label>シートAPI URL</label><input id="ym-api" placeholder="https://script.google.com/macros/s/…/exec" style="font-size:11px">
          <label>APIトークン</label><input id="ym-token" type="password" style="font-size:11px">
        </div>
        <button id="ym-test" style="cursor:pointer;margin-top:4px">接続テスト</button> <span id="ym-testmsg"></span>
      </div>
      <div id="ym-msg" style="min-height:1.2em;color:#080"></div>
      <div id="ym-list"></div>`;
    document.body.appendChild(p);
    const ymBar = $('#ym-head').querySelector('div'); ymBar.id = 'ym-headbar';
    const undock = setupPanelModes(p, 'ym', '#ym-headbar');
    $('#ym-close').onclick = () => { undock(); p.remove(); };
    $('#ym-reload').onclick = () => { items = collect(); results = {}; render(); };
    $('#ym-run').onclick = run;
    $('#ym-api').value = GM_getValue('yr_api', ''); $('#ym-token').value = GM_getValue('yr_token', '');
    $('#ym-gear').onclick = () => { const d = $('#ym-settings'); d.style.display = d.style.display === 'none' ? 'block' : 'none'; };
    $('#ym-test').onclick = () => {
      const url = $('#ym-api').value.trim(), out = $('#ym-testmsg');
      if (!url) { out.textContent = 'URLが空です'; return; }
      out.textContent = '確認中…';
      GM_xmlhttpRequest({ method: 'GET', url, timeout: 20000,
        onload: r => { try { const j = JSON.parse(r.responseText); out.textContent = j.ok ? `OK: ${j.sheet} / ` + (j.tabs || []).map(t => t.missing ? t.tab + '(なし)' : `${t.tab}:見出し${t.headerRow}行目・画像URL列${t.cols['eBay画像URL'] || '不明'}`).join(' / ') : 'NG: ' + j.error; } catch (e) { out.textContent = 'NG: 応答がJSONではありません（デプロイのアクセス設定が「全員」か確認）'; } },
        onerror: () => { out.textContent = 'NG: 通信エラー'; }, ontimeout: () => { out.textContent = 'NG: タイムアウト'; } });
    };
    $('#ym-api').onchange = e => GM_setValue('yr_api', e.target.value.trim());
    $('#ym-token').onchange = e => GM_setValue('yr_token', e.target.value.trim());
    $('#ym-none').onclick = () => { items.forEach(it => it.on = false); render(); };
    $('#ym-all').onclick = () => { items.forEach(it => it.on = !it.auction && !it.sold); render(); };
    $('#ym-refurl').oninput = e => { const u = e.target.value.trim().replace(/^=IMAGE\("(.*)"\)$/, '$1'); $('#ym-ref').src = u; $('#ym-zoom-ref').src = u.replace('s-l400', 's-l1200'); };
    $('#ym-ref').onclick = () => { const z = $('#ym-zoom'); z.style.display = z.style.display === 'none' ? 'block' : 'none'; };
  }

  function render() {
    const list = $('#ym-list');
    let hidden = 0;
    list.innerHTML = items.map((it, i) => {
      const r = results[it.id];
      if (r && (r.sold || !ADOPT.includes(r.cond))) { hidden++; return ''; }   // 傷あり・状態悪・売切は表示しない
      const condTxt = r ? (r.sold ? '売り切れ' : r.cond) : '';
      const ok = r && ADOPT.includes(r.cond) && !r.sold;
      const color = it.auction || it.sold ? '#aaa' : (r ? (ok ? '#060' : '#a00') : '#222');
      return `<div style="display:grid;grid-template-columns:18px 96px 70px 1fr 130px;gap:6px;align-items:center;padding:3px 0;border-top:1px solid #eee;color:${color}">
        <input type="checkbox" data-i="${i}" ${it.on ? 'checked' : ''} ${it.auction || it.sold ? 'disabled' : ''}>
        <a href="${it.url}" target="_blank"><img src="${it.img}" data-zoom="${i}" onerror="if(this.dataset.f!=='1'){this.dataset.f='1';this.src=this.src.replace(/w=720/,'w=240');}" style="width:96px;height:128px;object-fit:contain;background:#f4f4f4;border:1px solid #ddd;cursor:zoom-in"></a>
        <span style="text-align:right">${it.auction ? '現在 ' : ''}${yen(it.price)}</span>
        <a href="${it.url}" target="_blank" style="color:inherit;white-space:normal;line-height:1.3" title="${it.name}">${it.name.slice(0, 70)}</a>
        <span>${it.auction ? 'オークション' : it.sold ? 'SOLD' : condTxt}</span>
      </div>`;
    }).join('') || '出品が読めません。ページを少しスクロールしてから再読込してください。';
    if (hidden) list.innerHTML += `<div style="color:#888;padding:4px 0">（傷や汚れあり・状態が悪い・売切 ${hidden}件は非表示）</div>`;
    list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = e => { items[+e.target.dataset.i].on = e.target.checked; renderSummary(); });
    list.querySelectorAll('img[data-zoom]').forEach(im => {
      const it = items[+im.dataset.zoom];
      im.addEventListener('error', () => { if (it.raw && im.src !== it.raw) { it.img = it.raw; im.src = it.raw; } }, { once: true });
      if (!it.img) im.alt = '画像なし→再読込';
      im.onmouseenter = () => { $('#ym-zoom-it').src = it.img; $('#ym-zoom-label').textContent = 'メルカリ ' + yen(it.price); $('#ym-zoom').style.display = 'block'; };
      im.onmouseleave = () => { $('#ym-zoom').style.display = 'none'; };
    });
    renderSummary();
  }

  function renderSummary() {
    const done = items.filter(it => it.on && results[it.id]).map(it => ({ ...it, ...results[it.id] }));
    const box = $('#ym-sum');
    if (!done.length) { box.innerHTML = ''; return; }
    const adopted = done.filter(d => ADOPT.includes(d.cond) && !d.sold);
    const best = adopted[0];
    const good = adopted.find(d => d.cond !== 'やや傷や汚れあり');
    const memo = adopted.map(d => `${yen(d.price)}(${d.sold ? '売切' : d.cond.replace('目立った傷や汚れなし', '目立った傷なし').replace('やや傷や汚れあり', 'やや傷').replace('傷や汚れあり', '傷あり').replace('全体的に状態が悪い', '状態悪')})`).join('/');
    box.innerHTML = `
      <div style="border:1px solid #ccc;border-radius:6px;padding:8px;background:#fafafa">
        <div><b>実勢最安（やや傷まで）:</b> ${best ? yen(best.price) + '（' + best.cond + '）' : 'なし'}
          ${good && good !== best ? `　<b>目立った傷なし以上の最安:</b> ${yen(good.price)}` : ''}</div>
        <div style="margin:4px 0;color:#444">実勢: ${memo}</div>
        ${best ? '' : '<div style="color:#a00">採用できる状態（やや傷まで）の出品がありません。別の出品にチェックを入れて再チェックしてください。</div>'}
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <button id="ym-write" style="cursor:pointer;background:#3665f3;color:#fff;border:0;border-radius:4px;padding:4px 10px;font-weight:bold">シートに書き込む（基準画像URLの行）</button>
          <button id="ym-cp-all" style="cursor:pointer">K〜M列をコピー</button>
          <span style="color:#666">うまく貼れないときは下の欄を全選択してコピー</span>
        </div>
        <textarea id="ym-tsv" readonly style="width:100%;height:3em;margin-top:4px;font:11px monospace"></textarea>
      </div>`;
    const tsv = [best ? best.price : '', best ? best.url : '', '実勢: ' + memo].join('\t');
    $('#ym-tsv').value = tsv;
    $('#ym-write').onclick = async () => {
      const msg = $('#ym-msg');
      const key = $('#ym-refurl').value.trim().replace(/^=IMAGE\("(.*)"\)$/, '$1');
      if (!key) { msg.style.color = '#c00'; msg.textContent = '基準画像の欄に eBay画像URL（シートのN列）を入れてください。その行を探して書き込みます。'; return; }
      const url = $('#ym-api').value.trim(), token = $('#ym-token').value.trim();
      if (!url || !token) { msg.style.color = '#c00'; msg.textContent = 'シートAPI URL と APIトークンを入力してください。'; return; }
      msg.style.color = '#080'; msg.textContent = 'シートに書き込み中…';
      GM_xmlhttpRequest({
        method: 'POST', url, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, timeout: 30000,
        data: JSON.stringify({ token, action: 'fill', key, values: { '実勢価格': best ? best.price : '', '参考ページ': best ? best.url : '', '実勢メモ': '実勢: ' + memo } }),
        onload: res => { try { const j = JSON.parse(res.responseText); if (j.ok) { msg.textContent = `${j.tab} タブ ${j.row} 行目に書き込みました（${(j.written || []).join('・')}）。`; } else { msg.style.color = '#c00'; msg.textContent = '書き込み失敗: ' + j.error; } } catch (e) { msg.style.color = '#c00'; msg.textContent = '応答が読めません: ' + res.responseText.slice(0, 120); } },
        onerror: () => { msg.style.color = '#c00'; msg.textContent = '通信エラー'; }, ontimeout: () => { msg.style.color = '#c00'; msg.textContent = 'タイムアウト'; },
      });
    };
    $('#ym-cp-all').onclick = () => {
      const msg = $('#ym-msg');
      let ok = false;
      try { GM_setClipboard(tsv, { type: 'text', mimetype: 'text/plain' }); ok = true; } catch (e) { console.warn('GM_setClipboard', e); }
      if (!ok) { try { GM_setClipboard(tsv, 'text'); ok = true; } catch (e) {} }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(() => { ok = true; }).catch(() => {});
      const ta = $('#ym-tsv'); ta.focus(); ta.select();
      try { if (document.execCommand('copy')) ok = true; } catch (e) {}
      msg.style.color = ok ? '#080' : '#c00';
      msg.textContent = ok ? 'K〜M列の3セルをコピーしました。シートの K セル（実勢価格）を1つ選んで貼り付け。' : 'コピーできませんでした。下の欄を全選択して Ctrl+C してください。';
    };
  }

  function waitResult(id) {
    return new Promise(resolve => {
      const t = setTimeout(() => { done(null); }, TIMEOUT + 5000);
      const lid = GM_addValueChangeListener('yr_result_' + id, (name, old, val) => { done(val); });
      function done(v) { clearTimeout(t); try { GM_removeValueChangeListener && GM_removeValueChangeListener(lid); } catch (e) {} resolve(v); }
    });
  }

  function openTab(url) {
    try {
      if (typeof GM_openInTab === 'function') { GM_openInTab(url, { active: false, insert: true, setParent: true }); return 'gm'; }
    } catch (e) { console.warn('GM_openInTab failed', e); }
    const w = window.open(url, '_blank');
    if (!w) throw new Error('別タブを開けませんでした。ブラウザのポップアップブロックで jp.mercari.com を許可してください。');
    return 'window';
  }

  let abort = false;
  async function run() {
    if (running) { abort = true; $('#ym-msg').textContent = '中止します…'; return; }
    const msg = $('#ym-msg');
    try {
      const n = parseInt($('#ym-n').value, 10) || N_DEFAULT;
      const targets = items.filter(it => it.on).slice(0, n);
      if (!targets.length) { msg.textContent = '対象がありません（チェックの入った行がありません）。'; return; }
      running = true; abort = false; results = {};
      $('#ym-run').textContent = '中止';
      targets.forEach(t => GM_setValue('yr_result_' + t.id, null));
      GM_setValue('yr_job', { pending: targets.map(t => t.id), at: Date.now() });
      for (let i = 0; i < targets.length; i++) {
        if (abort) break;
        const t = targets[i];
        msg.style.color = '#080';
        msg.textContent = `${i + 1}/${targets.length} ${yen(t.price)} を確認中…（別タブがひらいて自動で閉じます）`;
        const p = waitResult(t.id);
        openTab(t.url);
        const r = await p;
        results[t.id] = r || { id: t.id, cond: '読めず', sold: false, url: t.url };
        render();
      }
      msg.textContent = abort ? '中止しました。' : `完了。${targets.length}件を確認しました。`;
    } catch (e) {
      msg.style.color = '#c00';
      msg.textContent = 'エラー: ' + (e && e.message ? e.message : e);
      console.error(e);
    } finally {
      GM_setValue('yr_job', null);
      running = false; abort = false;
      $('#ym-run').textContent = 'チェック開始';
    }
  }

  function addLauncher() {
    if ($('#ym-launch')) return;
    const b = document.createElement('button');
    b.id = 'ym-launch';
    b.textContent = '実勢チェック';
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99998;padding:8px 14px;background:#ff0211;color:#fff;border:0;border-radius:20px;font-weight:bold;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    b.onclick = () => { const ex = document.getElementById('ym-panel'); if (ex) { GM_setValue('ym_mode', 'float'); document.body.style.marginRight = ''; ex.remove(); } buildPanel(); items = collect(); results = {}; render(); };
    document.body.appendChild(b);
  }
  addLauncher();
  setInterval(addLauncher, 3000);
})();
