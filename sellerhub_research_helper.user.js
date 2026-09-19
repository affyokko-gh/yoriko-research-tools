// ==UserScript==
// @name         Seller Hub リサーチ集計（旧裏ポケカ）
// @namespace    yoriko.research
// @version      2.9
// @description  Seller Hub Research の結果表を収録（拡張シート・ジャングル・ロケット団・カードダス等）ごとに自動仕分けし、送料込み総額の中央値・上限仕入れ値を計算してシート用の1行をコピーする
// @match        https://www.ebay.com/sh/research*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/affyokko-gh/yoriko-research-tools/main/sellerhub_research_helper.user.js
// @downloadURL  https://raw.githubusercontent.com/affyokko-gh/yoriko-research-tools/main/sellerhub_research_helper.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ===== 自分の基準に合わせて変更する所 =====
  const FEE_COEF = 75.19;    // 売価$ × この係数 − 固定費 = 上限仕入れ値（粗利20%・1$=150円）
  const FIXED = 1324;        // 固定費（SpeedPAK送料＋資材＋固定手数料）
  // シートの列順（A列から順に）。パネルの「列順」欄で変更でき、保存される。空欄にしたい列は「空」と書く
  const COLS_DEFAULT = '記入日,画像,英語KW,日本語KW,販売数,最高値,最安値,中央値,備考,上限,実勢価格,参考ページ,実勢メモ,eBay画像URL';

  // 収録の仕分けルール。上から順に判定し、最初に当たったグループになる。
  // [グループ名, 正規表現, 単品として集計するか, 日本語KWに入れる収録名]
  const GROUPS = [
    ['除外：鑑定品',      /PSA|CGC|ARS|BGS|graded/i, false, ''],
    // 弾名に set/gift が含まれるものは、ロット判定より先に拾う
    ['クイックスターター', /quick\s?starter|starter gift|gift set/i, true, 'クイックスターターギフト'],
    // 「複数枚」の判定は、数量を伴う語だけにする（"Gift Set" のような弾名は除外しない）
    ['除外：ロット・セット', /\blot\b|set of \d|\d+\s?-?\s?(card\s)?sets?\b|\bsets\b|\bx\s?\d+\b|\d+\s?x\b|\d+\s?(pcs|cards?)\b|bulk|complete|choose|sealed|unpeeled|\bpair\b/i, false, ''],
    ['カードダス・アマダ等', /carddass|bandai|topsun|amada|prism|sticker|seal|menko|\bpp\b/i, true, 'カードダス'],
    ['拡張シート',        /vending|expansion sheet|glossy/i, true, '拡張シート'],
    ['ジム',              /gym|sabrina|misty|erika|brock|blaine|koga|surge|giovanni|rocket's|leaders|challenge/i, true, 'ポケモンジム'],
    ['ロケット団',        /rocket|dark\b/i, true, '第4弾拡張パック ロケット団'],
    ['ジャングル',        /jungle/i, true, '第2弾拡張パック ポケモンジャングル'],
    ['化石',              /fossil/i, true, '第3弾拡張パック 化石の秘密'],
    ['Neo',               /\bneo\b|genesis|discovery|revelation|destiny|premium file/i, true, 'neo'],
    ['プロモ',            /promo|corocoro|coro|intro|fan club|\bana\b|trainers|wizards|stamp rally|world hobby/i, true, 'プロモ'],
    ['第1弾（ベース）',   /base set|1st|expansion pack|starter|1996/i, true, '第1弾拡張パック'],
    ['その他・不明',      /./, true, ''],
  ];
  // ==========================================

  // ===== 英語名 → [日本語名, 図鑑No.]（第1世代151種） =====
  const POKE = {bulbasaur:['フシギダネ',1],ivysaur:['フシギソウ',2],venusaur:['フシギバナ',3],charmander:['ヒトカゲ',4],charmeleon:['リザード',5],charizard:['リザードン',6],squirtle:['ゼニガメ',7],wartortle:['カメール',8],blastoise:['カメックス',9],caterpie:['キャタピー',10],metapod:['トランセル',11],butterfree:['バタフリー',12],weedle:['ビードル',13],kakuna:['コクーン',14],beedrill:['スピアー',15],pidgey:['ポッポ',16],pidgeotto:['ピジョン',17],pidgeot:['ピジョット',18],rattata:['コラッタ',19],raticate:['ラッタ',20],spearow:['オニスズメ',21],fearow:['オニドリル',22],ekans:['アーボ',23],arbok:['アーボック',24],pikachu:['ピカチュウ',25],raichu:['ライチュウ',26],sandshrew:['サンド',27],sandslash:['サンドパン',28],nidoran:['ニドラン',29],nidorina:['ニドリーナ',30],nidoqueen:['ニドクイン',31],nidorino:['ニドリーノ',33],nidoking:['ニドキング',34],clefairy:['ピッピ',35],clefable:['ピクシー',36],vulpix:['ロコン',37],ninetales:['キュウコン',38],jigglypuff:['プリン',39],wigglytuff:['プクリン',40],zubat:['ズバット',41],golbat:['ゴルバット',42],oddish:['ナゾノクサ',43],gloom:['クサイハナ',44],vileplume:['ラフレシア',45],paras:['パラス',46],parasect:['パラセクト',47],venonat:['コンパン',48],venomoth:['モルフォン',49],diglett:['ディグダ',50],dugtrio:['ダグトリオ',51],meowth:['ニャース',52],persian:['ペルシアン',53],psyduck:['コダック',54],golduck:['ゴルダック',55],mankey:['マンキー',56],primeape:['オコリザル',57],growlithe:['ガーディ',58],arcanine:['ウインディ',59],poliwag:['ニョロモ',60],poliwhirl:['ニョロゾ',61],poliwrath:['ニョロボン',62],abra:['ケーシィ',63],kadabra:['ユンゲラー',64],alakazam:['フーディン',65],machop:['ワンリキー',66],machoke:['ゴーリキー',67],machamp:['カイリキー',68],bellsprout:['マダツボミ',69],weepinbell:['ウツドン',70],victreebel:['ウツボット',71],tentacool:['メノクラゲ',72],tentacruel:['ドククラゲ',73],geodude:['イシツブテ',74],graveler:['ゴローン',75],golem:['ゴローニャ',76],ponyta:['ポニータ',77],rapidash:['ギャロップ',78],slowpoke:['ヤドン',79],slowbro:['ヤドラン',80],magnemite:['コイル',81],magneton:['レアコイル',82],farfetchd:['カモネギ',83],doduo:['ドードー',84],dodrio:['ドードリオ',85],seel:['パウワウ',86],dewgong:['ジュゴン',87],grimer:['ベトベター',88],muk:['ベトベトン',89],shellder:['シェルダー',90],cloyster:['パルシェン',91],gastly:['ゴース',92],haunter:['ゴースト',93],gengar:['ゲンガー',94],onix:['イワーク',95],drowzee:['スリープ',96],hypno:['スリーパー',97],krabby:['クラブ',98],kingler:['キングラー',99],voltorb:['ビリリダマ',100],electrode:['マルマイン',101],exeggcute:['タマタマ',102],exeggutor:['ナッシー',103],cubone:['カラカラ',104],marowak:['ガラガラ',105],hitmonlee:['サワムラー',106],hitmonchan:['エビワラー',107],lickitung:['ベロリンガ',108],koffing:['ドガース',109],weezing:['マタドガス',110],rhyhorn:['サイホーン',111],rhydon:['サイドン',112],chansey:['ラッキー',113],tangela:['モンジャラ',114],kangaskhan:['ガルーラ',115],horsea:['タッツー',116],seadra:['シードラ',117],goldeen:['トサキント',118],seaking:['アズマオウ',119],staryu:['ヒトデマン',120],starmie:['スターミー',121],'mr. mime':['バリヤード',122],'mr.mime':['バリヤード',122],scyther:['ストライク',123],jynx:['ルージュラ',124],electabuzz:['エレブー',125],magmar:['ブーバー',126],pinsir:['カイロス',127],tauros:['ケンタロス',128],magikarp:['コイキング',129],gyarados:['ギャラドス',130],lapras:['ラプラス',131],ditto:['メタモン',132],eevee:['イーブイ',133],vaporeon:['シャワーズ',134],jolteon:['サンダース',135],flareon:['ブースター',136],porygon:['ポリゴン',137],omanyte:['オムナイト',138],omastar:['オムスター',139],kabuto:['カブト',140],kabutops:['カブトプス',141],aerodactyl:['プテラ',142],snorlax:['カビゴン',143],articuno:['フリーザー',144],zapdos:['サンダー',145],moltres:['ファイヤー',146],dratini:['ミニリュウ',147],dragonair:['ハクリュー',148],dragonite:['カイリュー',149],mewtwo:['ミュウツー',150],mew:['ミュウ',151]};
  // 拡張シート（自販機シリーズ）の収録弾（図鑑No.）。複数弾に入るカードは両方書く
  const VENDING = {
    '第1弾（青版）': [1,10,11,13,14,29,32,41,42,46,47,127,4,78,7,60,61,62,25,63,122,150,74,16,19,35,40,84,85,108,113,133,137,143],
    '第2弾（赤版）': [49,88,109,114,146,86,87,90,98,131,138,144,26,81,82,100,125,145,124,27,66,67,75,95,105,106,107,140,142,21,22,132],
    '第3弾（緑版）': [24,30,33,48,69,70,110,123,37,58,77,126,55,99,116,117,120,138,64,80,92,93,97,150,28,67,75,104,112,17,115,128],
  };
  // 検索語やタイトルから [日本語名, 図鑑No.] を推定
  function guessCard(text) {
    const t = (text || '').toLowerCase();
    let hit = null;
    for (const k of Object.keys(POKE)) { if (new RegExp('\\b' + k.replace('.', '\\.') + '\\b').test(t)) { hit = POKE[k]; break; } }
    const m = (text || '').match(/(?:no\.?\s?|#)?(\d{3})\b/i);
    const num = hit ? hit[1] : (m ? parseInt(m[1], 10) : null);
    return { jp: hit ? hit[0] : '', num };
  }
  function vendingSetName(num) {
    const hits = Object.entries(VENDING).filter(([, arr]) => arr.includes(num)).map(([k]) => '拡張シート' + k);
    return hits.join('/') || '拡張シート';
  }
  // タイトル群から LV / HP / レアリティ表記を拾う
  function detailsFrom(titles) {
    const lv = new Set(), hp = new Set(), rar = new Set();
    titles.forEach(t => {
      (t.match(/L[Vv]\.?\s?(\d{1,2})/g) || []).forEach(x => lv.add('LV.' + x.replace(/\D/g, '')));
      (t.match(/HP\s?(\d{2,3})/gi) || []).forEach(x => hp.add('HP' + x.replace(/\D/g, '')));
      if (/uncommon/i.test(t)) rar.add('◆'); else if (/\bcommon\b/i.test(t)) rar.add('●');
      if (/\bholo\b|\brare\b/i.test(t) && !/uncommon/i.test(t)) rar.add('★');
    });
    return { lv: [...lv].join('/'), hp: [...hp].join('/'), rar: [...rar].join('') };
  }

  const $ = (s, r = document) => r.querySelector(s);

  function parseRows() {
    const text = document.body.innerText;
    const parts = text.split(', preview full size image').slice(1);
    const rows = [];
    for (const p of parts) {
      const l = p.split('\n').map(s => s.trim()).filter(Boolean);
      const i = l.findIndex(s => /^\$\d/.test(s));
      if (i < 0) continue;
      const price = parseFloat(l[i].replace(/[$,]/g, ''));
      const shipTxt = l.slice(i + 1, i + 4).find(s => /^\$\d/.test(s));
      const ship = shipTxt ? parseFloat(shipTxt.replace(/[$,]/g, '')) : 0;
      const freeTxt = l.slice(i + 1, i + 5).find(s => /Free shipping/.test(s)) || '0%';
      const free = parseInt((freeTxt.match(/\d+/) || ['0'])[0], 10);
      const sold = parseInt(l[i + 4], 10) || 1;
      const total = +(price + ship * (1 - free / 100)).toFixed(2);
      const g = GROUPS.findIndex(([, re]) => re.test(l[0]));
      rows.push({ title: l[0], price, ship, free, sold, total, group: g, nm: /\bNM\b|near mint/i.test(l[0]) });
    }
    return rows;
  }

  function imageFor(title) {
    const img = [...document.querySelectorAll('img')].find(i => i.src.includes('ebayimg') && i.alt && title.startsWith(i.alt.slice(0, 40)));
    return img ? img.src.replace(/s-l\d+\./, 's-l400.') : '';
  }

  function median(arr) {
    const a = [...arr].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function summarize(rows) {
    const prices = [];
    rows.forEach(r => { for (let k = 0; k < r.sold; k++) prices.push(r.total); });
    if (!prices.length) return null;
    const med = median(prices);
    const wavg = prices.reduce((s, v) => s + v, 0) / prices.length;
    return { count: prices.length, max: Math.max(...prices), min: Math.min(...prices),
      median: +med.toFixed(2), wavg: +wavg.toFixed(2),
      cap: Math.floor(med * FEE_COEF - FIXED), capW: Math.floor(wavg * FEE_COEF - FIXED) };
  }

  let rows = [];


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


  // ---- 完了表示：パネル上部に大きな緑の帯を出す（次の操作で消える）----
  function showDone(prefix, text) {
    let d = document.getElementById(prefix + '-done');
    if (!d) {
      d = document.createElement('div'); d.id = prefix + '-done';
      d.style.cssText = 'display:none;background:#1a7f37;color:#fff;font-size:16px;font-weight:bold;padding:10px 12px;border-radius:6px;margin:6px 0;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.2)';
      const bar = document.getElementById(prefix + '-headbar');
      if (bar) bar.insertAdjacentElement('afterend', d); else document.getElementById(prefix + '-panel').prepend(d);
    }
    d.textContent = '✅ ' + text; d.style.display = 'block';
    const l = document.getElementById(prefix + '-launch'); if (l) { l.style.background = '#1a7f37'; l.textContent = '✅ ' + l.textContent.replace(/^✅ /, ''); }
    clearTimeout(d._t); d._t = setTimeout(() => { d.style.display = 'none'; }, 60000);
  }
  function hideDone(prefix) {
    const d = document.getElementById(prefix + '-done'); if (d) d.style.display = 'none';
    const l = document.getElementById(prefix + '-launch'); if (l) { l.style.background = ''; l.textContent = l.textContent.replace(/^✅ /, ''); }
  }

  function buildPanel() {
    if ($('#yr-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'yr-panel';
    panel.dataset.v = VERSION;
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;width:600px;max-height:85vh;overflow:auto;background:#fff;border:2px solid #333;border-radius:8px;padding:12px;font:12px/1.5 sans-serif;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.3)';
    panel.innerHTML = `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
        <b style="font-size:14px">リサーチ集計（収録別） <small style="color:#888">v2.9</small></b>
        <span style="flex:1"></span>
        <button id="yr-rerun" style="cursor:pointer">再読込</button>
        <button id="yr-gear" title="シートAPIの設定" style="cursor:pointer">⚙</button>
        <button id="yr-close" style="cursor:pointer">×</button>
      </div>
      <div style="display:grid;grid-template-columns:90px 1fr;gap:4px 8px;margin-bottom:6px">
        <label>英語KW（C列）</label><input id="yr-kw" style="width:100%">
        <label>日本語名（D列）</label><input id="yr-jp" placeholder="自動推定。違えば書き換え" style="width:100%">
        <label title="シートのA列から順に並べる。名前はこの通りに書く">列順（A→）</label><input id="yr-cols" style="width:100%;font-size:11px">
        <label>書き込み先タブ</label><select id="yr-tab"><option>シングル</option><option>セット</option><option>新裏プロモ</option></select>
      </div>
      <div id="yr-settings" style="display:none;border:1px solid #f90;background:#fff8e6;border-radius:6px;padding:6px 8px;margin:6px 0">
        <b>シートAPI 設定</b>（通常は触らない。⚙で閉じる）
        <div style="display:grid;grid-template-columns:100px 1fr;gap:2px 6px;margin-top:4px">
          <label>シートAPI URL</label><input id="yr-api" placeholder="https://script.google.com/macros/s/…/exec" style="font-size:11px">
          <label>APIトークン</label><input id="yr-token" type="password" placeholder="Apps Script の TOKEN と同じ文字列" style="font-size:11px">
        </div>
        <button id="yr-test" style="cursor:pointer;margin-top:4px">接続テスト</button> <span id="yr-testmsg"></span>
      </div>
      <div style="margin-bottom:6px;color:#555">各行の収録は右端のプルダウンで直せます。チェックを外した行は集計から除きます。D列は「日本語名 + 収録名 + 旧裏」で入ります。貼り付けは A〜N の14列（N = eBay画像URL）。</div>
      <div id="yr-msg" style="color:#080;min-height:1.2em"></div>
      <div id="yr-preview" style="margin:4px 0"></div>
      <div id="yr-groups"></div>`;
    document.body.appendChild(panel);
    // 見出し行（最初の flex 行）をヘッダーバーとして使う。畳むときはそれ以外を隠す
    const yrHead = panel.querySelector('div');
    yrHead.id = 'yr-headbar';
    const undock = setupPanelModes(panel, 'yr', '#yr-headbar');
    $('#yr-close').onclick = () => { undock(); panel.remove(); };
    $('#yr-kw').value = new URLSearchParams(location.search).get('keywords') || '';
    $('#yr-cols').value = (typeof GM_getValue === 'function' && GM_getValue('yr_cols')) || COLS_DEFAULT;
    $('#yr-cols').onchange = e => { if (typeof GM_setValue === 'function') GM_setValue('yr_cols', e.target.value.trim()); };
    $('#yr-api').value = GM_getValue('yr_api', ''); $('#yr-token').value = GM_getValue('yr_token', ''); $('#yr-tab').value = GM_getValue('yr_tab', 'シングル');
    $('#yr-gear').onclick = () => { const d = $('#yr-settings'); d.style.display = d.style.display === 'none' ? 'block' : 'none'; };
    $('#yr-test').onclick = () => {
      const url = $('#yr-api').value.trim(), out = $('#yr-testmsg');
      if (!url) { out.textContent = 'URLが空です'; return; }
      out.textContent = '確認中…';
      GM_xmlhttpRequest({ method: 'GET', url, timeout: 20000,
        onload: r => { try { const j = JSON.parse(r.responseText); out.textContent = j.ok ? `OK: ${j.sheet} / ` + (j.tabs || []).map(t => t.missing ? t.tab + '(なし)' : `${t.tab}:見出し${t.headerRow}行目`).join(' / ') : 'NG: ' + j.error; } catch (e) { out.textContent = 'NG: 応答がJSONではありません（デプロイのアクセス設定が「全員」か確認）'; } },
        onerror: () => { out.textContent = 'NG: 通信エラー'; }, ontimeout: () => { out.textContent = 'NG: タイムアウト'; } });
    };
    $('#yr-api').onchange = e => GM_setValue('yr_api', e.target.value.trim());
    $('#yr-token').onchange = e => GM_setValue('yr_token', e.target.value.trim());
    $('#yr-tab').onchange = e => GM_setValue('yr_tab', e.target.value);
    $('#yr-rerun').onclick = load;
  }

  function load() {
    rows = parseRows();
    rows.forEach(r => r.on = GROUPS[r.group][2]);
    // 日本語名は「英語KW」だけから推定する（タイトルまで見るとロット等に含まれる別キャラを拾ってしまう）
    const g = guessCard($('#yr-kw').value);
    if (!$('#yr-jp').value.trim()) $('#yr-jp').value = [g.jp, g.num ? String(g.num).padStart(3, '0') : ''].filter(Boolean).join(' ');
    if (!rows.length) { $('#yr-msg').textContent = '結果表が読めません。ページの読み込みを待ってから再読込してください。'; }
    render();
    if (rows.length) { hideDone('yr'); const n = new Set(rows.map(r => r.group)).size; showDone('yr', `集計 完了：${rows.length}件を${n}グループに仕分けました。収録の「シートに書き込む」へ`); }
  }

  function render() {
    const box = $('#yr-groups');
    const kw = $('#yr-kw').value.trim();
    const opts = GROUPS.map((g, i) => `<option value="${i}">${g[0]}</option>`).join('');
    let html = '';
    GROUPS.forEach((g, gi) => {
      const rs = rows.filter(r => r.group === gi);
      if (!rs.length) return;
      const sel = rs.filter(r => r.on);
      const s = summarize(sel);
      const stat = s
        ? `${s.count}枚 / 最高 $${s.max} 最安 $${s.min} 中央値 <b>$${s.median}</b>（加重平均 $${s.wavg}）→ 上限 <b>${s.cap}円</b>`
        : (g[2] ? '対象なし' : '集計対象外');
      html += `
        <div style="border:1px solid #ccc;border-radius:6px;margin:6px 0;padding:6px 8px;${g[2] ? '' : 'background:#f7f7f7;color:#777'}">
          <div style="display:flex;align-items:center;gap:8px">
            <b style="min-width:120px">${g[0]}</b>
            <span style="flex:1">${stat}</span>
            ${s && g[2] ? `<button data-copy="${gi}" style="cursor:pointer">コピー</button> <button data-write="${gi}" style="cursor:pointer;background:#3665f3;color:#fff;border:0;border-radius:4px;padding:2px 8px;font-weight:bold">シートに書き込む</button>` : ''}
          </div>
          ${rs.map(r => {
            const i = rows.indexOf(r);
            return `<div style="display:grid;grid-template-columns:24px 1fr 70px 36px 130px;gap:4px;padding:2px 0;border-top:1px solid #eee;${r.on ? '' : 'color:#aaa'}">
              <input type="checkbox" data-i="${i}" ${r.on ? 'checked' : ''} style="width:20px;height:20px;cursor:pointer">
              <span title="${r.title}">${r.title.slice(0, 64)}</span>
              <span style="text-align:right">$${r.total}${r.ship && r.free < 100 ? '<small>(送' + r.ship + ')</small>' : ''}</span>
              <span style="text-align:right">×${r.sold}</span>
              <select data-g="${i}" style="font-size:11px">${opts.replace(`value="${r.group}"`, `value="${r.group}" selected`)}</select>
            </div>`; }).join('')}
        </div>`;
    });
    box.innerHTML = html || '結果なし';
    box.querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = e => { rows[+e.target.dataset.i].on = e.target.checked; render(); });
    box.querySelectorAll('select').forEach(se => se.onchange = e => {
      const r = rows[+e.target.dataset.g]; r.group = +e.target.value; r.on = GROUPS[r.group][2]; render();
    });
    box.querySelectorAll('button[data-copy]').forEach(b => b.onclick = () => copyGroup(+b.dataset.copy));
    box.querySelectorAll('button[data-write]').forEach(b => b.onclick = () => writeGroup(+b.dataset.write));
  }

  function buildRow(gi) {
    const kw = $('#yr-kw').value.trim();
    const sel = rows.filter(r => r.group === gi && r.on);
    const s = summarize(sel); if (!s) return;
    const det = detailsFrom(sel.map(r => r.title));
    const g = guessCard(kw + ' ' + $('#yr-jp').value);
    const setName = GROUPS[gi][0] === '拡張シート' ? vendingSetName(g.num) : GROUPS[gi][3];
    const isCarddass = /カードダス/.test(GROUPS[gi][0]);
    // D列: 日本語名 番号 LV HP 収録 旧裏 レアリティ（カードダス等はTCGではないので LV/HP/旧裏/◆ を付けず「名前 カードダス [プリズム]」にする）
    const titlesAll = sel.map(r => r.title).join(' ');
    const jp = isCarddass
      ? [$('#yr-jp').value.trim().replace(/\s*\d{3}$/, ''), 'カードダス', /prism|kira|holo/i.test(titlesAll) ? 'プリズム' : ''].filter(Boolean).join(' ')
      : [$('#yr-jp').value.trim(), det.lv, det.hp, setName, '旧裏', det.rar].filter(Boolean).join(' ');
    const d = new Date();
    const date = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    const img = imageFor(sel[0].title);
    const imgCell = img ? `=IMAGE("${img}")` : '';
    const detail = sel.map(r => `$${r.total}${r.sold > 1 ? '×' + r.sold : ''}${r.nm ? '(NM)' : ''}`).join('/');
    const extra = [det.lv, det.hp, det.rar].filter(Boolean).join(' ');
    const note = `【${GROUPS[gi][0]}】単品${s.count}件（送料込み総額）: ${detail} → 中央値$${s.median} 上限${s.cap}円${extra ? '｜タイトル記載: ' + extra : ''}`;
    // 列順: A記入日 | B画像 | C英語KW | D日本語KW | E販売数 | F最高 | G最安 | H中央値 | I備考 | J上限 | K実勢(空) | L参考ページ(空) | M実勢メモ(空) | N eBay画像URL
    // K〜M はメルカリ側スクリプトが後から1回の貼り付けで埋める
    const vals = { '記入日': date, '画像': imgCell, '英語KW': kw, '日本語KW': jp, '販売数': s.count, '最高値': s.max, '最安値': s.min, '中央値': s.median,
      '備考': note, '上限': s.cap, '実勢価格': '', '参考ページ': '', '実勢メモ': '', 'eBay画像URL': img };
    const cols = ($('#yr-cols').value || COLS_DEFAULT).split(/[,、，]/).map(c => c.trim());
    const cells = cols.map(c => (c in vals ? vals[c] : ''));
    const tsv = cells.join('\t');
    return { tsv, cells, cols, vals, group: GROUPS[gi][0] };
  }

  function showPreview(r) {
    const { cells, cols, vals } = r;
    // 貼り付け前に確認できるよう、列と値の対応を表示
    const letters = i => { let n = i + 1, t = ''; while (n) { t = String.fromCharCode(64 + ((n - 1) % 26) + 1) + t; n = Math.floor((n - 1) / 26); } return t; };
    $('#yr-preview').innerHTML = '<table style="border-collapse:collapse;font-size:11px">' + cols.map((c, i) =>
      `<tr><td style="border:1px solid #ddd;padding:1px 4px;color:#888">${letters(i)}</td><td style="border:1px solid #ddd;padding:1px 4px">${c}${c in vals ? '' : ' <span style="color:#c00">(不明な列名→空)</span>'}</td><td style="border:1px solid #ddd;padding:1px 4px;max-width:360px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${String(cells[i]).slice(0, 60)}</td></tr>`).join('') + '</table>';
  }

  function copyGroup(gi) {
    const r = buildRow(gi); if (!r) return;
    const tsv = r.tsv; showPreview(r);
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(tsv, { type: 'text', mimetype: 'text/plain' });
      else navigator.clipboard.writeText(tsv);
      $('#yr-msg').style.color = '#080';
      $('#yr-msg').textContent = `「${GROUPS[gi][0]}」の1行をコピーしました。シートのA列の空セルを1つ選んで（編集状態にせず）貼り付け。`;
    } catch (e) {
      $('#yr-msg').style.color = '#c00';
      $('#yr-msg').textContent = 'コピーに失敗: ' + e.message;
    }
  }

  function apiPost(payload) {
    const url = $('#yr-api').value.trim(), token = $('#yr-token').value.trim();
    return new Promise((resolve, reject) => {
      if (!url || !token) return reject(new Error('シートAPI URL と APIトークンをパネルに入力してください'));
      GM_xmlhttpRequest({
        method: 'POST', url, data: JSON.stringify(Object.assign({ token }, payload)),
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, timeout: 30000,
        onload: res => { try { const j = JSON.parse(res.responseText); j.ok ? resolve(j) : reject(new Error(j.error || 'unknown')); } catch (e) { reject(new Error('応答が読めません: ' + res.responseText.slice(0, 120))); } },
        onerror: () => reject(new Error('通信エラー')), ontimeout: () => reject(new Error('タイムアウト')),
      });
    });
  }

  async function writeGroup(gi) {
    const r = buildRow(gi); if (!r) return;
    showPreview(r);
    const msg = $('#yr-msg');
    msg.style.color = '#080'; msg.textContent = 'シートに書き込み中…'; hideDone('yr');
    try {
      const res = await apiPost({ action: 'append', tab: $('#yr-tab').value, cells: r.cells });
      msg.textContent = `「${r.group}」を ${res.tab} タブの ${res.row} 行目に追加しました。`;
      showDone('yr', `シート転記 完了：${res.tab} ${res.row}行目（${r.group}）→ 次はメルカリで N列のURLを基準画像に`);
    } catch (e) {
      msg.style.color = '#c00'; msg.textContent = '書き込み失敗: ' + e.message;
    }
  }

  const VERSION = '2.9';
  function addLauncher() {
    const old = $('#yr-launch');
    if (old && old.dataset.v === VERSION) return;
    // 古い版のスクリプトが同時に入っている場合、そのボタンを置き換える（新しい版を優先）
    if (old) old.remove();
    const op = $('#yr-panel'); if (op && op.dataset.v !== VERSION) op.remove();
    const b = document.createElement('button');
    b.id = 'yr-launch';
    b.dataset.v = VERSION;
    b.textContent = '集計 v' + VERSION;
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99998;padding:8px 14px;background:#3665f3;color:#fff;border:0;border-radius:20px;font-weight:bold;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    b.onclick = () => { const ex = document.getElementById('yr-panel'); if (ex) { GM_setValue('yr_mode', 'float'); document.body.style.marginRight = ''; ex.remove(); } buildPanel(); load(); };
    document.body.appendChild(b);
  }
  addLauncher();
  setInterval(addLauncher, 3000);
})();
