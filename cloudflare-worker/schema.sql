CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL,
    rating INTEGER NOT NULL,
    text TEXT NOT NULL,
    review_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS changelogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    changelog_date TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_data TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
    caption TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Uygulama/site hesapları: Android uygulamasının kullandığı alan adlarıyla birebir eşleşir.
-- Kayıt formu sitede gösterilmez; hesaplar admin panelinden (adminCreateUser) oluşturulur.
-- is_no_data = 1: kullanıcı geçici şifreyle giriş yaptı, e-posta/şifresini değiştirmesi gerekiyor.
-- reset_requested = 1: kullanıcı "şifremi unuttum" dedi, admin panelinde bekliyor.
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    full_name TEXT,
    mqtt_topic TEXT,
    is_no_data INTEGER NOT NULL DEFAULT 0,
    reset_requested INTEGER NOT NULL DEFAULT 0,
    reset_requested_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- NOT: Eğer "users" tablosu daha önce oluşturulduysa (yukarıdaki CREATE TABLE IF NOT EXISTS
-- çalışmadıysa), reset_requested / reset_requested_at kolonlarını eklemek için AŞAĞIDAKİ İKİ
-- SATIRI BİR KEZ elle çalıştır (zaten varsa "duplicate column" hatası alırsın, göz ardı et):
-- ALTER TABLE users ADD COLUMN reset_requested INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE users ADD COLUMN reset_requested_at TEXT;

-- Cihazdan (ESP32/Arduino) gelen en son veri ve gönderilecek komut.
-- device_key = kullanıcının hesabındaki mqtt_topic değeri (artık MQTT değil, sadece cihaz kimliği olarak kullanılıyor).
CREATE TABLE IF NOT EXISTS device_readings (
    device_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS device_commands (
    device_key TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Admin panelinden yüklenen APK sürüm dosyaları. Dosyanın kendisi GitHub Releases'te
-- (repo: ereny116011-cloud/TechnoStudios, tag: APK) saklanır, burada sadece meta veri
-- ve indirme linki tutulur. is_active = 1 olan tek satır "güncel sürüm"dür.
CREATE TABLE IF NOT EXISTS releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    file_name TEXT NOT NULL,
    download_url TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Şifre sıfırlama bağlantıları: /forgot-password bir tane oluşturur (e-postayla gönderilir),
-- /reset-password kullanıcı yeni şifresini belirlediğinde bunu tüketir (used = 1 yapar).
-- token'ın kendisi değil, SHA-256 hash'i saklanır — DB sızsa bile linkler kullanılamaz.
CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO changelogs (version, changelog_date, text)
SELECT 'v1.0', '26 Mart 2026', '- FireEye kararlı sürümü yayınlandı.' || char(10) || '- Anlık duman/sıcaklık takibi aktif edildi.'
WHERE NOT EXISTS (SELECT 1 FROM changelogs);
