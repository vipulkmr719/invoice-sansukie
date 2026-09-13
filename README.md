# インボイス作成 (Invoice Sakusei)

適格請求書等保存方式（インボイス制度）に対応した、請求書の作成・管理 SaaS。

Next.js (App Router) · TypeScript (strict) · Tailwind CSS · PostgreSQL · Prisma · Zod · Auth.js

---

## 主な機能

| 機能 | 説明 |
| --- | --- |
| 税率ごとの自動計算 | 8%（軽減税率）と 10%（標準税率）を明細ごとに指定。税率区分ごとに合計してから **1回だけ** 端数処理するため、インボイス制度の要件を満たします。 |
| 登録番号の検証 | 適格請求書発行事業者登録番号を「T + 数字13桁」の形式と国税庁のチェックデジットで検証します。 |
| 顧客管理 | 取引先を登録し、請求実績（件数・累計金額）を顧客ごとに集計します。 |
| ダッシュボード | 今月／累計の請求額、消費税合計、支払期限超過、直近6か月の推移。 |
| PDF 出力 | Puppeteer によるサーバーサイド生成。A4・日本語フォント埋め込みで、閲覧環境に依存せず同じ体裁になります。 |
| 課金 | 無料プランは請求書3件まで。Stripe Checkout による月額サブスクリプションと買い切りに対応。 |

---

## セットアップ

### 1. 必要なもの

- Node.js 20 以上（開発・検証は 22 系）
- PostgreSQL 14 以上

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 環境変数

`.env.example` をコピーして `.env` を作成します。**`.env` は絶対にコミットしないでください**（`.gitignore` 済み）。

```bash
cp .env.example .env
```

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DATABASE_URL` | ✔ | PostgreSQL 接続文字列。**サーバー専用** — ブラウザには一切露出しません。 |
| `AUTH_SECRET` | ✔ | Auth.js がセッション JWT の署名に使う鍵。32文字以上。 |
| `NODE_ENV` | | `development` \| `test` \| `production` |
| `APP_URL` | | 公開オリジン。既定は `http://localhost:3000` |
| `PDF_CHROME_PATH` | | PDF 生成に使う Chrome/Chromium のパス。未設定なら puppeteer 同梱版を使用。 |
| `STRIPE_SECRET_KEY` | | Stripe のシークレットキー。未設定なら課金機能は無効のまま動作します。 |
| `STRIPE_WEBHOOK_SECRET` | | Webhook の署名検証キー。未設定の場合、Webhook は 503 を返し一切のイベントを受け付けません。 |
| `STRIPE_PRICE_ID_MONTHLY` | | 月額プランの Price ID。 |
| `STRIPE_PRICE_ID_LIFETIME` | | 買い切りプランの Price ID。 |

`AUTH_SECRET` の生成:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

環境変数は起動時に Zod で検証されます（`src/lib/env.ts`）。不足・不正があれば **起動時に即座に失敗** し、最初のリクエストまで問題が潜伏しません。

### 4. データベース

```bash
npx prisma migrate deploy   # 本番: 既存のマイグレーションを適用
npx prisma migrate dev      # 開発: スキーマ変更からマイグレーションを生成
```

### 5. 起動

```bash
npm run dev     # 開発サーバー
npm run build   # 本番ビルド (prisma generate + next build)
npm start       # 本番サーバー
```

---

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` | Prisma Client 生成 + 本番ビルド |
| `npm start` | 本番サーバー |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest（DB接続テストを含む） |
| `npm run verify` | typecheck → lint → test を一括実行 |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:deploy` | `prisma migrate deploy` |
| `npm run db:studio` | Prisma Studio |

---

## アーキテクチャ

責務ごとにレイヤーを分離しています。上の層は下の層にのみ依存します。

```
src/
├── app/                      ルーティングと画面 (React Server Components)
│   ├── page.tsx                      /          ランディング
│   ├── (auth)/                       /login, /register
│   ├── (app)/                        認証必須のレイアウト配下
│   │   ├── dashboard/                /dashboard
│   │   ├── invoices/                 /invoices, /invoices/new, /invoices/[id]
│   │   ├── clients/                  /clients, /clients/new
│   │   └── settings/                 /settings
│   └── api/health/                   稼働確認エンドポイント
│
├── components/               UI のみ。DB もシークレットも触れない
│   ├── ui/                   Button, Card, Field, Alert, Badge …
│   ├── layout/               AppShell, NavLink, PageHeader
│   ├── auth/ clients/ dashboard/ invoices/ settings/
│
├── server/                   サーバー専用。'server-only' で保護
│   ├── actions/              Server Actions（唯一の書き込み入口）
│   ├── db/                   データアクセス層（リポジトリ + DTO + テナントガード）
│
│   ├── auth/                 セッション・パスワード・認可ガード
│   └── pdf/                  PDF 生成
│       ├── invoice-template.ts  適格請求書の HTML テンプレート（全値エスケープ）
│       ├── render.ts            Puppeteer によるレンダリング
│       └── browser.ts           ブラウザインスタンスの管理
│
├── domain/                   ビジネスロジック（純粋関数・依存なし）
│   ├── money.ts              BigInt による厳密な金額計算
│   ├── tax.ts                消費税の計算（税率ごとに1回だけ端数処理）
│   ├── registration-number.ts 登録番号の形式・チェックデジット
│   └── invoice-number.ts     請求書番号の採番
│
├── validation/               Zod スキーマ（入力の境界）
├── lib/                      env, errors, date, cn, action-result, html
├── auth.ts                   Auth.js 設定（Credentials プロバイダ / Node ランタイム）
├── auth.config.ts            Auth.js 設定のうちエッジ実行可能な部分
└── proxy.ts                  エッジでのセッション検証とリダイレクト
```

### レイヤーの原則

- **`components/` は DB を知らない。** UI は DTO を受け取るだけです。
- **`server/` は `server-only` を import する。** クライアントコンポーネントから誤って読み込むとビルドが失敗するため、`DATABASE_URL` がブラウザバンドルに混入しません。
- **`domain/` は純粋。** 副作用も I/O もないため、サーバーとクライアントの両方から同じ計算を呼べます（フォームのプレビューと保存処理が必ず一致します）。
- **`server/db/` は DTO を返す。** Prisma の `Decimal` / `Date` はここで素の値に変換され、Server Component からそのままクライアントに渡せます。

---

## データベーススキーマ

金額は **整数（円）** で保存します。小数を持ちうる数量・単価のみ `Decimal` です。

| テーブル | 主なカラム |
| --- | --- |
| `users` | `id`, `email` (unique), `passwordHash` (nullable), `createdAt`, `updatedAt` |
| `companies` | `id`, `userId` (unique), `name`, `address`, `phone`, `email`, `registrationNumber`, timestamps |
| `clients` | `id`, `userId`, `name`, `companyName?`, `address?`, `email?`, `phone?`, timestamps |
| `invoices` | `id`, `userId`, `clientId`, `invoiceNumber`, `issueDate`, `dueDate`, `subtotal`, `tax8`, `tax10`, `total`, `notes?`, 当事者スナップショット（下記）, timestamps |
| `invoice_items` | `id`, `invoiceId`, `description`, `quantity`, `unitPrice`, `taxRate`, `amount`, `position` |

**制約とインデックス**

- `invoices` は `(userId, invoiceNumber)` が一意。
- `clients` 削除は、請求書が紐づいている間は拒否されます（`onDelete: Restrict`）。
- ユーザー削除は company / clients / invoices / items へカスケードします。
- データベース側の CHECK 制約（`prisma/migrations/*_add_integrity_constraints`）:
  - `taxRate IN (8, 10)`
  - `quantity >= 0`, `unitPrice >= 0`, `amount >= 0`
  - `subtotal, tax8, tax10, total >= 0`
  - `total = subtotal + tax8 + tax10`
  - `dueDate >= issueDate`
  - `registrationNumber ~ '^T[0-9]{13}$'`

`position` は明細の表示順を保持するための列です（cuid は並び替えに使えないため）。

**当事者のスナップショット**

`invoices` には発行時点の当事者情報を固定する列があります
（`issuerName` / `issuerAddress` / `issuerPhone` / `issuerEmail` /
`issuerRegistrationNumber` / `clientNameSnapshot` / `clientAddressSnapshot` /
`clientEmailSnapshot`）。発行済みの請求書は取引の記録であり、後から自社が移転
したり顧客名が変わったりしても、**すでに送付した請求書の記載が変わってはいけない**
ためです。これらの列が NULL の請求書（スナップショット導入前のもの）は、読み出し
時に現在の `companies` / `clients` レコードにフォールバックします。

---

## 課金とプラン

| プラン | 請求書 | 料金 |
| --- | --- | --- |
| 無料 | **3件まで** | ¥0 |
| 月額 | 無制限 | ¥980 / 月 |
| 買い切り | 無制限 | ¥19,800 / 一括 |

### 支払いの流れ

1. 無料プランの上限（3件）に達する
2. `/invoices/new` が `/upgrade?reason=quota` にリダイレクトされ、プランを提示
3. Stripe Checkout を開始（`startCheckoutAction`）
4. Stripe の決済ページで支払い（**カード情報は当サービスを経由しません**）
5. Stripe が Webhook を送信
6. サーバーが **署名を検証**
7. 検証済みイベントのみが `billing` テーブルを更新
8. 次のリクエストから有料機能が利用可能になる

### 権利付与は Webhook だけが行う

**ブラウザが `/payment/success` に到達しても、有料機能は一切解放されません。**

- 成功ページは **読み取り専用**です。`billing` への書き込みも、セッションの変更も、
  `session_id` の検証も行いません。誰がどんなURLで訪れてもプランは変わりません。
- Webhook がまだ届いていない場合、成功ページは「お支払いを確認しています」と表示します。
  成功したふりはしません。
- 権利の判定は `resolveEntitlement()` のみが行い、入力は **Webhook が書いた行と現在時刻だけ**です。
  URL・クエリパラメータ・Cookie・クライアントから送られた値は一切参照しません。
- 判定は **fail-closed** です。期間が切れていれば、保存された status が `active` でも権利はありません
  （解約 Webhook を取りこぼしても勝手に有料のままにはなりません）。未知の Stripe status は
  `unpaid` として扱います。

### Webhook の安全性

| 対策 | 実装 |
| --- | --- |
| 署名検証 | 生のリクエストボディに対して `stripe.webhooks.constructEvent` を実行。JSON に変換してから再直列化すると署名が壊れるため、バイト列のまま検証します。 |
| リプレイ防止 | Stripe SDK のタイムスタンプ許容（既定300秒）により、古いボディの再送は拒否されます。 |
| 冪等性 | イベントIDを `processed_webhook_events` に **同一トランザクション内で先に INSERT**。再送は主キー制約で弾かれ、ロールバックされるため課金状態は変化しません。片方だけ適用される窓が存在しません。 |
| 本人特定 | アカウントの特定は、記録済みの Stripe Customer ID か、**このサーバー自身が**発行した `client_reference_id` からのみ行います。イベント内の metadata に他人のIDを書いても、その人には付与されません。 |
| 未構成時 | `STRIPE_WEBHOOK_SECRET` が無い場合は 503。検証できないイベントを信用することはありません。 |
| 失敗時の挙動 | 一時的な失敗は 500 を返し Stripe に再送させます。未対応のイベント種別は 200 で確認応答し、再送を止めます。 |

対応イベント: 支払い成功 / 支払い失敗 / サブスクリプション作成・更新・削除 / 期間満了。

### レート制限

インスタンスをまたいで機能するよう、カウンタはデータベースに保持します
（プロセス内カウンタはレプリカごとに別勘定になり、デプロイで消えるため）。

| 対象 | 上限 |
| --- | --- |
| Checkout の作成 | 5回 / 10分（ユーザーごと） |
| Webhook エンドポイント | 240回 / 分（IPごと。署名検証前の負荷制限） |
| 請求書の作成 | 60回 / 10分（ユーザーごと） |
| ログイン試行 | 20回 / 10分（IPごと） |

### 保存しないもの

カード番号・CVV・有効期限・名義人など、**生の決済情報は一切保存も受信もしません**。
カード情報は Stripe のホスト型 Checkout ページに直接入力され、当サービスのサーバーを経由しません。
`billing` テーブルが持つのは Stripe の **識別子**（`cus_…` / `sub_…` / `price_…`）と状態のみです。

## 認証

Auth.js（NextAuth v5）の Credentials プロバイダによるメールアドレス + パスワード認証です。

- **パスワードハッシュ**: scrypt（N=2^17, r=8, p=1）+ ランダムソルト、`timingSafeEqual` で比較。
  Node 標準の `node:crypto` のみで、追加依存はありません。平文は保存も記録もしません。
  （bcrypt ではなく scrypt を採用した理由は「残っている課題」を参照）
- **パスワード要件**: 10文字以上、英字と数字を含むこと。
- **セッション**: HS256 署名の JWT を httpOnly / SameSite=Lax / 本番は Secure な Cookie に格納。
  中身は user id のみ。Credentials プロバイダはデータベースセッションを使えないため JWT 戦略です。
- **汎用エラーメッセージ**: 未登録のアドレス・誤ったパスワード・パスワード未設定のいずれでも
  「メールアドレスまたはパスワードが正しくありません。」の1種類だけを返します。
  アカウントの存在を応答から判別できません。
- **タイミング攻撃対策**: アカウントが存在しない場合もダミーハッシュで同じ scrypt 計算を実行します。

## データ分離（マルチテナント）

`Client` / `Invoice` / `InvoiceItem` / `Company` のすべての読み書きは、認証済みユーザーに
スコープされます。これを **3層** で担保しています。どの1層が欠けても分離は破れません。

**第1層 — アプリケーション**
リポジトリ層（`src/server/db/`）のみが Prisma に触れ、すべてのクエリが
`where: { id, userId }` の形を取ります。所有権は取得後の比較ではなく `where` 句で
表現するため、比較の書き忘れが起こりません。他人の ID は「存在しない ID」と
同じ結果（null / 404）になり、存在の有無すら分かりません。

**第2層 — テナントガード（`src/server/db/tenant-guard.ts`）**
Prisma のクライアント拡張として、テナント所有モデルに対する
**スコープされていないクエリをデータベースに到達する前に拒否**します。
`findUnique({ where: { id } })` のような、一見正しく見えて他人の行を返すクエリは
静かな情報漏洩ではなく即座の例外になります。`OR` の中のスコープは
（片方の枝が無条件なら結果集合が広がるため）スコープとして認めません。

**第3層 — データベース**
`invoices` は `(clientId, userId)` の複合外部キーで `clients(id, userId)` を参照します。
他人の顧客を参照する請求書は、アプリケーションを完全に迂回しても
**データベースが拒否**します。

さらに `tests/data-access-audit.test.ts` がソースを静的に検査し、
リポジトリ層以外から Prisma を呼んでいないこと、テナントモデルへの全クエリが
`userId` に言及していることを、実行経路に関係なく確認します。

### カスケードの安全性

- ユーザー削除 → 自社情報・顧客・請求書・明細をカスケード削除（自分のデータのみ）。
- `invoices → clients` は **NO ACTION**。RESTRICT だとユーザー削除時に
  どちらのカスケードが先に走るかで成否が変わるため、文の終わりに検査される
  NO ACTION を選んでいます。請求書が紐づく顧客の削除は引き続き拒否されます。
- `invoice_items → invoices` はカスケード削除。明細は請求書経由でしか到達できません。

## セキュリティ

| 対策 | 実装 |
| --- | --- |
| `.env` を秘匿 | `.gitignore` に `.env` / `.env.*` / `*.env` 等。追跡されるのは `.env.example` のみ。 |
| 資格情報のハードコード禁止 | `process.env` を読むのは `src/lib/env.ts`（アプリ）と `prisma.config.ts`（CLI）だけ。 |
| `DATABASE_URL` をクライアントに出さない | `src/server/**` は `server-only` を import。クライアントから参照するとビルドが失敗します。`NEXT_PUBLIC_` 変数は一切ありません。 |
| TypeScript strict | `strict` に加え `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`。 |
| 環境変数の起動時検証 | `src/lib/env.ts` がモジュール評価時に Zod で検証。エラー時は変数名と理由のみ出力し、値（＝パスワード）は出しません。 |
| クライアント入力を信用しない | すべての Server Action が Zod で検証。金額は **サーバーで再計算** され、クライアントが送った合計は使いません。`userId` はセッションから取得し、フォームの値は無視します。 |
| DB 操作はサーバー側のみ | Prisma Client は `src/server/db/prisma.ts` のみに存在。 |
| SQL インジェクション対策 | Prisma のパラメータ化クエリのみ。生 SQL は引数のない `SELECT 1` だけです。 |
| 認可 | すべてのクエリが `where: { userId }` で絞り込み。他人の ID を指定しても 404 になります。アプリ層・テナントガード・複合外部キーの3層で担保。 |
| エラー処理 | `AppError` は日本語の安全なメッセージ、それ以外はサーバーログに記録し汎用文言に置き換え。スタックトレースやシークレットは返しません。 |
| XSS 対策 | PDF/HTML はエスケープ既定のタグ付きテンプレートで構築。生の markup を入れられるのは `unsafeRawHtml()` のみ（呼び出しは定数 CSS 1箇所）。React 側は既定でエスケープされます。 |
| PDF レンダラーの隔離 | ページ上で JavaScript を無効化、初回ドキュメント以外の通信を遮断（SSRF 対策）、リクエストごとに独立コンテキスト。 |
| パスワード | scrypt（N=2^17, r=8, p=1）+ ランダムソルト、`timingSafeEqual` で比較。 |
| ログインのタイミング攻撃対策 | アカウントが存在しない場合もダミーハッシュで同じ計算を実行します。 |
| セッション | HS256 署名 JWT を httpOnly / SameSite=Lax / 本番は Secure な Cookie に格納。中身は user id のみ。毎リクエストで DB 実在確認。 |
| セキュリティヘッダー | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`。`X-Powered-By` は無効化。 |

`src/proxy.ts`（エッジ）は Auth.js がセッション JWT の署名を検証したうえでリダイレクトを
判断する **補助的な** 関門です。実際の認可は各ページの `requireUser()`（アカウントの実在を
毎回データベースで確認）と、すべてのクエリのテナントスコープが行います。

---

## テスト

```bash
npm test
```

| ファイル | 内容 |
| --- | --- |
| `tests/billing-security.test.ts` | 課金のセキュリティ7項目（0件/3件/4件目の拒否、偽の成功URL、不正な署名、重複Webhook、他人の課金状態）とサブスクリプションのライフサイクル |
| `tests/entitlement.test.ts` | 権利判定の網羅テスト: 全 Stripe status、期間境界、解約予約、買い切り、未知 status の扱い |
| `tests/idor.test.ts` | User A / User B による IDOR 検証: 請求書・顧客・自社情報・明細・ダッシュボード集計・PDF の越境アクセス、越境の更新／削除、複合外部キー、カスケードの安全性 |
| `tests/tenant-guard.test.ts` | テナントガードの述語: スコープなしの読み書きを拒否し、正しいスコープ（`userId` / 関係経由 / 複合ユニークキー / AND 内）は通す |
| `tests/data-access-audit.test.ts` | ソースの静的検査: リポジトリ層以外から Prisma を呼んでいないこと、全テナントクエリが `userId` に言及していること |
| `tests/db.test.ts` | データベース接続、全モデルの疎通、マイグレーション適用確認、請求書の永続化、CHECK 制約（不正な税率・負の数量・負の単価・合計不整合・登録番号形式・日付逆転）、パスワードハッシュ |
| `tests/invoice-validation.test.ts` | 請求書作成の検証、明細の税率、負の数量、負の単価、登録番号（形式・チェックデジット）、顧客の検証 |
| `tests/invoice-security.test.ts` | セキュリティ要件の9項目（XSS×3・登録番号・負の数量・負の単価・不正な税率・極端に大きい値・必須項目の欠落）+ 日付と識別子 |
| `tests/invoice-persistence.test.ts` | 作成→保存→再読み込み、スナップショットの固定、日本語の往復、顧客の所有権チェック |
| `tests/html-escaping.test.ts` | エスケープ処理、タグ付きテンプレート、`nl2br`、XSS ペイロード14種 |
| `tests/pdf-template.test.ts` | 適格請求書の記載事項、税率ごとの内訳、全フィールドへの XSS ペイロード注入 |
| `tests/pdf-security.test.ts` | 実ブラウザでの検証（**JavaScript を有効にしても**何も実行されない）、外部通信ゼロ、PDF 生成とフォント埋め込み |
| `tests/tax.test.ts` | 税率の妥当性、税率ごとの端数処理、8%/10% の区分集計 |
| `tests/registration-number.test.ts` | 形式・チェックデジット・全角正規化・表示整形 |
| `tests/money.test.ts` | BigInt による厳密計算、丸め、浮動小数点誤差の回避 |

データベーステストは `.env` の `DATABASE_URL` に接続します。作成したデータは後片付けされます。

---

## PDF 生成

`GET /invoices/:id/pdf` がサーバーサイドで PDF を生成します。

1. `src/server/pdf/invoice-template.ts` が適格請求書の HTML を組み立てます。
   ユーザー由来の値はすべて `src/lib/html.ts` の `html` タグ付きテンプレートを
   通り、**既定でエスケープ**されます。生の markup を入れられるのは
   `unsafeRawHtml()` だけで、呼び出し箇所は本文中の定数 CSS ひとつです。
2. `src/server/pdf/render.ts` が Puppeteer でレンダリングします。多層防御:
   - ページ上で **JavaScript を無効化**（万一エスケープ漏れがあっても実行系がない）
   - **初回ドキュメント以外の通信をすべて遮断**（外部への情報送信と SSRF を封鎖）
   - リクエストごとに独立した incognito コンテキスト
   - タイムアウトと確実なページ破棄
3. ルートハンドラは認証済みユーザーのスコープで請求書を取得します。未ログインは
   401、他人の請求書 ID は 404（存在有無を区別させない）。

テンプレートは自己完結しており、外部 CSS・スクリプト・フォント・画像を一切
読み込みません。日本語フォントは PDF にサブセット埋め込みされるため、フォントが
入っていない環境で開いても文字化けしません。

> 本番環境では、レンダリングを行うホストに日本語フォント
> （`fonts-ipafont-gothic` や `fonts-noto-cjk` など）が必要です。

## 消費税の計算について

インボイス制度では、消費税額の端数処理は **税率ごとに1回** しか行えません。本アプリの `calculateInvoiceTotals()` は次の順で計算します。

1. 明細ごとに `数量 × 単価` を BigInt で厳密に計算し、円単位に四捨五入 → `amount`
2. `amount` を税率（8% / 10%）ごとに合計 → 税率区分ごとの対価の額
3. 区分ごとの合計に税率を掛け、**切り捨て** で円単位に → `tax8` / `tax10`
4. `total = subtotal + tax8 + tax10`

同じ関数をフォームのプレビューと Server Action の両方が呼ぶため、画面の金額と保存される金額が必ず一致します。保存時はサーバー側で再計算するので、クライアントが改ざんした値は採用されません。

---

## 残っている課題

- **パスワードハッシュに scrypt を採用**しています。要件は「bcrypt/secure password hashing」
  でしたが、scrypt はメモリハードで OWASP の推奨アルゴリズムであり、bcrypt にある
  72バイトでの切り捨てもありません。Node 標準の `node:crypto` だけで動くため、
  ネイティブビルドや追加依存も不要です。bcrypt が必須であれば
  `src/server/auth/password.ts` の差し替えだけで対応できます
  （保存形式にアルゴリズム名が含まれているため、既存ハッシュとの併存も可能です）。
- **Auth.js v5 はベータ**（`next-auth@5.0.0-beta.32`）です。App Router 対応の系列は
  現状これのみで、v4 は Pages Router 前提です。
- **OAuth / マジックリンクは未実装**です。追加する場合は `@auth/prisma-adapter` と
  `Account` / `Session` / `VerificationToken` モデルが必要になります
  （`User.passwordHash` はその前提で nullable のままにしてあります）。
- 請求書の編集機能はまだありません（作成・閲覧・削除のみ）。
- **Stripe との実通信は未検証**です。署名検証・冪等性・権利付与はすべて実際の Stripe SDK と
  実データベースで検証済みですが、この環境から Stripe API への実際の決済フロー
  （テストカードでの Checkout 完了）は通していません。本番投入前に Stripe のテストモードで
  一度通してください。
- **解約導線（カスタマーポータル）は未実装**です。現状、解約は Stripe ダッシュボードまたは
  `billingPortal.sessions.create` の追加実装が必要です。Webhook 側は解約・期限切れを
  すでに正しく処理します。
- レート制限は固定ウィンドウ方式のため、ウィンドウ境界をまたぐと最大2倍まで通過し得ます。
  不正利用対策としては十分ですが、厳密な保証が必要な場合はスライディングウィンドウが必要です。

## ライセンス / 免責

本ソフトウェアは請求書の作成を補助するものであり、税務上の助言を提供するものではありません。税務処理については税理士等の専門家にご確認ください。
