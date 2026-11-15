# AGENTS.md — TechnoStudios / FireEye

Bu dosya, bu depoda çalışan yapay zeka ajanları ve geliştiriciler için kısa bağlam ve kurallar içerir.
Kod tabanı **derleme adımı olmayan** statik HTML/CSS/JS + tek bir **Cloudflare Worker**'dan oluşur.

---

## 1. Projeye genel bakış

- **Web sitesi (statik):** `https://www.technoweb.win` — kök dizindeki dosyalar doğrudan sunulur.
- **FireEye ürün sayfası + web paneli:** `fireeye/index.html` (tek dosyada HTML + CSS + JS).
- **Backend:** `cloudflare-worker/` — `fireeye-api` adlı Cloudflare Worker; **D1** (SQLite) veritabanı kullanır.
- **Donanım:** Deneyap Kart 1A / ESP32, MQTT değil **HTTPS** ile 3 saniyede bir Worker'a bağlanır.
- **Mobil uygulama:** Android APK (bu depoda binary olarak `fireeye.apk`; canlı sürümler Wasmer volume'da tutulur).

Canlı API tabanı (birden fazla dosyada gömülü):

```
https://fireeye-api.ereny116011.workers.dev
```

---

## 2. Dizin yapısı

```
/
├─ index.html                 # Kurumsal portal (sekmeler, i18n, tema, FireEye tanıtımı)
├─ iletisim.html              # İletişim formu -> POST /contact
├─ gizlilik.html, kvkk.html,
│  kullanim-sartlari.html,
│  cerez-politikasi.html      # Yasal sayfalar; site-pages.css + site-pages.js
├─ site-pages.css/.js         # Yasal/iletişim sayfalarının ortak tema + footer yılı
├─ fireeye/
│  ├─ index.html              # ASIL uygulama/panel: üyelik, cihaz izleme, admin paneli, i18n
│  ├─ download.html           # Eski/bağımsız indirme sayfası (fireeye.css)
│  ├─ security.html           # Eski/bağımsız güvenlik sayfası (fireeye.css)
│  ├─ css/fireeye.css         # Sadece yukarıdaki iki eski sayfa için
│  └─ *.png, *.jpg, fire.mp4  # Görseller / tanıtım videosu
├─ fireeye.apk                # Binary artifact — düzenlemeyin
├─ cloudflare-worker/
│  ├─ src/index.js            # TÜM API (tek dosya, ~2.000 satır)
│  ├─ wrangler.toml           # Worker + D1 binding
│  ├─ schema.sql … v5.sql     # Sıralı D1 migration'ları
│  ├─ esp32_ornek_firmware.ino# Örnek cihaz firmware'i
│  ├─ DEPLOY.md               # Dağıtım notları (kısmen güncel değil, bkz. §9)
│  └─ package.json            # Sadece wrangler devDependency'si
├─ .github/workflows/deploy-worker.yml  # main'e push'ta Worker otomatik dağıtımı
├─ sitemap.xml, robots.txt    # robots.txt /cloudflare-worker/ dizinini kapatır
└─ app.yaml                   # Wasmer statik dağıtım tanımı (site tarafı)
```

**Yok:** kökte `package.json`, build script'i, test, linter, framework, `README.md`.
Bu yüzden doğrulama manueldir (bkz. §10).

---

## 3. Hızlı komutlar

```powershell
# Worker'ı yerelde çalıştır (D1'i yerel taklit eder)
cd cloudflare-worker
npm install
npx wrangler login          # ilk sefer
npx wrangler dev

# Sözdizimi/derleme doğrulaması (deploy etmeden)
npx wrangler deploy --dry-run

# Dağıt
npx wrangler deploy

# Canlı log
npx wrangler tail

# D1 migration (uzak veritabanı)
npx wrangler d1 execute fireeye_db --remote --file=./schema.sql
npx wrangler d1 execute fireeye_db --remote --file=./schema_v2.sql
npx wrangler d1 execute fireeye_db --remote --file=./schema_v3.sql
npx wrangler d1 execute fireeye_db --remote --file=./schema_v4.sql
npx wrangler d1 execute fireeye_db --remote --file=./schema_v5.sql
```

Statik site için build yoktur: HTML/CSS/JS dosyalarını düzenleyip doğrudan tarayıcıda açın.
`python -m http.server` veya herhangi bir statik sunucu yeterlidir (bazı tarayıcı API'leri
`file://` altında kısıtlı olabilir).

---

## 4. Mimari ve veri akışı

```
ESP32 ──POST /device/report (3 sn)──┐
ESP32 ──GET  /device/command (3 sn)─┤
                                    ▼
Tarayıcı (fireeye/index.html) ──► Cloudflare Worker ──► D1 (fireeye_db)
   │  Bearer oturum / Basic admin        │
   └── GET /device/latest, /device/history┘
                                    │
                                    └── Resend API (e-posta: doğrulama, 2FA, şifre sıfırlama)
Wasmer Volume (S3) ◄── admin paneli → Worker → SigV4 ile APK yükleme (site kendi adresinden sunar)
```

- Worker **tek `fetch` handler**'dır; tüm rotalar `src/index.js` içinde `if (url.pathname === ...)`
  zinciriyle yazılmıştır. Yeni uç eklerken aynı deseni izleyin; router kütüphanesi yoktur.
- Yanıtlar `json(data, status)` yardımcısıyla üretilir; **CORS `*`** açıktır.
- Hatalar Türkçe mesajlarla döner: `{ success: false, message: '...' }` veya `{ error: '...' }`.
  Frontend bu iki şekli de okur; mevcut uçların şeklini bozmayın.

### Kimlik doğrulama modeli

| Tür | Yöntem | Nerede |
| --- | --- | --- |
| Kullanıcı oturumu | `Authorization: Bearer <HMAC imzalı token>` (30 gün) | Çoğu panel ucu |
| Admin (uçlar) | `Authorization: Basic base64(ADMIN_USER:ADMIN_PASS)` | `/admin/*`, `/releases`, silme uçları |
| Admin (oturum) | `/login` yanıtındaki `token` (`admin: true` payload) | `/devices*` gibi oturum uçları |
| Cihaz | `X-Device-Token: fe_...` (SHA-256 hash karşılaştırması) | `/device/report`, `GET /device/command` |
| Eski cihaz | `X-Device-Secret: <DEVICE_SECRET>` | Token'sız cihaz kayıtları |

> **Önemli:** `/admin/*` uçları yalnızca **HTTP Basic** kabul eder; Bearer admin token'ı ile
> çağrılmaz. Tarayıcı Basic başlığını `sessionStorage['fireeye_admin_auth']` içinde tutar.

- Oturum token'ı: `base64url(payload).base64url(HMAC-SHA256)`; `SESSION_SECRET` yoksa
  kullanıcı girişi 500 döner.
- Şifreler: PBKDF2-SHA256, 100.000 iterasyon, 16 byte rastgele salt.
- 2FA: 6 haneli e-posta kodu, 10 dk geçerli, 6 deneme, DB'de yalnızca hash'i tutulur.
  Modlar: `always` (her giriş), `auto` (7+ gün ara), `off`.
- Oran sınırlama D1'deki `rate_limits` tablosunda, kayan pencereyle yapılır ve **fail-open**'dır
  (tablo yoksa istek geçer).

---

## 5. API uçları (özet)

Herkese açık:
- `GET /reviews`, `POST /reviews` — değerlendirmeler
- `GET /changelogs` — sürüm notları
- `GET /screenshots`, `GET /images/<id>` — ekran görüntüleri (D1'de base64, 1 yıl cache)
- `GET /release/latest`, `GET /release/latest/download` - güncel APK meta / APK'ya 302 (kayıt yoksa repodaki `fireeye.apk`)
- `POST /contact` — iletişim formu (honeypot + IP rate limit + Resend)
- `POST /register`, `POST /login`, `POST /login/2fa`
- `POST /forgot-password`, `POST /reset-password`, `GET /verify-email`, `POST /resend-verification`
- `POST /auth/google`, `POST /auth/microsoft`, `GET /auth/github`, `GET /auth/github/callback`

Oturum gerekli:
- `GET /me`, `PUT /user/update-credentials`
- `GET /2fa/status`, `POST /2fa/setup`, `POST /2fa/enable`, `POST /2fa/disable`
- `GET/POST/DELETE /devices`, `POST /devices/rotate-token`, `POST /devices/rename`, `GET /devices/find`
- `GET /device/latest`, `GET /device/history`, `POST /device/command` (panel → kuyruk)

Admin (Basic) gerekli:
- `POST /admin/create-user`, `GET/DELETE /admin/users`
- `POST /admin/users/reset-password`
- `POST /admin/release` (JSON meta kaydı), `POST /admin/release/upload` (multipart APK → Wasmer volume/S3)
- `GET /releases`
- `POST/DELETE /screenshots`, `POST /screenshots/reorder`
- `DELETE /reviews`, `POST/DELETE /changelogs`

Cihaz token'ı gerekli:
- `POST /device/report` — gövde: `{ device_key, payload }`
- `GET /device/command?device_key=...` — okunan komut anında silinir

---

## 6. Veritabanı (D1)

Ana tablolar: `users`, `devices`, `device_readings`, `device_commands`,
`device_reading_history`, `reviews`, `changelogs`, `screenshots`, `releases`,
`contact_messages`, `password_resets`, `rate_limits`.

Çalışma anında otomatik oluşturulan/eklenen yapılar (migration çalıştırılmasa da çalışır):
- `user_2fa`, `email_codes` tabloları (`ensure2faTable`, `ensureEmailCodesTable`)
- `users.last_login_at` (`ensureLoginColumn`)
- `devices.pairing_code_hash` + index (`ensureDeviceCodeColumn`)

Kurallar:
- Migration'lar **sıralı** çalıştırılır (`schema.sql` → `schema_v5.sql`). Yeni şema değişikliği
  için bir sonraki `schema_vN.sql` dosyasını ekleyin; mevcut dosyaları değiştirmeyin.
- `ALTER TABLE ... ADD COLUMN` tekrar çalıştırıldığında "duplicate column" hatası verir; bu beklenen
  bir durumdur.
- Tarihler UTC'dir (`datetime('now')`). `sqliteTimeMs()` ve `parseServerTime()` dönüşümü üstlenir.
- `device_reading_history` yaklaşık her 50 okumada bir 25 saatten eski kayıtları temizler.

---

## 7. Frontend kuralları

- **Tek dosya, inline CSS/JS.** `fireeye/index.html` ~4.700 satır; yeni özellikleri mevcut
  `const`/`function` bloklarının yanına, aynı bölüm düzeninde ekleyin. Yeni build aracı eklemeyin.
- **API tabanı 4 yerde gömülüdür:** `index.html`, `fireeye/index.html`, `fireeye/download.html`,
  `iletisim.html`. Worker adresi değişirse **hepsini** güncelleyin.
- **i18n:** `fireeye/index.html` içinde `FE_I18N.tr` ve `FE_I18N.en`; metinler `data-i18n`,
  `data-i18n-html`, `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-alt`, `data-i18n-aria`
  öznitelikleriyle bağlanır. Yeni metin eklerken **iki dili de** ekleyin. Kök `index.html` kendi
  `i18n` sözlüğünü kullanır; yasal sayfalar yalnızca Türkçedir.
- **Tema:** `fireeye/index.html` için `localStorage['theme']` (`dark`/`light`);
  kök portal ve yasal sayfalar için `localStorage['ts-theme']` + `body.light`.
- **Dil:** `localStorage['ts-lang']` (`tr`/`en`).
- **Oturum:** `localStorage['fireeye_user'] = { token, user }`;
  `localStorage['fireeye_selected_device']`; admin için `fireeye_admin`,
  `fireeye_admin_token`, `fireeye_admin_auth` (sessionStorage).
- Kullanıcı kaynaklı metinleri `escapeHtml()` ile kaçırın (yorum, açıklama, ad).
- Cihaz canlı verisi 3 saniyede bir `GET /device/latest` ile çekilir; `online` eşiği 15 saniyedir.
  Grafikler `device/history` + yerel seri tamponu ile çizilir (`canvas`, kütüphane yok).
- Resim yüklemede istemci tarafı sıkıştırma vardır (`compressImage`, 1600 px / 0.82); Worker
  tarafındaki 2 MB sınırını aşmayın.

---

## 8. Cihaz protokolü

Telemetri metni (firmware'in gönderdiği biçim):

```
TELEMETRI;SICAKLIK=24.5;NEM=41.0;GAZ=312;ESIK=2000;DURUM=NORMAL
```

Eski biçim de desteklenir: `SICAKLIK:24,5,NEM:41,GAZ:312`. `parseTelemetry()` her ikisini ayrıştırır.
`POST /device/report` gövdesi: `{ "device_key": "salon-sensoru-3f9a1c", "payload": "TELEMETRI;..." }`.

- Panel komutları: `POST /device/command` ile kuyruğa yazılır; cihaz 3 saniyede bir `GET` ile çeker.
- Komutlar cihaz başına **tek satır**dır (`ON CONFLICT` ile üzerine yazılır).
- Cihaz eşleştirme: panelde üretilen `fe_...` token'ı yalnızca bir kez gösterilir. Kaybolursa
  `POST /devices/rotate-token` ile yenilenir (eski token geçersizleşir).
- LCD eşleştirme kodu: `devices.pairing_code_hash` içinde SHA-256 olarak tutulur; kod tek başına
  yetki vermez, yalnızca kullanıcının kendi cihazları arasında arama yapılır.

---

## 9. Yapılandırma ve gizli değerler

`wrangler.toml` içindekiler:
- D1 binding: `DB` → `fireeye_db` (database_id gömülü)
- `[vars]`: `RESEND_FROM_EMAIL`, `SUPPORT_EMAIL`

Secret olarak tanımlanması gerekenler:

| Secret | Zorunlu mu | Açıklama |
| --- | --- | --- |
| `SESSION_SECRET` | Evet (kullanıcı girişi için) | HMAC imza anahtarı |
| `ADMIN_USER`, `ADMIN_PASS` | Önerilir | Basic admin kimliği; kodda varsayılan fallback vardır, canlıda mutlaka override edin |
| `DEVICE_SECRET` | Hayır | Yalnızca eski/token'sız cihazlar |
| `RESEND_API_KEY` | E-posta için | Doğrulama, 2FA, şifre sıfırlama, iletişim |
| `GOOGLE_CLIENT_ID` | OAuth için | `fireeye/index.html` içindeki istemci kimliğiyle **aynı** olmalı |
| `MICROSOFT_CLIENT_ID` | OAuth için | Aynı şekilde frontend ile eşleşmeli |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth için | Callback: `<worker>/auth/github/callback` |
| `WASMER_S3_ENDPOINT`, `WASMER_S3_ACCESS_KEY`, `WASMER_S3_SECRET_KEY` | APK yükleme için | `wasmer app volume credentials` çıktısından; Worker S3'e SigV4 ile yazar |
| `WASMER_S3_BUCKET` (varsayılan `downloads`), `WASMER_S3_REGION` (varsayılan `auto`) | APK yükleme için | Volume adı / bölge |

`SESSION_SECRET` yoksa: kullanıcı girişi 500, `/me` 401 döner. `RESEND_API_KEY` yoksa:
e-posta gönderilemez; giriş kod istemeden devam eder, doğrulama e-postası sessizce atlanır.

> Secret'ları **asla** repoya yazmayın. Yerelde `.dev.vars`, üretimde `wrangler secret put` kullanın.
> `.dev.vars`, `.wrangler/`, `.env*`, `node_modules/` `.gitignore` içindedir.

---

## 10. Doğrulama (test/lint yok)

Her değişiklikten sonra en az:

1. `cd cloudflare-worker && npx wrangler deploy --dry-run` — Worker'ın derlendiğini doğrular.
2. Değişen HTML sayfasını tarayıcıda açın; **konsolda hata olmaması** ve ilgili sekmenin
   (İndir, Cihazım, Hesaplar, SSS…) çalışması gerekir.
3. API değiştiyse `npx wrangler dev` + `curl`/PowerShell `Invoke-RestMethod` ile uçları deneyin.
4. i18n değiştiyse TR ve EN dil düğmesiyle metinleri kontrol edin.
5. Türkçe karakterlerin bozulmadığını doğrulayın (dosyalar UTF-8, BOM'suz).

Dosya kodlaması: **UTF-8, BOM yok**. Çoğu HTML/CSS/JS dosyası **CRLF**; `wrangler.toml` LF.
Mevcut satır sonlarını koruyun.

---

## 11. Dağıtım

- **Worker:** `main` dalına `cloudflare-worker/**` altında yapılan push, GitHub Actions
  (`.github/workflows/deploy-worker.yml`) ile otomatik `wrangler deploy` çalıştırır.
  Gerekli GitHub secret'ları: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
  Manuel: Actions → **Deploy Cloudflare Worker** → Run workflow.
- **Site:** Statik dosyalar; CI'da dağıtılmaz. `app.yaml` Wasmer Edge tanımıdır (volume dahil).
- **APK:** APK dosyaları Wasmer Edge'deki **volume**'da tutulur (`app.yaml` → `downloads` →
  `/public/downloads`) ve **sitenin kendi adresinden** servis edilir:
  `https://www.technoweb.win/downloads/fireeye-<sürüm>.apk`.
  Yükleme akışı: admin paneli → `POST /admin/release/upload` (multipart) → Worker sunucu tarafında
  AWS SigV4 imzalayarak S3'e yazar → `releases` tablosuna meta yazılır. S3 anahtarları
  tarayıcıya hiç çıkmaz. Repo kökündeki `fireeye.apk` yedek olarak kalır; kayıt yoksa
  `GET /release/latest/download` bu yedeğe yönlendirir.
- **Site dağıtımı:** Wasmer Edge (`app.yaml`). Site CI'da dağıtılmaz; yasal sayfa ve portal
  değişikliklerini `wasmer deploy` ile yayına almanız gerekir.

---

## 12. Bilinen tuzaklar ve tutarlılık notları

1. `cloudflare-worker/DEPLOY.md` migration listesinde `schema_v5.sql` **yok**; tam kurulum için
   v5'i de çalıştırın. (Kod, `pairing_code_hash` kolonunu çalışma anında kendisi de ekler.)
2. `/admin/*` uçları Bearer değil **Basic** ister; yeni admin ucu eklerken `isAdmin()` kullanın,
   `getSessionUser()` değil.
3. `CORS` başlıkları yalnızca `Content-Type` ve `Authorization`'a izin verir. Tarayıcıdan
   `X-Device-Token` gönderilecekse `Access-Control-Allow-Headers` güncellenmelidir (cihazlar
   tarayıcı olmadığı için mevcut akış etkilenmez).
4. Admin oturumunda `uid = 0`'dır (falsy). `session.uid` kontrolü yapan yeni kodda admin'i ayrıca
   ele alın (`session.admin`).
5. `checkRateLimit` fail-open'dır ve D1'e yazar; hata durumunda isteği engellemez.
   `deviceCodeColumnReady` gibi modül düzeyi bayraklar isolate başına önbelleğe alınır.
6. E-posta gönderimi başarısız olursa giriş akışı kilitlenmemelidir; mevcut kod bu durumda
   kodsuz devam eder. Bu davranışı bozmayın.
7. `ADMIN_USER` karşılaştırması küçük harfe normalize edilir; admin girişinde e-posta alanı
   kullanıcı adı olarak çalışır.
8. Yorum/sürüm/screenshot silme uçları admin Basic bekler; frontend `getAdminAuthHeader()` kullanır.
9. `reviews` tarihleri `trDate()` ile yerel biçimde ("15 Kasım 2026") yazılır; başka yerlerde
   UTC ISO kullanılır. Karıştırmayın.
10. `fireeye.apk`, `firelogo.jpg`, `fire.mp4`, PNG'ler binary artifact'tir; metin olarak düzenlemeyin.
11. APK yükleme `POST /admin/release/upload` → Worker → Wasmer S3 (SigV4) zincirinden geçer.
    `WASMER_S3_*` secret'ları tanımlı değilse uç 502 döner; indirme yine de repodaki
    `fireeye.apk` yedeği üzerinden çalışır. Mount yolu `/public/downloads` varsayımıdır —
    Wasmer paketinin statik kökü farklıysa `app.yaml` içindeki `mount` değerini güncelleyin.
    Volume adı/mount değişimi volume içeriğini siler.

---

## 13. Katkı kuralları (özet)

- Mevcut mimariyi koruyun: framework, bundler, router veya CSS kütüphanesi eklemeyin.
- Türkçe kullanıcı metinleri ve Türkçe kod yorumları mevcut üslupla yazılır.
- Mevcut uçların yanıt şekillerini (`success`, `message`, `device`, `devices`, `token`…) bozmayın;
  Android uygulaması ve site aynı API'yi paylaşır.
- Sırları, token'ları ve kişisel verileri loglamayın; mevcut `console.log` çağrılarını genişletmeyin.
- Büyük değişikliklerde önce etkilenen dosyaları okuyun; `fireeye/index.html` ve
  `cloudflare-worker/src/index.js` tek dosyada yoğunlaşmıştır, çakışma riski yüksektir.
