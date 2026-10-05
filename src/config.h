#pragma once

// ============================================================
//  Buzzer ESP32 device configuration
//  Edit the values below before flashing.
// ============================================================

// ---- WiFi network the ESP32 connects to (station mode) ----
#define WIFI_SSID "iPhone"
#define WIFI_PASS "rishit2006"

// ---- Portal URL --------------------------------------------
// Local test:   http://192.168.x.x:3000   (plain HTTP)
// Deployed:     https://your-domain.com   (TLS)
// The firmware picks HTTP or HTTPS automatically from this value.
#define PORTAL_BASE "http://172.20.10.3:3000"

// ---- Device behaviour --------------------------------------
#define FW_VERSION "2.0.0"

// How often the ESP32 polls the portal for commands / config.
#define SYNC_INTERVAL_MS 1000

// During a scan: once at least one buzzer is pressed, if not all
// buzzers have been pressed, wait this long after the last press
// before sending the result to the portal.
#define SCAN_SETTLE_MS 5000

// Maximum number of buzzers (matches the portal's safe pin pool).
#define MAX_BUZZERS 16

// ---- Status LED --------------------------------------------
// LED on D19 (GPIO19). Active HIGH: glows when WiFi is connected.
// Reserved - it is not used for buzzers.
#define LED_PIN 19
