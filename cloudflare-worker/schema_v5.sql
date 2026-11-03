-- TechnoStudios / FireEye - v5: kodla cihaz bulma
-- Çalıştırma: npx wrangler d1 execute fireeye_db --remote --file=./schema_v5.sql
--
-- Cihazın LCD ekranındaki eşleştirme kodu (SHA-256 hash'i) cihaz kaydına yazılır.
-- Böylece uygulamada cihaz listesi gösterilmeden, kod girilerek cihaz bulunabilir.
-- Kod tek başına yetki vermez; yalnızca kullanıcının kendi cihazları arasında arama yapılır.

ALTER TABLE devices ADD COLUMN pairing_code_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_devices_user_code ON devices(user_id, pairing_code_hash);
