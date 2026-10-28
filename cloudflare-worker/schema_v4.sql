-- TechnoStudios / FireEye - v4: HTTP cihaz yönetimi
-- Çalıştırma: npx wrangler d1 execute fireeye_db --remote --file=./schema_v4.sql
--
-- Not: ALTER/CREATE ifadeleri tekrar çalıştırılabilir; "duplicate column" hatası
-- normaldir ve kalan ifadelerin çalışmasını engellemez.

-- Her kullanıcı birden fazla cihaz ekleyebilir.
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    device_key TEXT NOT NULL UNIQUE,
    token_hash TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token_hash);

-- Grafik için 24 saatlik telemetri geçmişi.
CREATE TABLE IF NOT EXISTS device_reading_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_key TEXT NOT NULL,
    sicaklik REAL,
    nem REAL,
    gaz INTEGER,
    esik INTEGER,
    durum TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_history_key_time ON device_reading_history(device_key, created_at);

-- Mevcut MQTT hesaplarını cihaz olarak taşı (token'ları panelden üretilecek).
INSERT OR IGNORE INTO devices (user_id, name, device_key, token_hash, created_at)
SELECT id,
       COALESCE(NULLIF(TRIM(full_name), ''), 'Cihaz 1'),
       TRIM(mqtt_topic),
       NULL,
       datetime('now')
FROM users
WHERE mqtt_topic IS NOT NULL AND TRIM(mqtt_topic) <> '';
