// ==UserScript==
// @name         eBay Research パターン検索＆集計パネル
// @namespace    yoriko.research
// @version      1.1.0
// @description  Research Products ページで、パターン（1/2/3）・カテゴリー・Sold/Activeをボタンで指定してKW検索し、全ページを自動でめくって条件に合う商品を集計する。各パターンの条件は自分で編集できる
// @match        https://www.ebay.com/sh/research*
// @updateURL    https://raw.githubusercontent.com/affyokko-gh/yoriko-research-tools/main/research_pattern_panel.user.js
// @downloadURL  https://raw.githubusercontent.com/affyokko-gh/yoriko-research-tools/main/research_pattern_panel.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__yrPanel) return;
  window.__yrPanel = true;

  // ===== 初期設定（パネルで変更でき、変更はこのPCのブラウザに保存される） =====
  const DEFAULTS = {
    1: { days: 7,  minPrice: 50,  maxPrice: '', minSold: 2, cond: 'any',  minProfit: 100 },
    2: { days: 30, minPrice: 150, maxPrice: '', minSold: 4, cond: 'used', minProfit: 1500 },
    3: { days: 90, minPrice: 200, maxPrice: '', minSold: 2, cond: 'used', minProfit: 2000 },
  };
  const DAY_OPTIONS = [[7, '7日'], [30, '30日'], [90, '90日'], [180, '6か月'], [365, '1年']];
  const COND_OPTIONS = [['any', '新品・中古'], ['used', '中古'], ['new', '新品']];
  const COND_ID = { used: '3000', new: '1000' };
  const CATEGORIES = { '1': 'コレクティブルズ', '220': 'トイホビー', '': '全カテゴリー' };
  const MAX_SOLD = 60;                       // Sold集計：60個以上は除外
  const LOT_RE = /\blots?\b|bulk|\d+ ?pcs|\bx\d{2,}\b|\bset of \d{2,}\b/i; // まとめ売り
  const NET_PER_USD = 90.19;                 // 手数料・関税を引いた1ドルあたりの手取り（円）
  const YEN_PER_GRAM = 3;                    // 送料 = 容積重量(g) × 3円
  const MAX_PAGES = 30;                      // 最大ページ数（50件×30＝1,500件）
  const LS = 'yrPanel_';

  // ===== 保存 =====
  const store = {
    get: (k, d) => { try { const v = localStorage.getItem(LS + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} },
  };
  const saved = store.get('patterns', {});
  const PAT = {};
  for (const k of [1, 2, 3]) PAT[k] = { ...DEFAULTS[k], ...(saved[k] || {}) };
  const savePat = () => store.set('patterns', PAT);

  const state = {
    pattern: store.get('pattern', 3),
    cat: store.get('cat', '1'),
    mode: store.get('mode', 'SOLD'),       // SOLD / ACTIVE
    kw: store.get('kw', ''),
    weight: store.get('weight', 500),
    running: false,
    results: [],
    resMode: 'SOLD',
    resPattern: 3,
    rate: 0,                               // Active集計で使った円/ドル換算レート
  };

  // ===== 画面 =====
  const css = `
  #yr-panel{position:fixed;right:16px;bottom:16px;z-index:99999;width:330px;max-height:92vh;overflow:auto;background:#fff;border:1px solid #c7c7c7;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);font:13px/1.45 -apple-system,"Hiragino Sans","Meiryo",sans-serif;color:#222}
  #yr-panel header{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#1f3b63;color:#fff;border-radius:10px 10px 0 0;cursor:move;font-weight:600;position:sticky;top:0}
  #yr-panel header button{background:none;border:0;color:#fff;font-size:16px;cursor:pointer}
  #yr-body{padding:10px 12px}
  #yr-panel .yr-lbl{font-size:11px;color:#666;margin:8px 0 4px}
  #yr-panel .yr-row{display:flex;gap:6px;flex-wrap:wrap}
  #yr-panel .yr-btn{flex:1;padding:6px 4px;border:1px solid #9aa9bf;background:#f4f6fa;border-radius:6px;cursor:pointer;font-size:12px;color:#1f3b63}
  #yr-panel .yr-btn.on{background:#1f3b63;color:#fff;border-color:#1f3b63}
  #yr-panel input,#yr-panel select{width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid #bbb;border-radius:6px;font-size:13px;background:#fff}
  #yr-cond{margin-top:6px;padding:8px;background:#f7f8fb;border:1px solid #e1e5ee;border-radius:8px}
  #yr-cond .g{display:grid;grid-template-columns:1fr 1fr;gap:6px 8px}
  #yr-cond label{font-size:11px;color:#555;display:block}
  #yr-cond .yr-reset{margin-top:6px;font-size:11px;color:#0654ba;background:none;border:0;cursor:pointer;padding:0}
  #yr-panel .yr-go{width:100%;margin-top:10px;padding:9px;border:0;border-radius:6px;background:#e8730c;color:#fff;font-weight:700;font-size:14px;cursor:pointer}
  #yr-panel .yr-go:disabled{background:#bbb;cursor:default}
  #yr-panel .yr-sub{width:100%;margin-top:6px;padding:6px;border:1px solid #9aa9bf;border-radius:6px;background:#fff;cursor:pointer;font-size:12px}
  #yr-status{margin-top:8px;font-size:12px;color:#1f3b63;min-height:1em}
  #yr-modal{position:fixed;inset:4% 3%;z-index:100000;background:#fff;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.35);display:flex;flex-direction:column;font:13px/1.45 -apple-system,"Hiragino Sans","Meiryo",sans-serif;color:#222}
  #yr-modal .yr-mh{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid #ddd;flex-wrap:wrap}
  #yr-modal .yr-mh b{font-size:15px;margin-right:auto}
  #yr-modal .yr-mh button{padding:6px 10px;border:1px solid #9aa9bf;border-radius:6px;background:#f4f6fa;cursor:pointer}
  #yr-modal .yr-tw{overflow:auto;flex:1}
  #yr-modal table{border-collapse:collapse;width:100%}
  #yr-modal th,#yr-modal td{border-bottom:1px solid #eee;padding:5px 8px;text-align:left;vertical-align:top}
  #yr-modal th{position:sticky;top:0;background:#f4f6fa;cursor:pointer;white-space:nowrap}
  #yr-modal td.n{text-align:right;white-space:nowrap}
  #yr-modal a{color:#0654ba}
  #yr-modal .yr-ex{color:#999}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'yr-panel';
  panel.innerHTML = `
    <header><span>パターン検索＆集計</span><button id="yr-min" title="たたむ">－</button></header>
    <div id="yr-body">
      <div class="yr-lbl">集計する対象</div>
      <div class="yr-row" id="yr-mode"><button class="yr-btn" data-v="SOLD">Sold（売れた商品）</button><button class="yr-btn" data-v="ACTIVE">Active（出品中）</button></div>
      <div class="yr-lbl">パターン</div>
      <div class="yr-row" id="yr-pat">${[1, 2, 3].map(k => `<button class="yr-btn" data-v="${k}">パターン${k}</button>`).join('')}</div>
      <div id="yr-cond">
        <div class="g">
          <div><label>期間</label><select data-f="days">${DAY_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
          <div><label>状態</label><select data-f="cond">${COND_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
          <div><label>最低価格($)</label><input type="number" min="0" data-f="minPrice"></div>
          <div><label>最高価格($・空欄で上限なし)</label><input type="number" min="0" data-f="maxPrice"></div>
          <div><label>最低販売数（Soldのみ）</label><input type="number" min="1" data-f="minSold"></div>
          <div><label>利益条件(円)</label><input type="number" min="0" step="100" data-f="minProfit"></div>
        </div>
        <button class="yr-reset" id="yr-reset">このパターンを初期値に戻す</button>
      </div>
      <div class="yr-lbl">カテゴリー</div>
      <div class="yr-row" id="yr-cat">${Object.entries(CATEGORIES).map(([k, v]) => `<button class="yr-btn" data-v="${k}">${v}</button>`).join('')}</div>
      <div class="yr-lbl">キーワード（空欄なら全商品）</div>
      <input type="text" id="yr-kw" placeholder="例: final fantasy figure">
      <div class="yr-lbl">仕入上限の計算に使う容積重量(g)</div>
      <input type="number" id="yr-w" min="0" step="50">
      <button class="yr-go" id="yr-go">検索して集計</button>
      <button class="yr-sub" id="yr-here">今のページの検索結果を集計</button>
      <button class="yr-sub" id="yr-show" style="display:none">前回の集計結果を見る</button>
      <div id="yr-status"></div>
    </div>`;
  document.body.appendChild(panel);

  const $ = (s, r = document) => r.querySelector(s);
  const status = (t) => { $('#yr-status').textContent = t; };

  function refreshButtons() {
    panel.querySelectorAll('#yr-mode .yr-btn').forEach(b => b.classList.toggle('on', b.dataset.v === state.mode));
    panel.querySelectorAll('#yr-pat .yr-btn').forEach(b => b.classList.toggle('on', +b.dataset.v === +state.pattern));
    panel.querySelectorAll('#yr-cat .yr-btn').forEach(b => b.classList.toggle('on', b.dataset.v === state.cat));
    const p = PAT[state.pattern];
    panel.querySelectorAll('#yr-cond [data-f]').forEach(el => { el.value = p[el.dataset.f]; });
    const ms = panel.querySelector('#yr-cond [data-f="minSold"]');
    ms.disabled = state.mode === 'ACTIVE';
    panel.querySelector('#yr-cond [data-f="days"]').disabled = state.mode === 'ACTIVE';
  }
  panel.querySelector('#yr-mode').addEventListener('click', e => {
    const b = e.target.closest('.yr-btn'); if (!b) return;
    state.mode = b.dataset.v; store.set('mode', state.mode); refreshButtons();
  });
  panel.querySelector('#yr-pat').addEventListener('click', e => {
    const b = e.target.closest('.yr-btn'); if (!b) return;
    state.pattern = +b.dataset.v; store.set('pattern', state.pattern); refreshButtons();
  });
  panel.querySelector('#yr-cat').addEventListener('click', e => {
    const b = e.target.closest('.yr-btn'); if (!b) return;
    state.cat = b.dataset.v; store.set('cat', state.cat); refreshButtons();
  });
  panel.querySelector('#yr-cond').addEventListener('change', e => {
    const f = e.target.dataset.f; if (!f) return;
    let v = e.target.value;
    if (f === 'cond') { /* 文字のまま */ }
    else if (f === 'maxPrice') v = v === '' ? '' : Math.max(0, +v);
    else v = Math.max(0, +v || 0);
    PAT[state.pattern][f] = v; savePat();
  });
  $('#yr-reset').addEventListener('click', () => { PAT[state.pattern] = { ...DEFAULTS[state.pattern] }; savePat(); refreshButtons(); });
  $('#yr-kw').value = state.kw;
  $('#yr-w').value = state.weight;
  $('#yr-kw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#yr-go').click(); });
  $('#yr-w').addEventListener('change', () => {
    state.weight = Math.max(0, +$('#yr-w').value || 0); store.set('weight', state.weight);
    if (state.results.length) { recalc(state.results); if ($('#yr-modal')) showResults(); }
  });
  $('#yr-min').addEventListener('click', () => {
    const body = $('#yr-body'); const hide = body.style.display !== 'none';
    body.style.display = hide ? 'none' : ''; $('#yr-min').textContent = hide ? '＋' : '－';
  });
  // ドラッグ移動
  (() => {
    const h = panel.querySelector('header'); let sx, sy, ox, oy;
    h.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      const r = panel.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      const mv = ev => { panel.style.left = ox + ev.clientX - sx + 'px'; panel.style.top = oy + ev.clientY - sy + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto'; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
  })();

  // ===== 検索URL =====
  function buildUrl() {
    const p = PAT[state.pattern];
    const q = new URLSearchParams();
    q.set('marketplace', 'EBAY-US');
    q.set('keywords', state.kw.trim() || '(-abcd)');
    if (state.cat) q.set('categoryId', state.cat);
    q.append('format', 'BEST_OFFER');
    q.append('format', 'FIXED_PRICE');
    q.set('sellerCountry', 'JP');
    q.set('offset', '0');
    q.set('limit', '50');
    q.set('tabName', state.mode);
    q.set('tz', 'Asia/Tokyo');
    q.set('dayRange', String(p.days));
    if (+p.minPrice > 0) q.set('minPrice', String(p.minPrice));
    if (p.maxPrice !== '' && +p.maxPrice > 0) q.set('maxPrice', String(p.maxPrice));
    if (COND_ID[p.cond]) q.set('conditionId', COND_ID[p.cond]);
    return 'https://www.ebay.com/sh/research?' + q.toString();
  }

  $('#yr-go').addEventListener('click', () => {
    state.kw = $('#yr-kw').value; store.set('kw', state.kw);
    sessionStorage.setItem(LS + 'autorun', JSON.stringify({ pattern: state.pattern, t: Date.now() }));
    location.href = buildUrl();
  });
  $('#yr-here').addEventListener('click', () => runCollect());
  $('#yr-show').addEventListener('click', () => showResults());

  // ===== 抽出 =====
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const num = s => { const m = (s || '').replace(/,/g, '').match(/[\d.]+/); return m ? +m[0] : 0; };
  const curMode = () => (new URLSearchParams(location.search).get('tabName') || 'SOLD').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'SOLD';
  // 画面には Sold と Active の両方の表・ページ送りが残るので、表示中のものだけを使う
  const TABLE = { SOLD: '.sold-result-table', ACTIVE: '.active-result-table' };
  const ROW = { SOLD: 'tr.research-table-row', ACTIVE: 'tr.active-listing-row' };
  const PFX = { SOLD: 'research-table-row__', ACTIVE: 'active-listing-row__' };
  const rowsOf = m => [...document.querySelectorAll(TABLE[m] + ' ' + ROW[m])];
  const firstId = m => rowsOf(m)[0]?.querySelector('[data-item-id]')?.dataset.itemId || '';
  const nextBtn = () => [...document.querySelectorAll('.pagination__next')].find(b => b.offsetParent !== null);
  const offset = () => new URLSearchParams(location.search).get('offset') || '0';

  function scrape(m) {
    const px = PFX[m];
    const ct = (r, c) => (r.querySelector('.' + px + c)?.innerText || '').replace(/\n+/g, ' | ').trim();
    return rowsOf(m).map(r => {
      const info = r.querySelector('.' + px + 'product-info');
      const s = info?.querySelector('[data-item-id]');
      const a = info?.querySelector('a[href*="/itm/"]');
      const base = {
        itemId: s?.dataset.itemId || '',
        title: (s?.innerText || '').trim(),
        url: a ? new URL(a.getAttribute('href'), location.origin).href.split('?')[0] : '',
      };
      if (m === 'SOLD') {
        // Sold の価格欄は「¥」表示だが中身はドル
        return { ...base,
          price: num(ct(r, 'avgSoldPrice').split('|')[0]),
          ship: num(ct(r, 'avgShippingCost').split('|')[0]),
          sold: num(ct(r, 'totalSoldCount')),
          last: ct(r, 'dateLastSold').split('|')[0].trim() };
      }
      // Active の価格欄は本物の日本円（例：¥40,391 +¥7,951 shipping）
      const lp = ct(r, 'listingPrice');
      const sh = lp.match(/\+\s*¥?\s*([\d,]+)/);
      return { ...base,
        yen: num(lp),
        shipYen: sh ? num(sh[1]) : 0,
        watchers: num(ct(r, 'watchers')),
        bids: num(ct(r, 'bids')),
        promoted: (ct(r, 'promotedListing').replace(/[–-]/g, '').trim()),
        start: ct(r, 'startedDate').split('|')[0].trim() };
    });
  }

  async function waitRows(m, ms = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (firstId(m)) return true;
      if (/No results|no matching|0 results|結果.*ありません/i.test(document.querySelector('.research-container')?.innerText || '')) return false;
      await sleep(300);
    }
    return !!firstId(m);
  }

  // Active：1件だけ商品ページを開いて、eBayの円/ドル換算レートを求める
  async function detectRate(rows) {
    for (const r of rows.slice(0, 3)) {
      try {
        const h = await fetch('/itm/' + r.itemId, { credentials: 'include' }).then(x => x.text());
        const usd = h.match(/US \$([\d,.]+)/), jpy = h.match(/JPY ([\d,]+)/);
        if (usd && jpy) { const rate = num(jpy[1]) / num(usd[1]); if (rate > 80 && rate < 300) return Math.round(rate * 100) / 100; }
      } catch (e) {}
    }
    return 0;
  }

  function judge(r, m, p) {
    if (!r.itemId) return '商品IDなし';
    if (!r.url || !r.title) return '削除済み';
    if (LOT_RE.test(r.title)) return 'まとめ売り';
    if (m === 'SOLD') {
      if (r.sold < p.minSold) return `販売数${p.minSold}未満`;
      if (r.sold >= MAX_SOLD) return `販売数${MAX_SOLD}以上`;
    }
    if (+p.minPrice > 0 && r.price < +p.minPrice) return `$${p.minPrice}未満`;
    if (p.maxPrice !== '' && +p.maxPrice > 0 && r.price > +p.maxPrice) return `$${p.maxPrice}超`;
    return '';
  }
  function recalc(rows) {
    const p = PAT[state.resPattern];
    rows.forEach(r => { r.cap = Math.floor(r.price * NET_PER_USD - state.weight * YEN_PER_GRAM - p.minProfit); });
  }

  async function runCollect() {
    if (state.running) return;
    state.running = true; $('#yr-go').disabled = true;
    const m = curMode();
    const qs = new URLSearchParams(location.search);
    const p = PAT[state.pattern];
    const all = []; const seen = new Set();
    try {
      status('検索結果の表示を待っています…');
      if (!(await waitRows(m))) { status('検索結果が0件でした。'); return; }
      for (let page = 1; page <= MAX_PAGES; page++) {
        const rows = scrape(m);
        for (const r of rows) if (r.itemId && !seen.has(r.itemId)) { seen.add(r.itemId); all.push(r); }
        status(`${m === 'SOLD' ? 'Sold' : 'Active'}：${page}ページ目を読み込み済み（${all.length}件）`);
        const nx = nextBtn();
        // Sold は販売数の多い順なので、最後の行が最低販売数を下回ったら終了
        if (!rows.length || !nx || nx.disabled || nx.getAttribute('aria-disabled') === 'true' || rows.length < 50) break;
        if (m === 'SOLD' && rows.at(-1).sold < p.minSold) break;
        const o = offset(), f = firstId(m);
        nx.click();
        let ok = false;
        for (let i = 0; i < 80; i++) { await sleep(250); const z = firstId(m); if (offset() !== o && z && z !== f) { ok = true; break; } }
        if (!ok) { status('次のページに進めませんでした。ここまでの結果を表示します。'); break; }
        await sleep(400);
      }
      if (m === 'ACTIVE') {
        status('円→ドルの換算レートを確認しています…');
        state.rate = (await detectRate(all)) || store.get('rate', 155);
        store.set('rate', state.rate);
        all.forEach(r => { r.price = Math.round(r.yen / state.rate * 100) / 100; r.ship = Math.round(r.shipYen / state.rate * 100) / 100; });
      }
      all.forEach(r => { r.reason = judge(r, m, p); });
      state.resMode = m; state.resPattern = state.pattern;
      recalc(all);
      state.results = all;
      sessionStorage.setItem(LS + 'last', JSON.stringify({ mode: m, pattern: state.pattern, rate: state.rate, cat: qs.get('categoryId') || '', rows: all }));
      const kept = all.filter(r => !r.reason).length;
      status(`完了：${all.length}件中 ${kept}件が条件に合致`);
      $('#yr-show').style.display = '';
      showResults();
    } catch (e) {
      status('エラー：' + e.message);
    } finally {
      state.running = false; $('#yr-go').disabled = false;
    }
  }

  // ===== 結果表示 =====
  let sortKey = null, sortDir = -1, showExcluded = false;
  const COLS = {
    SOLD: [['idx', '#'], ['title', 'タイトル'], ['price', '平均価格$'], ['ship', '平均送料$'], ['sold', '販売数'], ['total', '売上$'], ['last', '最終販売日'], ['cap', '仕入上限(円)'], ['reason', '除外理由']],
    ACTIVE: [['idx', '#'], ['title', 'タイトル'], ['price', '価格$'], ['yen', '価格(円)'], ['ship', '送料$'], ['watchers', 'ウォッチ'], ['promoted', 'Promoted'], ['start', '出品開始日'], ['cap', '仕入上限(円)'], ['reason', '除外理由']],
  };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function visibleRows() {
    const key = sortKey || (state.resMode === 'SOLD' ? 'sold' : 'watchers');
    let rows = state.results.map((r, i) => ({ ...r, idx: i + 1, total: r.sold ? Math.round(r.price * r.sold * 100) / 100 : 0 }));
    if (!showExcluded) rows = rows.filter(r => !r.reason);
    rows.sort((a, b) => {
      const x = a[key], y = b[key];
      return (typeof x === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''))) * sortDir;
    });
    return rows;
  }

  function fmtCell(k, r) {
    switch (k) {
      case 'title': return r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a><br><span style="font-size:11px;color:#888">${esc(r.itemId)}</span>` : esc(r.title || '(削除済み)');
      case 'price': case 'ship': return `<td class="n">${(r[k] || 0).toFixed(2)}</td>`;
      case 'cap': return `<td class="n" style="color:${r.cap > 0 ? '#0a7d2c' : '#c00'}">${r.cap.toLocaleString()}</td>`;
      case 'idx': case 'sold': case 'watchers': case 'yen': case 'total': return `<td class="n">${(r[k] || 0).toLocaleString()}</td>`;
      default: return esc(r[k]);
    }
  }

  function showResults() {
    $('#yr-modal')?.remove();
    const m = state.resMode, p = PAT[state.resPattern];
    const cols = COLS[m];
    const key = sortKey || (m === 'SOLD' ? 'sold' : 'watchers');
    const rows = visibleRows();
    const kept = state.results.filter(r => !r.reason);
    const summary = m === 'SOLD'
      ? `販売数合計 ${kept.reduce((s, r) => s + r.sold, 0)}`
      : `平均価格 $${kept.length ? (kept.reduce((s, r) => s + r.price, 0) / kept.length).toFixed(2) : '0'}`;
    const md = document.createElement('div');
    md.id = 'yr-modal';
    md.innerHTML = `
      <div class="yr-mh">
        <b>${m === 'SOLD' ? 'Sold' : 'Active'}／パターン${state.resPattern}の集計：条件に合う商品 ${kept.length}件（${summary}）／取得 ${state.results.length}件</b>
        <label><input type="checkbox" id="yr-ex" ${showExcluded ? 'checked' : ''}> 除外した商品も表示</label>
        <button id="yr-tsv">表をコピー（シート貼付用）</button>
        <button id="yr-csv">CSVで保存</button>
        <button id="yr-close">閉じる</button>
      </div>
      <div style="padding:4px 14px;font-size:11px;color:#666">仕入上限 ＝ 価格$ × ${NET_PER_USD} − 容積重量${state.weight}g × ${YEN_PER_GRAM} − 利益条件${(+p.minProfit).toLocaleString()}円（国内送料込みの仕入値がこれ以下なら利益条件を満たす）。${m === 'ACTIVE' ? `Activeの価格はeBay表示の円を 1ドル＝${state.rate}円 でドルに換算。` : ''}見出しをクリックで並べ替え。</div>
      <div class="yr-tw"><table><thead><tr>${cols.map(([k, l]) => `<th data-k="${k}">${l}${key === k ? (sortDir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.reason ? 'yr-ex' : ''}">${cols.map(([k]) => { const c = fmtCell(k, r); return c.startsWith('<td') ? c : `<td>${c}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>`;
    document.body.appendChild(md);
    md.querySelector('#yr-close').onclick = () => md.remove();
    md.querySelector('#yr-ex').onchange = e => { showExcluded = e.target.checked; showResults(); };
    md.querySelectorAll('th').forEach(th => th.onclick = () => {
      const k = th.dataset.k; if (key === k) sortDir = -sortDir; else { sortKey = k; sortDir = -1; } showResults();
    });
    md.querySelector('#yr-tsv').onclick = async () => {
      const t = toTable('\t');
      try { await navigator.clipboard.writeText(t); md.querySelector('#yr-tsv').textContent = 'コピーしました'; }
      catch (e) { prompt('コピーできませんでした。下の文字を選択してコピーしてください', t); }
    };
    md.querySelector('#yr-csv').onclick = () => {
      const blob = new Blob(['﻿' + toTable(',')], { type: 'text/csv' });
      const a = document.createElement('a');
      const qs = new URLSearchParams(location.search);
      const kw = (qs.get('keywords') || 'all').replace(/[^\w-]+/g, '_').slice(0, 30);
      a.href = URL.createObjectURL(blob);
      a.download = `research_${m.toLowerCase()}_p${state.resPattern}_${CATEGORIES[qs.get('categoryId') || ''] || 'cat'}_${kw}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  }

  function toTable(sep) {
    const qs = new URLSearchParams(location.search);
    const catName = CATEGORIES[qs.get('categoryId') || ''] || qs.get('categoryId');
    const q = v => { const s = String(v ?? ''); return sep === ',' && /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s.replace(/[\t\n]/g, ' '); };
    let head, line;
    if (state.resMode === 'SOLD') {
      head = ['カテゴリー', 'パターン', 'タイトル', '平均価格$', '販売数', '平均送料$', '最終販売日', '仕入上限(円)', 'eBay商品ID', 'eBay URL', '除外理由'];
      line = r => [catName, state.resPattern, r.title, r.price, r.sold, r.ship, r.last, r.cap, r.itemId, r.url, r.reason];
    } else {
      head = ['カテゴリー', 'パターン', 'タイトル', '価格$', '価格(円)', '送料$', 'ウォッチ', 'Promoted', '出品開始日', '仕入上限(円)', 'eBay商品ID', 'eBay URL', '除外理由'];
      line = r => [catName, state.resPattern, r.title, r.price, r.yen, r.ship, r.watchers, r.promoted, r.start, r.cap, r.itemId, r.url, r.reason];
    }
    return [head.map(q).join(sep), ...visibleRows().map(r => line(r).map(q).join(sep))].join('\n');
  }

  // ===== 起動時 =====
  refreshButtons();
  try {
    const last = JSON.parse(sessionStorage.getItem(LS + 'last') || 'null');
    if (last?.rows?.length) {
      state.results = last.rows; state.resMode = last.mode || 'SOLD'; state.resPattern = last.pattern || 3; state.rate = last.rate || 0;
      $('#yr-show').style.display = '';
    }
  } catch (e) {}
  try {
    const ar = JSON.parse(sessionStorage.getItem(LS + 'autorun') || 'null');
    sessionStorage.removeItem(LS + 'autorun');
    if (ar && Date.now() - ar.t < 60000) {
      state.pattern = ar.pattern; state.mode = curMode(); refreshButtons();
      runCollect();
    }
  } catch (e) {}
})();
