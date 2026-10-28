# FireEye API — Cloudflare Worker Dağıtımı

Bu klasör (`cloudflare-worker/`), `fireeye-api` adlı Cloudflare Worker'ının kaynak kodunu içerir.
Worker; D1 veritabanı (`fireeye_db`), oturum imzalama (`SESSION_SECRET`) ve cihaz başına üretilen
token'larla çalışır. Cihazlar MQTT değil **HTTP** kullanır: 3 saniyede bir veri gönderir, panelden
gelen komutları çeker.

## 1. Gereksinimler

- Node.js 20+
- Cloudflare hesabı: **ereny116011@gmail.com**
- GitHub deposu: **ereny116011-cloud/TechnoStudios**

## 2. Yerel (tek seferlik) kurulum

```powershell
cd cloudflare-worker
npm install
npx wrangler login        # tarayıcı açılır, ereny116011@gmail.com ile giriş yap
```

D1 veritabanı bu hesapta yoksa oluştur ve `wrangler.toml` içindeki `database_id` değerini güncelle:

```powershell
npx wrangler d1 create fireeye_db
npx wrangler d1 execute fireeye_db --remote --file=./schema.sql
npx wrangler d1 execute fireeye_db --remote --file=./schema_v2.sql
npx wrangler d1 execute fireeye_db --remote --file=./schema_v3.sql
npx wrangler d1 execute fireeye_db --remote --file=./schema_v4.sql
```

`schema_v4.sql`; `devices` (kullanıcı başına çoklu cihaz) ve `device_reading_history`
(son 24 saat grafiği) tablolarını ekler, eski MQTT hesap/topic'lerini cihaz olarak taşır.

### Gizli değerler (secrets)

```powershell
npx wrangler secret put SESSION_SECRET      # uzun, rastgele bir metin
npx wrangler secret put ADMIN_USER          # yönetici kullanıcı adı
npx wrangler secret put ADMIN_PASS          # yönetici şifresi
# İsteğe bağlı:
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put MICROSOFT_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

> `DEVICE_SECRET` yalnızca **eski (token'sız) cihazlar** için geriye dönük uyumluluk amacıyla
> okunur. Yeni cihazlar panelde üretilen `fe_...` token'ını `X-Device-Token` başlığıyla gönderir.

## 2.1. Cihaz bağlama (Deneyap Kart 1A / ESP32)

1. Panele giriş yap → **Cihazım** sekmesi → **Cihaz Ekle**.
2. Açılan pencerede **Cihaz Anahtarı** ve **Cihaz Token'ı** bir kez gösterilir; kopyala.
   (Token kaybolursa aynı cihaz için **Token Yenile** ile yenisini üret.)
3. `esp32_ornek_firmware.ino` dosyasında `WIFI_SSID`, `WIFI_PASSWORD`, `WORKER_BASE`,
   `DEVICE_KEY` ve `DEVICE_TOKEN` alanlarını doldur.
4. Kartı yükle. Panel 3 saniyede bir veriyi gösterir; komutlar 3 saniye içinde karta ulaşır.

Cihaz uçları:

| Uç | Yön | Yetki |
| --- | --- | --- |
| `POST /device/report` | Cihaz → sunucu | `X-Device-Token` |
| `GET /device/command?device_key=...` | Cihaz → sunucu | `X-Device-Token` |
| `GET /device/latest?device_key=...` | Panel | Bearer oturum + sahiplik |
| `GET /device/history?device_key=...` | Panel | Bearer oturum + sahiplik |
| `POST /device/command` | Panel → kuyruk | Bearer oturum + sahiplik |
| `GET/POST/DELETE /devices` | Panel | Bearer oturum |
| `POST /devices/rotate-token` | Panel | Bearer oturum + sahiplik |

### İlk dağıtım

```powershell
npx wrangler deploy
```

Worker adresi: <https://fireeye-api.ereny116011.workers.dev>

## 3. GitHub'a bağlama ve otomatik dağıtım

Depoya `.github/workflows/deploy-worker.yml` eklendi. `main` dalına yapılan ve
`cloudflare-worker/` altını etkileyen her push'ta Worker otomatik dağıtılır.

GitHub deposunda **Settings → Secrets and variables → Actions** bölümüne iki secret ekle:

| Secret                  | Değer                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare Dashboard → My Profile → API Tokens → *Edit Cloudflare Workers* şablonu |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard → Workers & Pages → sağ kenardaki Account ID      |

> Not: `wrangler login` ile oluşan OAuth oturumu CI'da kullanılamaz; bu yüzden Actions için
> API Token gerekir. Token'a `Workers Scripts:Edit`, `D1:Edit` ve `Account Settings:Read`
> izinlerini ver.

## 4. Otomatik dağıtım durumu

- İş akışı: `.github/workflows/deploy-worker.yml`
- Gerekli GitHub secret'ları: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- `main` dalına `cloudflare-worker/` altında yapılan her push otomatik dağıtılır.
- Manuel tetikleme: GitHub → Actions → **Deploy Cloudflare Worker** → **Run workflow**.

## 5. Kontrol

```powershell
npx wrangler deployments list
npx wrangler tail
```
