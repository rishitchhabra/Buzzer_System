#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "config.h"

// Shared TLS client for the HTTPS portal connection.
// setInsecure() encrypts but does not verify the certificate; to verify, call
// netClient.setCACert(ROOT_CA_PEM) in setup instead (e.g. the ISRG Root X1 cert).
WiFiClientSecure netClient;

// ------------------------------------------------------------------
//  Buzzer ESP32 device
//  - connects to WiFi (station mode)
//  - polls the portal for configuration + commands
//  - captures button presses with GPIO interrupts (precise timing)
//  - posts events / results back to the portal API
// ------------------------------------------------------------------

#define DEBOUNCE_US 30000UL
#define WIFI_RETRY_MS 5000
#define EVENT_QUEUE_MAX 48

enum Mode { MODE_IDLE, MODE_TEST, MODE_SCAN };

struct Buzzer {
  int id;
  String name;
  int pin;
  volatile unsigned long isrEdgeUs;
  volatile unsigned long lastIsrUs;
  volatile bool pending;
  bool online;       // test result
  int order;         // scan order (0 = not pressed)
  unsigned long pressUs;
  bool attached;
};

Buzzer buzzers[MAX_BUZZERS];
int buzzerCount = 0;

Mode mode = MODE_IDLE;
bool scanActive = false;
int scanCount = 0;
unsigned long scanStartUs = 0;
unsigned long lastPressMs = 0;
unsigned long scanSettleMs = SCAN_SETTLE_MS;

int configVersion = -1;
String deviceId;

bool portalReachable = false;
unsigned long lastSyncMs = 0;
unsigned long lastWifiAttempt = 0;
bool rapidMode = false;   // continuous buzzer capture (no auto-settle)

Preferences prefs;

// --------------------------- event queue ---------------------------
struct Event { String json; };
Event eventQueue[EVENT_QUEUE_MAX];
int eqHead = 0, eqTail = 0, eqCount = 0;

// --------------------------- helpers ---------------------------
const char* modeStr() {
  switch (mode) {
    case MODE_TEST: return "test";
    case MODE_SCAN: return "scan";
    default:        return "idle";
  }
}

String jsonEscape(const String& in) {
  String out;
  out.reserve(in.length() + 8);
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n";  break;
      case '\r': out += "\\r";  break;
      case '\t': out += "\\t";  break;
      default:
        if ((unsigned char)c >= 0x20) out += c;
    }
  }
  return out;
}

void queueEvent(const String& type, const String& payload) {
  if (eqCount >= EVENT_QUEUE_MAX) return;   // drop when full
  String j = "{\"deviceId\":\"" + deviceId + "\",\"type\":\"" + type +
             "\",\"payload\":" + payload + "}";
  eventQueue[eqTail].json = j;
  eqTail = (eqTail + 1) % EVENT_QUEUE_MAX;
  eqCount++;
}

// --------------------------- interrupts ---------------------------
void IRAM_ATTR buzzerISR(void* arg) {
  Buzzer* b = (Buzzer*)arg;
  unsigned long now = micros();
  if (b->lastIsrUs != 0 && (now - b->lastIsrUs) < DEBOUNCE_US) return;
  b->lastIsrUs = now;
  b->isrEdgeUs = now;
  b->pending = true;
}

// --------------------------- state resets ---------------------------
void resetTest() {
  for (int i = 0; i < buzzerCount; i++) buzzers[i].online = false;
}

void resetScan() {
  scanCount = 0;
  for (int i = 0; i < buzzerCount; i++) {
    buzzers[i].order = 0;
    buzzers[i].pressUs = 0;
  }
}

// --------------------------- config apply ---------------------------
void detachAll() {
  for (int i = 0; i < buzzerCount; i++) {
    if (buzzers[i].attached) {
      detachInterrupt(digitalPinToInterrupt(buzzers[i].pin));
      buzzers[i].attached = false;
    }
  }
}

void applyConfig(JsonArray arr) {
  detachAll();
  buzzerCount = 0;
  for (JsonObject b : arr) {
    if (buzzerCount >= MAX_BUZZERS) break;
    int pin = b["pin"] | -1;
    if (pin < 0 || pin > 39 || pin == LED_PIN) continue;
    Buzzer& bz = buzzers[buzzerCount];
    bz.id = b["id"] | 0;
    bz.name = b["name"].as<String>();
    bz.pin = pin;
    bz.online = false;
    bz.order = 0;
    bz.pressUs = 0;
    bz.pending = false;
    bz.lastIsrUs = 0;
    bz.isrEdgeUs = 0;
    pinMode(pin, INPUT_PULLUP);
    attachInterruptArg(digitalPinToInterrupt(pin), buzzerISR, &bz, FALLING);
    bz.attached = true;
    buzzerCount++;
  }
}

void saveConfigCache() {
  JsonDocument doc;
  doc["configVersion"] = configVersion;
  JsonArray arr = doc["buzzers"].to<JsonArray>();
  for (int i = 0; i < buzzerCount; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["id"] = buzzers[i].id;
    o["name"] = buzzers[i].name;
    o["pin"] = buzzers[i].pin;
  }
  String s;
  serializeJson(doc, s);
  prefs.putString("cfg", s);
}

void loadConfigCache() {
  String s = prefs.getString("cfg", "");
  if (s.length() == 0) { configVersion = -1; return; }
  JsonDocument doc;
  if (deserializeJson(doc, s)) { configVersion = -1; return; }
  configVersion = doc["configVersion"] | -1;
  applyConfig(doc["buzzers"].as<JsonArray>());
}

// --------------------------- outgoing posts ---------------------------
bool httpPostJson(const String& path, const String& body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  http.setReuse(true);
  String url = String(PORTAL_BASE) + path;
  if (!http.begin(netClient, url)) return false;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();
  return code > 0 && code < 300;
}

void postAck(int commandId) {
  httpPostJson("/api/esp/ack", "{\"deviceId\":\"" + deviceId +
                               "\",\"commandId\":" + String(commandId) + "}");
}

void drainEvents() {
  if (eqCount == 0 || WiFi.status() != WL_CONNECTED) return;
  if (httpPostJson("/api/esp/event", eventQueue[eqHead].json)) {
    eqHead = (eqHead + 1) % EVENT_QUEUE_MAX;
    eqCount--;
    portalReachable = true;
  } else {
    portalReachable = false;
  }
}

// --------------------------- result senders ---------------------------
void sendTestResult() {
  String arr = "[";
  for (int i = 0; i < buzzerCount; i++) {
    if (i) arr += ",";
    arr += "{\"id\":" + String(buzzers[i].id) +
           ",\"online\":" + String(buzzers[i].online ? "true" : "false") + "}";
  }
  arr += "]";
  queueEvent("test_result", "{\"results\":" + arr + "}");
}

void finalizeScan() {
  if (!scanActive) return;
  String arr = "[";
  bool first = true;
  for (int o = 1; o <= scanCount; o++) {
    for (int i = 0; i < buzzerCount; i++) {
      if (buzzers[i].order == o) {
        if (!first) arr += ",";
        first = false;
        arr += "{\"id\":" + String(buzzers[i].id) +
               ",\"name\":\"" + jsonEscape(buzzers[i].name) + "\"" +
               ",\"order\":" + String(o) +
               ",\"timeMs\":" + String(buzzers[i].pressUs / 1000.0, 2) + "}";
        break;
      }
    }
  }
  arr += "]";
  queueEvent("scan_result", "{\"results\":" + arr + "}");
  scanActive = false;
}

void sendPong() {
  String p = "{\"rssi\":" + String(WiFi.RSSI()) +
             ",\"ip\":\"" + WiFi.localIP().toString() + "\"" +
             ",\"mode\":\"" + String(modeStr()) + "\"" +
             ",\"uptimeS\":" + String(millis() / 1000) + "}";
  queueEvent("pong", p);
}

// --------------------------- press handling ---------------------------
void handlePress(int i, unsigned long edgeUs) {
  Buzzer& b = buzzers[i];
  if (mode == MODE_TEST) {
    if (!b.online) {
      b.online = true;
      queueEvent("test_update", "{\"id\":" + String(b.id) + ",\"online\":true}");
    }
  } else if (mode == MODE_SCAN && scanActive) {
    if (b.order == 0) {
      scanCount++;
      b.order = scanCount;
      unsigned long t = (edgeUs > scanStartUs) ? (edgeUs - scanStartUs) : 0;
      b.pressUs = t;
      lastPressMs = millis();
      Serial.printf("[buzz] press id=%d order=%d %.1f ms\n", b.id, b.order, t / 1000.0);
      queueEvent("live_press",
                 "{\"id\":" + String(b.id) +
                 ",\"name\":\"" + jsonEscape(b.name) + "\"" +
                 ",\"order\":" + String(b.order) +
                 ",\"timeMs\":" + String(t / 1000.0, 2) + "}");
      if (scanCount >= buzzerCount) finalizeScan();
    }
  }
}

void drainPendingPresses() {
  while (true) {
    int best = -1;
    unsigned long bestUs = 0;
    noInterrupts();
    for (int i = 0; i < buzzerCount; i++) {
      if (buzzers[i].pending) {
        if (best < 0 || (long)(buzzers[i].isrEdgeUs - bestUs) < 0) {
          best = i;
          bestUs = buzzers[i].isrEdgeUs;
        }
      }
    }
    if (best >= 0) buzzers[best].pending = false;
    interrupts();
    if (best < 0) break;
    handlePress(best, bestUs);
  }
}

// --------------------------- commands ---------------------------
void handleCommand(const String& t) {
  if (t == "test_start") {
    mode = MODE_TEST;
    scanActive = false;
    resetTest();
  } else if (t == "test_stop") {
    if (mode == MODE_TEST) sendTestResult();
    mode = MODE_IDLE;
  } else if (t == "scan_start") {
    mode = MODE_SCAN;
    resetScan();
    scanActive = true;
    scanStartUs = micros();
    lastPressMs = millis();
  } else if (t == "scan_reset") {
    resetScan();
    scanActive = false;
    if (mode == MODE_SCAN) mode = MODE_IDLE;
  } else if (t == "rapid_start") {
    mode = MODE_SCAN;
    resetScan();
    scanActive = true;
    scanStartUs = micros();
    rapidMode = true;
    Serial.printf("[buzz] rapid_start - armed %d buzzer(s)\n", buzzerCount);
  } else if (t == "rapid_reset") {
    resetScan();
    scanActive = false;
    rapidMode = false;
    if (mode == MODE_SCAN) mode = MODE_IDLE;
    Serial.println("[buzz] rapid_reset - disarmed");
  } else if (t == "ping") {
    sendPong();
  }
}

// --------------------------- diagnostics ---------------------------
void printWifiInfo() {
  Serial.printf("[wifi] status=%d ip=%s gw=%s mask=%s rssi=%d\n",
                WiFi.status(), WiFi.localIP().toString().c_str(),
                WiFi.gatewayIP().toString().c_str(),
                WiFi.subnetMask().toString().c_str(), WiFi.RSSI());
}

void probePortal() {
  HTTPClient http;
  String url = String(PORTAL_BASE) + "/api/health";
  Serial.print("[portal] probing ");
  Serial.println(url);
  http.setConnectTimeout(6000);
  http.setTimeout(6000);
  http.setReuse(true);
  if (!http.begin(netClient, url)) {
    Serial.println("[portal] FAILED: could not parse/begin URL");
    return;
  }
  int code = http.GET();
  if (code > 0) {
    Serial.printf("[portal] HTTP %d: %s\n", code, http.getString().c_str());
  } else {
    Serial.printf("[portal] FAILED: %s (code %d)\n",
                  http.errorToString(code).c_str(), code);
  }
  http.end();
}

// --------------------------- portal sync ---------------------------
int syncFails = 0;

void syncPortal() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  http.setReuse(true);
  String url = String(PORTAL_BASE) + "/api/esp/sync?deviceId=" + deviceId +
               "&rssi=" + String(WiFi.RSSI()) +
               "&ip=" + WiFi.localIP().toString() +
               "&fw=" + FW_VERSION +
               "&mode=" + modeStr() +
               "&uptime=" + String(millis() / 1000);
  if (!http.begin(netClient, url)) {
    portalReachable = false;
    Serial.println("[portal] sync FAILED: could not begin URL");
    return;
  }
  int code = http.GET();
  if (code != 200) {
    portalReachable = false;
    syncFails++;
    if (syncFails == 1 || syncFails % 10 == 0) {
      Serial.printf("[portal] sync HTTP %d (%s) -> %s  [fail #%d]\n",
                    code, http.errorToString(code).c_str(),
                    url.c_str(), syncFails);
    }
    http.end();
    return;
  }
  if (!portalReachable) Serial.println("[portal] connected (sync OK)");
  portalReachable = true;
  syncFails = 0;
  String body = http.getString();
  JsonDocument doc;
  if (!deserializeJson(doc, body)) {
    int cv = doc["configVersion"] | 0;
    if (cv != configVersion) {
      applyConfig(doc["buzzers"].as<JsonArray>());
      configVersion = cv;
      saveConfigCache();
    }
    int settle = doc["scanSettleMs"] | 0;
    if (settle > 0) scanSettleMs = settle;

    for (JsonObject cmd : doc["commands"].as<JsonArray>()) {
      int cid = cmd["id"] | 0;
      String type = cmd["type"].as<String>();
      handleCommand(type);
      if (cid) postAck(cid);
    }
  }
  http.end();
}

// --------------------------- setup / loop ---------------------------
void connectWifi() {
  Serial.printf("Connecting to WiFi \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connect timed out (will keep retrying).");
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("Buzzer device starting...");

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // HTTPS: encrypt without cert verification. To verify, replace with:
  //   netClient.setCACert(ROOT_CA_PEM);
  netClient.setInsecure();

  prefs.begin("buzzer", false);
  loadConfigCache();
  Serial.printf("Cached config: %d buzzer(s), version %d\n", buzzerCount, configVersion);

  connectWifi();

  String mac = WiFi.macAddress();
  mac.replace(":", "");
  deviceId = "ESP32-" + mac.substring(6);
  Serial.print("Device ID: ");
  Serial.println(deviceId);
  Serial.print("Portal:    ");
  Serial.println(PORTAL_BASE);
  printWifiInfo();
  probePortal();
  Serial.println("---------------------------------------------");
}

void loop() {
  static unsigned long lastWifiLog = 0;
  static unsigned long lastLedToggle = 0;
  static bool ledState = false;

  // Blink the status LED (1000 ms) to indicate an active internet/WiFi connection.
  if (WiFi.status() == WL_CONNECTED) {
    if (millis() - lastLedToggle >= 1000) {
      lastLedToggle = millis();
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState ? HIGH : LOW);
    }
  } else if (ledState) {
    ledState = false;
    digitalWrite(LED_PIN, LOW);
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiAttempt > WIFI_RETRY_MS) {
      lastWifiAttempt = millis();
      Serial.printf("[wifi] disconnected (status=%d), reconnecting...\n", WiFi.status());
      WiFi.begin(WIFI_SSID, WIFI_PASS);
    }
  } else {
    if (millis() - lastSyncMs >= SYNC_INTERVAL_MS) {
      lastSyncMs = millis();
      syncPortal();
    }
    drainEvents();
    if (millis() - lastWifiLog > 10000) {
      lastWifiLog = millis();
      Serial.printf("[status] wifi=ok ip=%s rssi=%d portal=%s mode=%s\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI(),
                    portalReachable ? "OK" : "UNREACHABLE", modeStr());
    }
  }

  drainPendingPresses();

  if (mode == MODE_SCAN && scanActive && scanCount > 0 && !rapidMode &&
      (millis() - lastPressMs) >= scanSettleMs) {
    finalizeScan();
  }

  delay(2);
}
