# サワディーブロス ネット予約システム - プロジェクト概要

## Claudeへの依頼ルール
- POS本店の営業に影響を与えないこと（独立デプロイ）
- 最初からマルチテナント対応（tenantId必須・ハードコード禁止）
- 営業中の本番システム化したら破壊的変更は慎重に
- 書き込み系の本番投入は営業後・休業日・テストファイル経由で（POS側事故から学習済み）

## システム概要
タイ料理レストラン「サワディーブロス」（25席）向けネット予約システム。
- 客側：日時・人数・連絡先入力で予約
- 店舗側：予約一覧・受付管理
- 将来的にPOSのSaaSオプション機能として有料化予定

## 関連プロジェクト
- **sawasdee-pos**（POSメイン・別フォルダ・別Cloudflare Pages）：同じFirebase共有
  - **Firebaseは同じ`sawatdee-bros`プロジェクトを共有**
  - データパス：`/tenants/{tenantId}/reservations` `/tenants/{tenantId}/reservation_settings`
  - POSの`store_config`（テーブル数・営業日切替時刻）を**読み取り専用**で参照
  - paxノードと予約データの突合は**やらない**（予約客が来店時にPOS側で別途pax入力）
  - 公開時はPOSのcustomer.htmlからリンクで遷移する想定
- **sawatdee-fun**（お楽しみページ）：直接連携なし。同じFirebaseは共有
- **saas-planning**（POS側で進行中）：オプション機能としての料金設計に紐づく

## 本番環境（予定）
- **URL**: https://sawatdee-reservation.pages.dev/
- **GitHub**: https://github.com/sawatdee-bros/sawatdee-reservation
- **Firebase**: sawatdee-bros（POSと同じ・asia-southeast1）
  - DB URL: https://sawatdee-bros-default-rtdb.asia-southeast1.firebasedatabase.app
- **Cloudflare Pages**: sawatdee-reservation.pages.dev（要セットアップ）

## アカウント情報
- POSと共通：irreciy2000@gmail.com（オーナー：takuya）

## ファイル構成（予定）
| ファイル | 説明 |
|---------|------|
| index.html | 客向け予約画面（日付選択→時間→人数→連絡先） |
| admin.html | 店舗向け予約管理（一覧・確定・キャンセル・no_show記録） |
| settings.html | 受付時間帯・休業日設定 |

## デプロイ方法
GitHubにファイルをpushすると自動でCloudflare Pagesにデプロイされる（POSと同じパターン）。

## Firebase構造（最初からテナントID対応）
```
/tenants/{tenantId}/
  reservations/
    YYYY-MM-DD/
      {id}/
        date, time_slot, party_size, name, phone, note
        status: 'pending' | 'confirmed' | 'cancelled' | 'no_show'
        created_at, confirmed_at, cancelled_at
  reservation_settings/
    time_slots: [{start, end, capacity}]
    closed_dates: [YYYY-MM-DD, ...]
    accept_until_minutes_before: 数値（営業開始何分前まで受付可）
```

## 設計原則
- **tenantIdはハードコード禁止**：store_configから取得 or URL/サブドメインから判定
- 本店運用時は `tenantId = "sawatdee-bros"` 固定でOK
- POSのstore_configは読み取り専用で参照（書き込まない）
- iOS Safari + Firebase WSゾンビ問題：初期データはREST APIで取得（POS側で確立済みの方針）

## MVPスコープ
**含める**：
- 客向け予約UI（日付・時刻・人数・連絡先）
- 店舗向け予約管理（一覧・確定/キャンセル・no_show）
- 受付時間帯・休業日設定

**含めない（後フェーズ）**：
- メール/SMS通知
- 決済前金
- 多言語UI
- POS連動（来店時のテーブル割当）

## 直近のタスク
1. プロジェクト初期化（gh repo create + 初期コミット + push）
2. Cloudflare Pages連携（GitHub→Cloudflare Pagesプロジェクト作成）
3. settings.html（受付時間帯・休業日の初期データ投入）
4. index.html（客向け予約UI）
5. admin.html（店舗向け管理）
6. ローカル動作確認 → 本番公開

## 完了判定
- 自店舗で1週間運用しても通常営業に支障が出ない
- 1日10件程度の予約をさばける運用フローが確立
- POS本店の営業に一切影響していない

## 注意事項
- POS側で進行中：Phase 1セキュリティ実装。Firebase Rules変更（POS側のフェーズ5）の前後数日は本プロジェクトの書き込みを停止する協調が必要
- 横断的判断はPOSのdirectorセッションで裁定
