# yoriko-research-tools

旧裏ポケカ 仕入れリサーチ用のツール一式。

## インストール（Tampermonkey）
Chrome に Tampermonkey を入れた状態で、下のリンクを開くとインストール画面が出ます。
以後は GitHub 上のファイルが更新されると、Tampermonkey が自動で新しい版に入れ替えます（1日1回程度確認。すぐ反映したいときは Tampermonkey ダッシュボード → ユーティリティ → 「スクリプトの更新をチェック」）。

- Seller Hub 集計: https://raw.githubusercontent.com/affyokko-gh/yoriko-research-tools/main/sellerhub_research_helper.user.js
- メルカリ実勢価格チェック: https://raw.githubusercontent.com/affyokko-gh/yoriko-research-tools/main/mercari_price_check.user.js

インストール後、各パネルの ⚙ から「シートAPI URL」と「APIトークン」を入れる（パソコンごとに1回）。

## Apps Script（シート側の受け口）
`research_sheet_api.gs` をリサーチシートの 拡張機能 → Apps Script に貼り、TOKEN を合言葉に変えてウェブアプリとして公開する。
コードを更新したら「デプロイ → デプロイを管理 → 鉛筆 → 新バージョン → デプロイ」。

## 使い方（1枚あたり）
1. Seller Hub Research で検索 → 右下「集計」→ 収録ごとの「シートに書き込む」
2. シートの N 列（eBay画像URL）をコピー
3. メルカリで検索（安い順）→「実勢チェック」→ 基準画像欄に N 列を貼る → 同じカードにチェック →「チェック開始」→「シートに書き込む」
4. シートの 判定（○△×）・倍率 が自動で入る
