// ==UserScript==
// @name         eBay Research パターン検索＆集計パネル
// @namespace    yoriko.research
// @version      1.0.0
// @description  Research Products ページで、パターン（1/2/3）とカテゴリーをボタンで指定してKW検索し、全ページを自動でめくって条件に合う商品を集計する
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

  // ===== 設定 =====
  const PATTERNS = {
    1: { label: 'パターン1', days: 7,  minPrice: 50,  minSold: 2, used: false, minProfit: 100,  note: '7日・$50以上・2個以上・新品/中古' },
    2: { label: 'パターン2', days: 30, minPrice: 150, minSold: 4, used: true,  minProfit: 1500, note: '30日・$150以上・4個以上・中古' },
    3: { label: 'パターン3', days: 90, minPrice: 200, minSold: 2, used: true,  minProfit: 2000, note: '90日・$200以上・2個以上・中古' },
  };
  const CATEGORIES = { '1': 'コレクティブルズ', '220': 'トイホビー', '': '全カテゴリー' };
  const MAX_SOLD = 60;                       // 60個以上は除外
  const LOT_RE = /\blots?\b|bulk|\d+ ?pcs|\bx\d{2,}\b|\bset of \d{2,}\b/i; // まとめ売り
  const NET_PER_USD = 90.19;                 // 手数料・関税を引いた1ドルあたりの手取り（円）
  const YEN_PER_GRAM = 3;                    // 送料 = 容積重量(g) × 3円
  const MAX_PAGES = 30;                      // 安全のため最大ページ数（50件×30＝1,500件）
  const LS = 'yrPanel_';

  // ===== 状態 =====
  const store = {
    get: (k, d) => { try { const v = localStorage.getItem(LS + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} },
  };
  const state = {
    pattern: store.get('pattern', 3),
    cat: store.get('cat', '1'),
    kw: store.get('kw', ''),
    weight: store.get('weight', 500),
    running: false,
    results: [],
  };

  // ===== 画面 =====
  const css = `
  #yr-panel{position:fixed;right:16px;bottom:16px;z-index:99999;width:320px;background:#fff;border:1px solid #c7c7c7;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);font:13px/1.45 -apple-system,"Hiragino Sans","Meiryo",sans-serif;color:#222}
  #yr-panel header{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#1f3b63;color:#fff;border-radius:10px 10px 0 0;cursor:move;font-weight:600}
  #yr-panel header button{background:none;border:0;color:#fff;font-size:16px;cursor:pointer}
  #yr-body{padding:10px 12px}
  #yr-panel .yr-lbl{font-size:11px;color:#666;margin:8px 0 4px}
  #yr-panel .yr-row{display:flex;gap:6px;flex-wrap:wrap}
  #yr-panel .yr-btn{flex:1;padding:6px 4px;border:1px solid #9aa9bf;background:#f4f6fa;border-radius:6px;cursor:pointer;font-size:12px;color:#1f3b63}
  #yr-panel .yr-btn.on{background:#1f3b63;color:#fff;border-color:#1f3b63}
  #yr-panel input[type=text],#yr-panel input[type=number]{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #bbb;border-radius:6px;font-size:13px}
  #yr-panel .yr-note{font-size:11px;color:#555;margin-top:4px}
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
      <div class="yr-lbl">パターン</div>
      <div class="yr-row" id="yr-pat">${Object.entries(PATTERNS).map(([k, p]) => `<button class="yr-btn" data-v="${k}">${p.label}</button>`).join('')}</div>
      <div class="yr-note" id="yr-patnote"></div>
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
    panel.querySelectorAll('#yr-pat .yr-btn').forEach(b => b.classList.toggle('on', +b.dataset.v === +state.pattern));
    panel.querySelectorAll('#yr-cat .yr-btn').forEach(b => b.classList.toggle('on', b.dataset.v === state.cat));
    const p = PATTERNS[state.pattern];
    $('#yr-patnote').textContent = `${p.note}・利益${p.minProfit.toLocaleString()}円以上`;
  }
  panel.querySelector('#yr-pat').addEventListener('click', e => {
    const b = e.target.closest('.yr-btn'); if (!b) return;
    state.pattern = +b.dataset.v; store.set('pattern', state.pattern); refreshButtons();
  });
  panel.querySelector('#yr-cat').addEventListener('click', e => {
    const b = e.target.closest('.yr-btn'); if (!b) return;
    state.cat = b.dataset.v; store.set('cat', state.cat); refreshButtons();
  });
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
    const p = PATTERNS[state.pattern];
    const q = new URLSearchParams();
    q.set('marketplace', 'EBAY-US');
    q.set('keywords', state.kw.trim() || '(-abcd)');
    if (state.cat) q.set('categoryId', state.cat);
    q.append('format', 'BEST_OFFER');
    q.append('format', 'FIXED_PRICE');
    q.set('sellerCountry', 'JP');
    q.set('offset', '0');
    q.set('limit', '50');
    q.set('tabName', 'SOLD');
    q.set('tz', 'Asia/Tokyo');
    q.set('dayRange', String(p.days));
    q.set('minPrice', String(p.minPrice));
    if (p.used) q.set('conditionId', '3000');
    return 'https://www.ebay.com/sh/research?' + q.toString();
  }

  $('#yr-go').addEventListener('click', () => {
    state.kw = $('#yr-kw').value; store.set('kw', state.kw);
    sessionStorage.setItem(LS + 'autorun', JSON.stringify({ pattern: state.pattern, cat: state.cat, kw: state.kw, t: Date.now() }));
    location.href = buildUrl();
  });
  $('#yr-here').addEventListener('click', () => runCollect());
  $('#yr-show').addEventListener('click', () => showResults());

  // ===== 抽出 =====
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const cellText = (r, c) => (r.querySelector('.research-table-row__' + c)?.innerText || '').replace(/\n+/g, ' | ').trim();
  const num = s => { const m = (s || '').replace(/,/g, '').match(/[\d.]+/); return m ? +m[0] : 0; };
  function scrape() {
    return [...document.querySelectorAll('.sold-result-table tr.research-table-row')].map(r => {
      const s = r.querySelector('.research-table-row__product-info-name span[data-item-id]');
      const a = r.querySelector('.research-table-row__product-info-name a');
      return {
        itemId: s?.dataset.itemId || '',
        title: (s?.innerText || '').trim(),
        url: a ? new URL(a.getAttribute('href'), location.origin).href.split('?')[0] : '',
        price: num(cellText(r, 'avgSoldPrice').split('|')[0]),
        ship: num(cellText(r, 'avgShippingCost').split('|')[0]),
        sold: num(cellText(r, 'totalSoldCount')),
        last: cellText(r, 'dateLastSold').split('|')[0].trim(),
      };
    });
  }
  const firstId = () => document.querySelector('.sold-result-table span[data-item-id]')?.dataset.itemId || '';
  const offset = () => new URLSearchParams(location.search).get('offset') || '0';

  async function waitRows(ms = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (firstId()) return true;
      if (/no results|結果.*ありません|0 results/i.test(document.querySelector('.sold-result-table, .research-container, main')?.innerText || '')) return false;
      await sleep(300);
    }
    return !!firstId();
  }

  function judge(r, p) {
    if (!r.itemId) return '商品IDなし';
    if (!r.url || !r.title) return '削除済み';
    if (r.sold < p.minSold) return `販売数${p.minSold}未満`;
    if (r.sold >= MAX_SOLD) return `販売数${MAX_SOLD}以上`;
    if (r.price < p.minPrice) return `$${p.minPrice}未満`;
    if (LOT_RE.test(r.title)) return 'まとめ売り';
    return '';
  }
  function recalc(rows) {
    const p = PATTERNS[state.pattern];
    rows.forEach(r => { r.cap = Math.floor(r.price * NET_PER_USD - state.weight * YEN_PER_GRAM - p.minProfit); });
  }

  async function runCollect() {
    if (state.running) return;
    state.running = true; $('#yr-go').disabled = true;
    const p = PATTERNS[state.pattern];
    // URLから実際の条件を読む（手で条件を変えた場合にも対応）
    const qs = new URLSearchParams(location.search);
    const urlPat = Object.entries(PATTERNS).find(([, v]) => String(v.days) === qs.get('dayRange') && String(v.minPrice) === qs.get('minPrice'));
    if (urlPat && +urlPat[0] !== +state.pattern) { state.pattern = +urlPat[0]; store.set('pattern', state.pattern); refreshButtons(); }
    const pat = PATTERNS[state.pattern];
    const all = []; const seen = new Set();
    try {
      status('検索結果の表示を待っています…');
      if (!(await waitRows())) { status('検索結果が0件でした。'); return; }
      for (let page = 1; page <= MAX_PAGES; page++) {
        const rows = scrape();
        for (const r of rows) if (r.itemId && !seen.has(r.itemId)) { seen.add(r.itemId); all.push(r); }
        status(`${page}ページ目を読み込み済み（${all.length}件）`);
        const nx = document.querySelector('.pagination__next');
        // 販売数の多い順に並ぶので、最後の行が最低販売数を下回ったら終了
        if (!rows.length || rows.at(-1).sold < pat.minSold || !nx || nx.disabled || nx.getAttribute('aria-disabled') === 'true' || rows.length < 50) break;
        const o = offset(), f = firstId();
        nx.click();
        let ok = false;
        for (let i = 0; i < 80; i++) { await sleep(250); const z = firstId(); if (offset() !== o && z && z !== f) { ok = true; break; } }
        if (!ok) { status('次のページに進めませんでした。ここまでの結果を表示します。'); break; }
        await sleep(400);
      }
      all.forEach(r => { r.reason = judge(r, pat); });
      recalc(all);
      state.results = all;
      const kept = all.filter(r => !r.reason).length;
      sessionStorage.setItem(LS + 'last', JSON.stringify({ pattern: state.pattern, cat: qs.get('categoryId') || '', kw: qs.get('keywords') || '', weight: state.weight, rows: all }));
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
  let sortKey = 'sold', sortDir = -1, showExcluded = false;
  const COLS = [
    ['idx', '#'], ['title', 'タイトル'], ['price', '平均価格$'], ['ship', '平均送料$'], ['sold', '販売数'],
    ['total', '売上$'], ['last', '最終販売日'], ['cap', '仕入上限(円)'], ['reason', '除外理由'],
  ];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function visibleRows() {
    let rows = state.results.map((r, i) => ({ ...r, idx: i + 1, total: Math.round(r.price * r.sold * 100) / 100 }));
    if (!showExcluded) rows = rows.filter(r => !r.reason);
    rows.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sortDir;
    });
    return rows;
  }

  function showResults() {
    $('#yr-modal')?.remove();
    const p = PATTERNS[state.pattern];
    const rows = visibleRows();
    const kept = state.results.filter(r => !r.reason);
    const totalSold = kept.reduce((s, r) => s + r.sold, 0);
    const m = document.createElement('div');
    m.id = 'yr-modal';
    m.innerHTML = `
      <div class="yr-mh">
        <b>${p.label}の集計：条件に合う商品 ${kept.length}件（販売数合計 ${totalSold}）／取得 ${state.results.length}件</b>
        <label><input type="checkbox" id="yr-ex" ${showExcluded ? 'checked' : ''}> 除外した商品も表示</label>
        <button id="yr-tsv">表をコピー（シート貼付用）</button>
        <button id="yr-csv">CSVで保存</button>
        <button id="yr-close">閉じる</button>
      </div>
      <div style="padding:4px 14px;font-size:11px;color:#666">仕入上限 ＝ 平均価格$ × ${NET_PER_USD} − 容積重量${state.weight}g × ${YEN_PER_GRAM} − 利益条件${p.minProfit.toLocaleString()}円（国内送料込みの仕入値がこれ以下なら利益条件を満たす）。見出しをクリックで並べ替え。</div>
      <div class="yr-tw"><table><thead><tr>${COLS.map(([k, l]) => `<th data-k="${k}">${l}${sortKey === k ? (sortDir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.reason ? 'yr-ex' : ''}">
        <td class="n">${r.idx}</td>
        <td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title || '(削除済み)')}<br><span style="font-size:11px;color:#888">${esc(r.itemId)}</span></td>
        <td class="n">${r.price.toFixed(2)}</td><td class="n">${r.ship.toFixed(2)}</td><td class="n">${r.sold}</td>
        <td class="n">${r.total.toLocaleString()}</td><td>${esc(r.last)}</td>
        <td class="n" style="color:${r.cap > 0 ? '#0a7d2c' : '#c00'}">${r.cap.toLocaleString()}</td><td>${esc(r.reason)}</td></tr>`).join('')}
      </tbody></table></div>`;
    document.body.appendChild(m);
    m.querySelector('#yr-close').onclick = () => m.remove();
    m.querySelector('#yr-ex').onchange = e => { showExcluded = e.target.checked; showResults(); };
    m.querySelectorAll('th').forEach(th => th.onclick = () => {
      const k = th.dataset.k; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = -1; } showResults();
    });
    m.querySelector('#yr-tsv').onclick = async () => {
      const t = toTable('\t');
      try { await navigator.clipboard.writeText(t); m.querySelector('#yr-tsv').textContent = 'コピーしました'; }
      catch (e) { prompt('コピーできませんでした。下の文字を選択してコピーしてください', t); }
    };
    m.querySelector('#yr-csv').onclick = () => {
      const blob = new Blob(['﻿' + toTable(',')], { type: 'text/csv' });
      const a = document.createElement('a');
      const kw = (new URLSearchParams(location.search).get('keywords') || 'all').replace(/[^\w-]+/g, '_').slice(0, 30);
      a.href = URL.createObjectURL(blob);
      a.download = `research_p${state.pattern}_${CATEGORIES[state.cat] || 'cat'}_${kw}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  }

  function toTable(sep) {
    const qs = new URLSearchParams(location.search);
    const catName = CATEGORIES[qs.get('categoryId') || ''] || qs.get('categoryId');
    const head = ['カテゴリー', 'パターン', 'タイトル', '平均価格$', '販売数', '平均送料$', '最終販売日', '仕入上限(円)', 'eBay商品ID', 'eBay URL', '除外理由'];
    const q = v => { const s = String(v ?? ''); return sep === ',' && /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s.replace(/[\t\n]/g, ' '); };
    const lines = [head.map(q).join(sep)];
    for (const r of visibleRows()) lines.push([catName, state.pattern, r.title, r.price, r.sold, r.ship, r.last, r.cap, r.itemId, r.url, r.reason].map(q).join(sep));
    return lines.join('\n');
  }

  // ===== 起動時 =====
  refreshButtons();
  try {
    const last = JSON.parse(sessionStorage.getItem(LS + 'last') || 'null');
    if (last?.rows?.length) { state.results = last.rows; $('#yr-show').style.display = ''; }
  } catch (e) {}
  try {
    const ar = JSON.parse(sessionStorage.getItem(LS + 'autorun') || 'null');
    sessionStorage.removeItem(LS + 'autorun');
    if (ar && Date.now() - ar.t < 60000) {
      state.pattern = ar.pattern; state.cat = ar.cat; refreshButtons();
      runCollect();
    }
  } catch (e) {}
})();
