# 📋 GÖREVLER — TechnoWeb / FireEye / TechnoSupport

> Bu dosya, **sonraki aşamada tamamlanacak** işleri listeler. Tamamlanan işler
> `✅` ile işaretlenir ve altına kısa not düşülür.

---

## ✅ Tamamlananlar

- [x] **Worker birleştirme** — TechnoSupport uçları FireEye worker'ına taşındı
- [x] **Resend → AgentMail geçişi** — `AGENTMAIL_API_KEY` + `AGENTMAIL_INBOX_ID` eklendi
- [x] **SESSION_SECRET** eklendi (giriş/kayıt/2FA için zorunlu)
- [x] **KILO_API** eklendi (AI sohbet)
- [x] **Ölü kod temizliği** — kazara oluşan kök `wrangler.jsonc` silindi (worker'ı static asset'e çeviriyordu)
- [x] **OAuth istemci kimlikleri (client ID)** worker'a eklendi:
      `GOOGLE_CLIENT_ID`, `MICROSOFT_CLIENT_ID`, `GITHUB_CLIENT_ID`
- [x] **Web sitesi OAuth butonları** — Google / Microsoft / GitHub + `oauth/callback.html`
- [x] **Android OAuth** — Google (Sign-In), Microsoft, GitHub eklendi; APK derlendi
- [x] **Auth uç formatları worker ile eşitlendi** (`/verify-email`, `/reset-password`,
      `/resend-verification`, `/user/update-credentials`)

---

## 🔴 YÜKSEK ÖNCELİK — OAuth girişlerini tamamla

Bu iki **gizli değer** olmadan Microsoft ve GitHub ile giriş **çalışmaz**
(önceki kurulumda Resend'den alınan anahtarlar `AGENTMAIL` geçişinde silindi).

### [ ] 1. `MICROSOFT_CLIENT_SECRET`

**Nereden:**
[Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations**
→ `TechnoStudios` uygulaması → **Certificates & secrets** → **New client secret**
→ *Value* değerini kopyalayın (bir kez görünür).

**Eklenmesi:**
```powershell
cd C:\Users\Eren\Documents\GitHub\TechnoStudios\cloudflare-worker
$env:CLOUDFLARE_ACCOUNT_ID="0280e2748c8ba03638896e72227c2ae9"
npx wrangler secret put MICROSOFT_CLIENT_SECRET --name fireeye-api
```

**Redirect URI kontrolü:** `https://support.technoweb.win/oauth/callback`
**Web client ID:** `37f732b9-1256-41ac-ad50-d432674cf06d` (zaten worker'da)

---

### [ ] 2. `GITHUB_CLIENT_SECRET`

**Nereden:**
[github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps**
→ `TechnoSupport` uygulaması → **Generate a new client secret** → kopyalayın.

**Eklenmesi:**
```powershell
npx wrangler secret put GITHUB_CLIENT_SECRET --name fireeye-api
```

**Redirect URI:** `https://support.technoweb.win/oauth/callback`
**Web client ID:** `Ov23lihLLn5WcjBIuG4Y` (zaten worker'da)

---

### [ ] 3. Android için ayrı Google Client ID

Android uygulaması Google **Sign-In** kullandığı için ayrı bir **Android** tipi
OAuth client ID gerekir (Web tipiyle aynı client ID çalışmaz).

**Nereden:**
[Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** →
**Credentials** → **Create Credentials** → **OAuth client ID**
→ Application type: **Android**
→ Package name: `com.techno.fireeye`
→ SHA-1: `keytool -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android`

**Nereye yazılacak:**
`C:\Users\Eren\Desktop\fireye\app\src\main\res\values\strings.xml`
```xml
<string name="google_client_id">BURAYA-ANDROID-CLIENT-ID</string>
```

**Worker'a da eklenmeli** (virgülle birden fazla ID kabul edilir):
```powershell
npx wrangler secret put GOOGLE_CLIENT_ID --name fireeye-api
# Değer: <web-client-id>,<android-client-id>
```

---

### [ ] 4. Android APK'yi yeniden derle ve yükle

```powershell
cd C:\Users\Eren\Desktop\fireye
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
gradlew.bat :app:assembleDebug --no-configuration-cache
```
Çıktı: `app\build\outputs\apk\debug\app-debug.apk`
Telefona yükleme: `adb install -r app\build\outputs\apk\debug\app-debug.apk`

---

## 🟡 ORTA ÖNCELİK

### [ ] 5. `WASMER_S3_*` secret'ları (admin panelinden APK yükleme)

```powershell
wasmer app volume credentials --app technosupport
npx wrangler secret put WASMER_S3_ENDPOINT --name fireeye-api
npx wrangler secret put WASMER_S3_ACCESS_KEY --name fireeye-api
npx wrangler secret put WASMER_S3_SECRET_KEY --name fireeye-api
```
> Eklenmezse mevcut APK çalışmaya devam eder; sadece panelden **yeni** APK yüklenemez.

### [ ] 6. OAuth uçlarının canlı testi

- [ ] Google ile giriş (web)
- [ ] Microsoft ile giriş (web)
- [ ] GitHub ile giriş (web)
- [ ] Google ile giriş (Android)
- [ ] OAuth ile yeni kullanıcı otomatik oluşuyor mu? (D1 `users` tablosu kontrolü)

### [ ] 7. 2FA e-posta teslimatı canlı doğrulaması

Gerçek bir kullanıcıyla (`technostudios11@gmail.com`) giriş denemesi yapılıp
2FA kodunun AgentMail üzerinden geldiği doğrulanmalı.
> Not: AgentMail, bounce alan adresleri otomatik engelliyor. Test için **gerçek**
> bir gelen kutusu kullanılmalı.

---

## 🔵 DÜŞÜK ÖNCELİK

### [ ] 8. `technosupport-api` worker'ını silme (artık gereksiz)

```powershell
npx wrangler delete --name technosupport-api
```
> Zaten silinmiş olabilir; `npx wrangler deployments list --name technosupport-api`
> kontrolüyle doğrulanabilir.

### [ ] 9. Google/Microsoft/GitHub OAuth — mobil uygulamada tam akış

Microsoft ve GitHub için Android tarafında token/code elle girilmesi gerekiyor.
Tarayıcı tabanlı (Custom Tabs) akışa geçmek için ek iş gerekir.

---

## 📌 Dikkat Edilecekler

- **Kök dizinde `wrangler.jsonc` oluşturmayın.** Repo kökünü static asset olarak
  yükler, worker script'ini devre dışı bırakır (CORS + e-posta bozulur) ve
  secret'ları siler. Doğru config: `cloudflare-worker/wrangler.toml`.
- Deploy her zaman: `cd cloudflare-worker && npx wrangler deploy --name fireeye-api`
- `app.js` değiştiğinde `index.html` içindeki `app.js?v=YYYYMMDD` sürümünü güncelleyin.
- Secret'lar **asla** repoya yazılmaz.
