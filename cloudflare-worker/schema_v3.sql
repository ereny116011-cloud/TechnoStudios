-- TechnoStudios / FireEye — v3 şema güncellemesi
-- Çalıştırma:  npx wrangler d1 execute fireeye_db --remote --file=./schema_v3.sql
--
-- NOT: ALTER TABLE satırları kolon zaten varsa "duplicate column name" hatası verir;
-- bu normaldir, o hatayı göz ardı edip kalan satırların çalıştığından emin olun.

-- Hesap bazlı MQTT bağlantı bilgileri (firmware'deki MQTT_BROKER / MQTT_USER / MQTT_PASS)
ALTER TABLE users ADD COLUMN mqtt_host TEXT;
ALTER TABLE users ADD COLUMN mqtt_user TEXT;
ALTER TABLE users ADD COLUMN mqtt_pass TEXT;
