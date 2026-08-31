#pragma once

#include <Arduino.h>

// Hardware abstraction layer (RobotHardware).
//
//   Control logic (rovelink_device.ino)
//         ↓
//   RobotHardware  (this header)
//         ├── SimulatedHardware  (hardware_sim.cpp)
//         └── RealHardware       (hardware_real.cpp)
//
// No classes or virtual functions intentionally: just a module with two
// implementations selected at compile time via HARDWARE_SIMULATION (config.h).
// The binary never contains both.
//
// Control logic above this line doesn't know—and shouldn't know—whether
// real motors are on the other side.

// Board name for the boot banner ("ESP32-S3", "Wemos D1 R32"…).
const char *hwBoardName();

// Mode name for the banner ("HARDWARE SIMULATION", "REAL HARDWARE").
const char *hwModeName();

// Initialize as needed. In simulation mode, no GPIO is touched.
void hwSetup();

// Motor power per wheel, already mixed and clamped to -1..1. Sign determines
// rotation direction. PWM conversion (and its minimum useful value) is each
// implementation's concern.
void hwApplyMotors(float left, float right);

// Motor shutdown. Must be safe to call at any time, even before hwSetup().
void hwStopMotors();

// 'o' open, 'c' close, 'i' idle (leave as is).
void hwApplyGripper(char gripper);

// Link status LED.
void hwLinkLed(bool on);
