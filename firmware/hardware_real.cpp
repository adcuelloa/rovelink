// RealHardware — RobotHardware implementation for the original robot car.
//
// ⚠ THIS FILE'S PINOUT IS FOR THE ORIGINAL CAR (Wemos D1 R32, classic ESP32),
//   copied from ../reference_car_gripper_wifi/car_gripper_wifi.ino (the
//   calibrated sketch). It is NOT the pinout for the lab ESP32-S3 and must
//   NOT be compiled for it:
//
//     · GPIO 26 (gripper servo), GPIO 27 (IN3), and GPIO 25 (legacy) fall
//       within GPIO 26-32 on the S3, which is wired to the Flash/PSRAM SPI bus.
//       Configuring them as outputs on an S3 with embedded PSRAM causes
//       boot-loop TG1WDT_SYS_RST.
//     · Before reusing this file on an S3, the entire pin map must be remapped;
//       we don't touch it here to avoid miscalibrating the real car.
//
// This file compiles only with HARDWARE_SIMULATION 0.

#include "config.h"

#if !HARDWARE_SIMULATION

#include "hardware.h"
#include <ESP32Servo.h>

// --- ORIGINAL CAR PINOUT (Wemos D1 R32 / Classic ESP32) ---
// Not valid on the lab ESP32-S3. See the warning above.
#define ENA 13
#define IN1 12
#define IN2 14
#define IN3 27 // ⚠ bus Flash/PSRAM en ESP32-S3
#define IN4 16
#define ENB 17
#define BUZZER_PIN 5
#define SERVO_GRIPPER_PIN 26 // ⚠ Flash/PSRAM bus on ESP32-S3
#define LED_LINK_PIN 18

#define GRIPPER_OPEN_POS 90
#define GRIPPER_CLOSE_POS 120

// Minimum PWM that actually moves the car; below this the motor just hums.
static const int PWM_MIN = 90;
static const int PWM_MAX = 255;

static Servo servoGripper;

static int scalePwm(float value)
{
  float magnitude = fabs(value);
  if (magnitude < 0.02f)
    return 0;
  return (int)(PWM_MIN + magnitude * (PWM_MAX - PWM_MIN));
}

const char *hwBoardName()
{
  return "Wemos D1 R32 (ESP32)";
}

const char *hwModeName()
{
  return "REAL HARDWARE";
}

void hwSetup()
{
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(ENA, OUTPUT);
  pinMode(ENB, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_LINK_PIN, OUTPUT);
  hwStopMotors();
  digitalWrite(LED_LINK_PIN, LOW);

  ESP32PWM::allocateTimer(3);
  servoGripper.setPeriodHertz(50);
  servoGripper.attach(SERVO_GRIPPER_PIN, 500, 2400);
  servoGripper.write(GRIPPER_OPEN_POS);
}

void hwApplyMotors(float left, float right)
{
  digitalWrite(IN1, left >= 0 ? HIGH : LOW);
  digitalWrite(IN2, left >= 0 ? LOW : HIGH);
  digitalWrite(IN3, right >= 0 ? LOW : HIGH);
  digitalWrite(IN4, right >= 0 ? HIGH : LOW);

  analogWrite(ENA, scalePwm(left));
  analogWrite(ENB, scalePwm(right));
}

void hwStopMotors()
{
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  analogWrite(ENA, 0);
  analogWrite(ENB, 0);
}

void hwApplyGripper(char gripper)
{
  if (gripper == 'o')
    servoGripper.write(GRIPPER_OPEN_POS);
  else if (gripper == 'c')
    servoGripper.write(GRIPPER_CLOSE_POS);
  // 'i' (idle): gripper stays where it is.
}

void hwLinkLed(bool on)
{
  digitalWrite(LED_LINK_PIN, on ? HIGH : LOW);
}

#endif // !HARDWARE_SIMULATION
