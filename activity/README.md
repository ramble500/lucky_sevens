# Discord Activity Scaffold

この `activity/` フォルダは、七並べを Discord Activity に載せるための作業用アプリです。

今は次の 2 つの動かし方を持っています。

- `ローカル開発`
  Vite で画面を出し、room server を別ポートで動かす
- `公開向けの単一サービス`
  ビルド済み画面と room server を同じ Node サービスから配る

## ファイル構成

- `src/shared/rules.js`
  ゲームルールと状態更新
- `src/shared/ai.js`
  CPU の手選び
- `src/shared/roomProtocol.js`
  room server とフロントで共有するイベント名
- `src/ui/render.js`
  画面描画
- `src/app/gameApp.js`
  UI と room とローカル対戦をつなぐ本体
- `src/discord/bridge.js`
  Discord Embedded App SDK 連携
- `src/network/roomClient.js`
  room server 通信
- `server/roomServer.js`
  room server 本体

## ローカル開発

初回だけ依存を入れます。

```powershell
cd activity
npm install
```

### 1. room server を起動

```powershell
cd activity
npm run server
```

### 2. Vite を起動

別のターミナルで:

```powershell
cd activity
npm run dev
```

### 3. ブラウザで確認

- 画面: [http://localhost:5173](http://localhost:5173)
- health: [http://localhost:3001/health](http://localhost:3001/health)

## 固定 URL 向けの構成

Quick Tunnel のように毎回 URL が変わる方法ではなく、1つの公開 URL にまとめるための構成です。

### ローカルで本番に近い形を試す

まずビルドします。

```powershell
cd activity
npm run build
```

次に、ビルド済み画面と room server を同じ Node サービスで起動します。

```powershell
cd activity
$env:SERVE_STATIC="1"
npm run start
```

この状態では次の URL を使います。

- 画面: [http://127.0.0.1:3001](http://127.0.0.1:3001)
- health: [http://127.0.0.1:3001/health](http://127.0.0.1:3001/health)

本番では `NODE_ENV=production` で起動すれば同じ挙動になります。

## 接続先の決まり方

`src/network/roomClient.js` は次の順で room server の接続先を決めます。

1. `options.serverUrl`
2. `VITE_ROOM_SERVER_URL`
3. 開発中なら `http://127.0.0.1:3001`
4. 本番では `window.location.origin`

つまり、公開時にフロントと room server を同じ URL で出せば、追加設定なしでそのままつながります。

## Discord Activity 化の次の段階

固定 URL を用意したら、Discord Developer Portal ではその URL を `URL Mapping` に設定します。

開発中の Quick Tunnel は毎回 URL が変わるため、常用には向いていません。今後は `build` 済みのこのアプリを Node ホスティングに置き、固定 URL を 1 つ持つ前提で進めるのがおすすめです。

## Render に出す場合

このリポジトリのルートには [render.yaml](C:/ドキュメント/ハイエナ/幸運の七並べ/render.yaml) を置いてあります。`activity/` を `rootDir` とする Web Service 1 本構成です。

大まかな流れはこうです。

1. このフォルダを GitHub に push
2. Render で `New -> Blueprint` を選ぶ
3. このリポジトリを接続する
4. `render.yaml` を読み込ませる
5. 初回作成時に `VITE_DISCORD_CLIENT_ID` を入力する
6. デプロイ完了後に `https://xxxx.onrender.com` を取得する
7. Discord Developer Portal の `URL Mapping` をその固定 URL に設定する

Render 側は build 時に `npm install && npm run build`、起動時に `npm run start` を使います。`/health` も health check 用に設定済みです。
