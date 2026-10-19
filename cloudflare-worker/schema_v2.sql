-- TechnoStudios / FireEye — v2 şema güncellemesi
-- Çalıştırma:  npx wrangler d1 execute fireeye_db --remote --file=./schema_v2.sql
--
-- NOT: ALTER TABLE satırları kolon zaten varsa "duplicate column name" hatası verir;
-- bu normaldir, o hatayı göz ardı edip kalan satırların çalıştığından emin olun.

-- 1) E-posta doğrulama kolonları (mevcut kullanıcılar doğrulanmış sayılır: DEFAULT 1)
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN verify_token_hash TEXT;
ALTER TABLE users ADD COLUMN verify_expires_at TEXT;

-- 2) İletişim formu kayıtları
CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 3) Basit oran sınırlama (rate limit) sayaçları
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL
);
