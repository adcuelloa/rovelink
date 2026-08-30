// SimulatedHardware — RobotHardware implementation for the ESP32-S3 test board,
// which has no motors, servo, buzzer, or camera, and is connected only via USB.
//
// No function in this file calls pinMode(), digitalWrite(), analogWrite(),
// ledc*(), or Servo::attach(). All physical actions print to Serial. That's
// exactly the point: the original car's pinout (GPIO 25/26/27) overlaps with
// the S3's Flash/PSRAM SPI bus, so configuring it as output hangs the boot.

#include "config.h"

#if HARDWARE_SIMULATION

#include "hardware.h"

// Simulation phase examples show "left=0.47" but "left=0" for safe state,
// so exact zero prints without decimals.
static void printAxis(const char *label, float value)
{
  Serial.print(label);
  if (value == 0.0f)
    Serial.print('0');
  else
    Serial.print(value, 2);
}

const char *hwBoardName()
{
  return "ESP32-S3";
}

const char *hwModeName()
{
  return "HARDWARE SIMULATION";
}

void hwSetup()
{
  // Nothing to initialize: no peripherals to touch.
}

void hwApplyMotors(float left, float right)
{
  Serial.print("[MOTOR SIM] ");
  printAxis("left=", left);
  printAxis(" right=", right);
  Serial.println();
}

void hwStopMotors()
{
  hwApplyMotors(0.0f, 0.0f);
}

void hwApplyGripper(char gripper)
{
  // Simulated gripper state: only announce changes, just like the real
  // servo only moves when the target changes.
  static char last = 'i';

  if (gripper != 'o' && gripper != 'c')
    return; // 'i' (idle): gripper stays where it is.
  if (gripper == last)
    return;

  last = gripper;
  Serial.print("[GRIPPER SIM] ");
  Serial.println(gripper == 'o' ? "open" : "close");
}

void hwLinkLed(bool on)
{
  static int last = -1;
  if ((int)on == last)
    return;
  last = (int)on;
  Serial.print("[LINK SIM] led=");
  Serial.println(on ? "on" : "off");
}

#endif // HARDWARE_SIMULATION
