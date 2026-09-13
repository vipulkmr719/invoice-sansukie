# インボイス作成 (Invoice Sakusei)

適格請求書等保存方式（インボイス制度）に対応した、請求書の作成・管理 SaaS。

Next.js (App Router) · TypeScript (strict) · Tailwind CSS · PostgreSQL · Prisma · Zod

---

## 主な機能

| 機能 | 説明 |
| --- | --- |
| 税率ごとの自動計算 | 8%（軽減税率）と 10%（標準税率）を明細ごとに指定。税率区分ごとに合計してから **1回だけ** 端数処理するため、インボイス制度の要件を満たします。 |
| 登録番号の検証 | 適格請求書発行事業者登録番号を「T + 数字13桁」の形式と国税庁のチェックデジットで検証します。 |
| 顧客管理 | 取引先を登録し、請求実績（件数・累計金額）を顧客ごとに集計します。 |
| ダッシュボード | 今月／累計の請求額、消費税合計、支払期限超過、直近6か月の推移。 |
| PDF 出力 | 印刷用スタイルで A4 に最適化。ブラウザの「PDFとして保存」でそのまま保存できます。 |

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
| `AUTH_SECRET` | ✔ | セッション JWT の署名鍵。32文字以上。 |
| `NODE_ENV` | | `development` \| `test` \| `production` |
| `APP_URL` | | 公開オリジン。既定は `http://localhost:3000` |

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
│   ├── db/                   データアクセス層（リポジトリ + DTO）
│   └── auth/                 セッション・パスワード・認可ガード
│
├── domain/                   ビジネスロジック（純粋関数・依存なし）
│   ├── money.ts              BigInt による厳密な金額計算
│   ├── tax.ts                消費税の計算（税率ごとに1回だけ端数処理）
│   ├── registration-number.ts 登録番号の形式・チェックデジット
│   └── invoice-number.ts     請求書番号の採番
│
├── validation/               Zod スキーマ（入力の境界）
├── lib/                      env, errors, date, cn, action-result
└── proxy.ts                  エッジでの事前リダイレクト（補助的な関門）
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
| `invoices` | `id`, `userId`, `clientId`, `invoiceNumber`, `issueDate`, `dueDate`, `subtotal`, `tax8`, `tax10`, `total`, `notes?`, timestamps |
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

---

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
| 認可 | すべてのクエリが `where: { userId }` で絞り込み。他人の ID を指定しても 404 になります。 |
| エラー処理 | `AppError` は日本語の安全なメッセージ、それ以外はサーバーログに記録し汎用文言に置き換え。スタックトレースやシークレットは返しません。 |
| パスワード | scrypt（N=2^17, r=8, p=1）+ ランダムソルト、`timingSafeEqual` で比較。 |
| ログインのタイミング攻撃対策 | アカウントが存在しない場合もダミーハッシュで同じ計算を実行します。 |
| セッション | HS256 署名 JWT を httpOnly / SameSite=Lax / 本番は Secure な Cookie に格納。中身は user id のみ。毎リクエストで DB 実在確認。 |
| セキュリティヘッダー | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`。`X-Powered-By` は無効化。 |

`src/proxy.ts`（エッジ）は Cookie の有無だけを見る **補助的な** 関門です。実際の認可は各ページの `requireUser()` が行います。

---

## テスト

```bash
npm test
```

| ファイル | 内容 |
| --- | --- |
| `tests/db.test.ts` | データベース接続、全モデルの疎通、マイグレーション適用確認、請求書の永続化、CHECK 制約（不正な税率・負の数量・負の単価・合計不整合・登録番号形式・日付逆転）、パスワードハッシュ |
| `tests/invoice-validation.test.ts` | 請求書作成の検証、明細の税率、負の数量、負の単価、登録番号（形式・チェックデジット）、顧客の検証 |
| `tests/tax.test.ts` | 税率の妥当性、税率ごとの端数処理、8%/10% の区分集計 |
| `tests/registration-number.test.ts` | 形式・チェックデジット・全角正規化・表示整形 |
| `tests/money.test.ts` | BigInt による厳密計算、丸め、浮動小数点誤差の回避 |

データベーステストは `.env` の `DATABASE_URL` に接続します。作成したデータは後片付けされます。

---

## 消費税の計算について

インボイス制度では、消費税額の端数処理は **税率ごとに1回** しか行えません。本アプリの `calculateInvoiceTotals()` は次の順で計算します。

1. 明細ごとに `数量 × 単価` を BigInt で厳密に計算し、円単位に四捨五入 → `amount`
2. `amount` を税率（8% / 10%）ごとに合計 → 税率区分ごとの対価の額
3. 区分ごとの合計に税率を掛け、**切り捨て** で円単位に → `tax8` / `tax10`
4. `total = subtotal + tax8 + tax10`

同じ関数をフォームのプレビューと Server Action の両方が呼ぶため、画面の金額と保存される金額が必ず一致します。保存時はサーバー側で再計算するので、クライアントが改ざんした値は採用されません。

---

## ライセンス / 免責

本ソフトウェアは請求書の作成を補助するものであり、税務上の助言を提供するものではありません。税務処理については税理士等の専門家にご確認ください。
