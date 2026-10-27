# FireEye API — Cloudflare Worker Dağıtımı

Bu klasör (`cloudflare-worker/`), `fireeye-api` adlı Cloudflare Worker'ının kaynak kodunu içerir.
Worker; D1 veritabanı (`fireeye_db`), oturum imzalama (`SESSION_SECRET`) ve cihaz paylaşılan
anahtarı (`DEVICE_SECRET`) ile çalışır.

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
```

### Gizli değerler (secrets)

```powershell
npx wrangler secret put SESSION_SECRET      # uzun, rastgele bir metin
npx wrangler secret put DEVICE_SECRET       # ESP32 firmware ile aynı olmalı
# İsteğe bağlı:
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put MICROSOFT_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

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

## 4. Kontrol

```powershell
npx wrangler deployments list
npx wrangler tail
```
