#pragma once

// Firmware build configuration.
//
// HARDWARE_SIMULATION selects which RobotHardware implementation is
// compiled (see hardware.h):
//
//   1 → SimulatedHardware  (hardware_sim.cpp)  — lab board ESP32-S3
//   0 → RealCarHardware    (hardware_real.cpp) — original car (Wemos D1 R32)
//
// In 1 no GPIO is touched: no motors, no servo, no buzzer, no LED. All
// physical actions are written via Serial. This is the mode where the S3
// test board starts stably, because the car's inherited pinout (GPIO 25/26/27)
// is wired to the S3's octal Flash/PSRAM bus and configuring it as output
// causes the boot-loop `rst:0x8 (TG1WDT_SYS_RST)`.
#define HARDWARE_SIMULATION 1

#define ROBOT_ID "robot-01"
#define SERIAL_BAUD 115200

// Firmware version, reported in `device.register` (protocol/src/protocol.ts).
// Purely informational: the relay does not validate or use it.
#define FIRMWARE_VERSION "0.1.0"
