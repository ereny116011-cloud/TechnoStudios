/*
  FireEye - ESP32 Örnek Firmware
  ------------------------------
  MQTT/HiveMQ KULLANMIYOR. Doğrudan kendi Worker'ımıza (Cloudflare) HTTP ile veri
  gönderiyor ve komut çekiyor.

  Gerekli kütüphaneler (Arduino IDE > Library Manager):
    - WiFi.h (ESP32 çekirdek kütüphanesi, ekstra kurulum gerekmez)
    - HTTPClient.h (ESP32 çekirdek kütüphanesi, ekstra kurulum gerekmez)
    - ArduinoJson (kütüphane yöneticisinden kur: "ArduinoJson" by Benoit Blanchon)
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// --- Kendi bilgilerinle doldur ---
const char* WIFI_SSID     = "WIFI_ADIN";
const char* WIFI_PASSWORD = "WIFI_SIFREN";

const char* WORKER_BASE   = "https://fireeye-api.ereny116011.workers.dev";
const char* DEVICE_SECRET = "fireeye-device-2026";   // wrangler.toml'daki DEVICE_SECRET ile AYNI olmalı
const char* DEVICE_KEY    = "fireeye-musteri-01";     // admin panelinde bu hesaba girdiğin "Cihaz Kimliği" ile AYNI olmalı

unsigned long lastReportMs = 0;
unsigned long lastCommandCheckMs = 0;
const unsigned long REPORT_INTERVAL_MS = 5000;   // 5 saniyede bir veri gönder
const unsigned long COMMAND_INTERVAL_MS = 3000;  // 3 saniyede bir komut kontrol et

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi'ye bağlanılıyor");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println("\nBağlandı: " + WiFi.localIP().toString());
}

void loop() {
  unsigned long now = millis();

  if (now - lastReportMs >= REPORT_INTERVAL_MS) {
    lastReportMs = now;
    sendReading();
  }

  if (now - lastCommandCheckMs >= COMMAND_INTERVAL_MS) {
    lastCommandCheckMs = now;
    checkCommand();
  }
}

// Sensörlerden okuduğun gerçek değerleri buraya koy (örnek: sabit değerler).
void sendReading() {
  float sicaklik = 24.5;   // örn: dht.readTemperature();
  float nem      = 51.0;   // örn: dht.readHumidity();
  String durum   = "NORMAL"; // "NORMAL" veya "ALARM"

  String payload = "SICAKLIK:" + String(sicaklik, 1) +
                    ", NEM:" + String(nem, 1) +
                    ", DURUM:" + durum;

  HTTPClient http;
  http.begin(String(WORKER_BASE) + "/device/report");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Secret", DEVICE_SECRET);

  StaticJsonDocument<256> doc;
  doc["device_key"] = DEVICE_KEY;
  doc["payload"] = payload;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  Serial.println("Veri gönderildi, HTTP kod: " + String(code));
  http.end();
}

// Site/uygulamadan gönderilen bekleyen komutu (örn. "kapat") kontrol eder.
void checkCommand() {
  HTTPClient http;
  String url = String(WORKER_BASE) + "/device/command?device_key=" + DEVICE_KEY;
  http.begin(url);
  http.addHeader("X-Device-Secret", DEVICE_SECRET);

  int code = http.GET();
  if (code == 200) {
    String response = http.getString();
    StaticJsonDocument<256> doc;
    deserializeJson(doc, response);

    if (!doc["command"].isNull()) {
      String command = doc["command"].as<String>();
      Serial.println("Komut alındı: " + command);

      if (command == "kapat") {
        // BURAYA alarmı susturma kodunu yaz (örn. buzzer'ı kapat).
      }
    }
  }
  http.end();
}
