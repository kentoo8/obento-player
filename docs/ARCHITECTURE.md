# アーキテクチャ

Obento Player は、`file://` で直接起動できるように、ビルド不要のクラシックJavaScriptで構成する。各モジュールは `window.Obento*` に公開され、`app.js` がそれらを組み合わせる。

## 読み込み順

`index.html` は次の順でスクリプトを読み込む。

1. `core.js`: 時間表示、値の正規化、デッキ・シーン生成などの純粋関数
2. `settings.js`: `localStorage` からの設定復元と保存
3. `shuffle-manager.js`: 動画間の公平な巡回と動画内シーンの選択
4. `video-library.js`: 動画登録、形式判定、Blob URL、メタデータ読み込み
5. `audio-manager.js`: Web Audio、自動レベリング、音量反映
6. `ui.js`: 固定DOM要素の取得
7. `playback-manager.js`: 全体再生状態とセル切替タイマー
8. `app.js`: 状態、動画セル、各モジュールの接続、ユーザー操作

## 依存関係

- `core.js`、`settings.js`、`video-library.js`、`audio-manager.js`、`ui.js`、`playback-manager.js` は相互依存しない。
- `shuffle-manager.js` は `core.js` のデッキ・シーン生成を利用する。
- `app.js` だけが全モジュールとDOMを接続する。
- Node.js上ではCommonJSとして同じロジックを読み込み、自動テストを実行する。

## 状態の所有者

| 状態 | 所有者 |
|---|---|
| グリッド、音量、再生、回転、除外、ソロ | `app.js` |
| 保存可能な設定値 | `settings.js` |
| 動画と長さ、Blob URL、先読みキュー | `video-library.js` |
| 動画・シーンデッキと直前の選択 | `shuffle-manager.js` |
| AudioContextと自動音量調整 | `audio-manager.js` |
| セル切替タイマー | `playback-manager.js` |

## 変更時の指針

- 計算だけで完結する処理は `core.js` または専用モジュールへ置く。
- ブラウザAPIを扱うモジュールは、テストで代替実装を渡せる生成関数にする。
- DOMのイベントを受けた後は、所有者のAPIを通じて状態を変更する。
- モジュールを追加した場合は、`index.html` の依存順、`package.json` の構文チェック、本文書を同期する。
