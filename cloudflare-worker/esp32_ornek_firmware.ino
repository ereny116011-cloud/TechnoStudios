/*
  FireEye — Deneyap Kart 1A Örnek Firmware (HTTP)
  ------------------------------------------------
  MQTT / HiveMQ KULLANILMAZ. Kart, Cloudflare Worker'a HTTPS ile bağlanır:
    - 3 saniyede bir  POST /device/report   → sensör verisini gönderir
    - 3 saniyede bir  GET  /device/command  → panelden gelen komutu çeker

  Kimlik doğrulama: her cihazın kendi token'ı (X-Device-Token başlığı).
  Token panelde "Cihaz Ekle" veya "Token Yenile" ile üretilir ve YALNIZCA BİR KEZ
  gösterilir. Bu dosyadaki DEVICE_TOKEN alanına kopyala.

  Gerekli kütüphaneler (Arduino IDE > Library Manager):
    - WiFi.h, HTTPClient.h, WiFiClientSecure.h  (ESP32 çekirdeğinde hazır)
    - DHT sensor library (Adafruit) + Adafruit Unified Sensor
      (Arduino IDE > Library Manager > "DHT sensor library" by Adafruit)

  Deneyap Kart 1A (ESP32-WROVER-E) varsayılan bağlantılar:
    - DHT11 / DHT22  veri  → D4
    - MQ-2 / MQ-9    analog→ A0   (A0-A3 sadece giriş, 0-3.3 V)
    - Buzzer         (+)   → D5   (VCC/3V3 ve GND'yi de bağla)

  NOT: Pinler örnektir. Kartının üzerindeki etiketlere göre aşağıdaki
  #define satırlarını değiştir. MQ-2 çıkışı 5 V ise mutlaka gerilim bölücü
  (ör. 10k + 20k) kullan, aksi halde kart zarar görür.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <DHT.h>

// ---------------------------------------------------------------------------
// 1) KENDİ BİLGİLERİN
// ---------------------------------------------------------------------------
const char* WIFI_SSID     = "WIFI_ADIN";
const char* WIFI_PASSWORD = "WIFI_SIFREN";

const char* WORKER_BASE   = "https://fireeye-api.ereny116011.workers.dev";

// Panelde cihaz oluşturunca gösterilen "Cihaz Token'ı" (fe_ ile başlar)
const char* DEVICE_TOKEN  = "fe_BURAYA_TOKEN";

// Panelde görünen "Cihaz Anahtarı" (örn. salon-sensoru-3f9a1c)
const char* DEVICE_KEY    = "BURAYA_CIHAZ_ANAHTARI";

// ---------------------------------------------------------------------------
// 2) PİNLER VE AYARLAR
// ---------------------------------------------------------------------------
#define DHT_PIN            D4      // DHT veri bacağı
#define DHT_TYPE           DHT22   // DHT11 kullanıyorsan DHT11 yaz
#define GAS_PIN            A0      // MQ-2 / MQ-9 analog çıkışı
#define BUZZER_PIN         D5      // Buzzer (+)

#define REPORT_INTERVAL_MS   3000UL   // veri gönderme aralığı
#define COMMAND_INTERVAL_MS  3000UL   // komut kontrol aralığı
#define DEFAULT_GAS_THRESHOLD 2000    // temiz havada ~200-400; kalibrasyonla değiştir
#define MUTE_MS              60000UL  // "sustur" sonrası sessiz kalma süresi
#define WIFI_RETRY_MS        10000UL

// ---------------------------------------------------------------------------
// 3) DURUM
// ---------------------------------------------------------------------------
DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastReportMs = 0;
unsigned long lastCommandMs = 0;
unsigned long lastWiFiTryMs = 0;
unsigned long mutedUntilMs = 0;

int  gasThreshold = DEFAULT_GAS_THRESHOLD;
int  lastGas = 0;
float lastTemp = NAN;
float lastHum = NAN;
bool alarmActive = false;
bool dhtFault = false;
bool buzzerOn = false;

// Ölçümler arasında en az DHT_MIN_MS geçmeli (DHT11: 1 sn, DHT22: 2 sn)
unsigned long lastDhtReadMs = 0;
const unsigned long DHT_MIN_MS = 2100UL;

// ---------------------------------------------------------------------------
// 4) YARDIMCILAR
// ---------------------------------------------------------------------------
void buzzer(bool on) {
    if (on == buzzerOn) return;
    buzzerOn = on;
    if (on) tone(BUZZER_PIN, 2200);
    else    noTone(BUZZER_PIN);
}

void beepTest() {
    for (int i = 0; i < 3; i++) {
        tone(BUZZER_PIN, 2400);
        delay(180);
        noTone(BUZZER_PIN);
        delay(180);
    }
    buzzerOn = false;
}

void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;
    if (millis() - lastWiFiTryMs < WIFI_RETRY_MS && lastWiFiTryMs != 0) return;
    lastWiFiTryMs = millis();

    Serial.print("WiFi'ye bağlanılıyor: ");
    Serial.println(WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 15000UL) {
        delay(300);
        Serial.print('.');
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
        Serial.print("Bağlandı, IP: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("WiFi bağlantısı kurulamadı, tekrar denenecek.");
    }
}

// Sayıyı JSON/telemetri için biçimler (virgül değil nokta).
String num(float value, int decimals) {
    if (isnan(value) || isinf(value)) return String("0");
    return String(value, decimals);
}

// Sunucuya sensör verisini gönderir.
void reportTelemetry() {
    if (WiFi.status() != WL_CONNECTED) return;

    String durum;
    if (alarmActive) {
        durum = "ALARM";
    } else if (mutedUntilMs && millis() < mutedUntilMs) {
        durum = "SUSTURULDU";
    } else {
        durum = "NORMAL";
    }

    String payload = "TELEMETRI;SICAKLIK=" + num(lastTemp, 1) +
                     ";NEM=" + num(lastHum, 1) +
                     ";GAZ=" + String(lastGas) +
                     ";ESIK=" + String(gasThreshold) +
                     ";DURUM=" + durum +
                     ";ISINIYOR=" + String(dhtFault ? 1 : 0);

    // JSON'u elle kuruyoruz: ek kütüphane gerekmez, payload tırnak içermez.
    String body = "{\"device_key\":\"" + String(DEVICE_KEY) + "\",\"payload\":\"" + payload + "\"}";

    WiFiClientSecure client;
    client.setInsecure();   // Sertifika doğrulaması yapılmaz (örnek amaçlı)

    HTTPClient http;
    http.setTimeout(8000);
    http.begin(client, String(WORKER_BASE) + "/device/report");
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", DEVICE_TOKEN);

    int code = http.POST(body);
    if (code == 200) {
        Serial.print("[rapor] ok  ");
        Serial.println(payload);
    } else {
        Serial.print("[rapor] HTTP ");
        Serial.print(code);
        Serial.print(" ");
        Serial.println(http.getString());
    }
    http.end();
}

// Panelden kuyruğa bırakılan komutu çeker ve uygular.
void pollCommand() {
    if (WiFi.status() != WL_CONNECTED) return;

    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient http;
    http.setTimeout(8000);
    String url = String(WORKER_BASE) + "/device/command?device_key=" + String(DEVICE_KEY);
    http.begin(client, url);
    http.addHeader("X-Device-Token", DEVICE_TOKEN);

    int code = http.GET();
    String body = http.getString();
    http.end();

    if (code != 200) {
        Serial.print("[komut] HTTP ");
        Serial.println(code);
        return;
    }

    int idx = body.indexOf("\"command\":\"");
    if (idx < 0) return;   // "command":null → komut yok

    int start = idx + 11;
    int end = body.indexOf('"', start);
    if (end < 0) return;
    String cmd = body.substring(start, end);
    cmd.trim();
    if (!cmd.length()) return;

    Serial.print("[komut] ");
    Serial.println(cmd);

    if (cmd == "kapat") {
        // Alarmı sustur: 60 saniye sessiz, süre bitince gaz hâlâ yüksekse tekrar öter.
        mutedUntilMs = millis() + MUTE_MS;
        alarmActive = false;
        buzzer(false);
        Serial.println("Alarm susturuldu.");
    } else if (cmd == "durum") {
        reportTelemetry();
    } else if (cmd == "buzzer_test") {
        beepTest();
    } else if (cmd.startsWith("esik:")) {
        int value = cmd.substring(5).toInt();
        if (value >= 1 && value <= 4095) {
            gasThreshold = value;
            Serial.print("Yeni eşik: ");
            Serial.println(gasThreshold);
        }
    }
}

void readSensors() {
    lastGas = analogRead(GAS_PIN);

    if (millis() - lastDhtReadMs >= DHT_MIN_MS) {
        lastDhtReadMs = millis();
        float t = dht.readTemperature();
        float h = dht.readHumidity();
        if (!isnan(t) && !isnan(h)) {
            lastTemp = t;
            lastHum = h;
            dhtFault = false;
        } else {
            dhtFault = true;   // sensör ısınıyor veya bağlı değil
        }
    }
}

void updateAlarm() {
    bool muted = mutedUntilMs && millis() < mutedUntilMs;

    if (lastGas >= gasThreshold) {
        if (!muted) {
            alarmActive = true;
            buzzer(true);
        } else {
            alarmActive = false;
            buzzer(false);
        }
    } else {
        alarmActive = false;
        mutedUntilMs = 0;
        buzzer(false);
    }
}

// ---------------------------------------------------------------------------
// 5) SETUP / LOOP
// ---------------------------------------------------------------------------
void setup() {
    Serial.begin(115200);
    delay(300);
    Serial.println();
    Serial.println("FireEye — Deneyap Kart 1A (HTTP) basliyor");

    pinMode(GAS_PIN, INPUT);
    pinMode(BUZZER_PIN, OUTPUT);
    noTone(BUZZER_PIN);

    dht.begin();

    connectWiFi();
}

void loop() {
    if (WiFi.status() != WL_CONNECTED) {
        connectWiFi();
    }

    readSensors();
    updateAlarm();

    unsigned long now = millis();

    if (now - lastReportMs >= REPORT_INTERVAL_MS || lastReportMs == 0) {
        lastReportMs = now;
        reportTelemetry();
    }

    if (now - lastCommandMs >= COMMAND_INTERVAL_MS || lastCommandMs == 0) {
        lastCommandMs = now;
        pollCommand();
    }

    delay(50);
}
