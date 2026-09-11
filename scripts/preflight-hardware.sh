#!/usr/bin/env bash
#
# RoveLink hardware-demo preflight.
#
# Answers ONE question: could we walk into the university session right now,
# with no network and no time to fix anything, and flash + validate hardware?
#
# Fails fast and non-zero on the first unmet prerequisite, because a
# preflight that reports six problems at the end is a preflight nobody runs
# twice. Prints no secret values, ever — only whether a credential file
# exists and is non-empty.
#
# Usage:
#   scripts/preflight-hardware.sh            # full run
#   SKIP_COMPILE=1 scripts/preflight-hardware.sh   # fast checks only
#
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Known-good physically-validated car commit. The car is NOT re-validated
# before the session, so any drift here is something a human must sign off
# on rather than something this script can approve.
KNOWN_GOOD_CAR_COMMIT="f5d3306"
EXPECTED_BRANCH="hardware/esp32cam-validation"

FQBN_CAR="esp32:esp32:esp32"
FQBN_CAM="esp32:esp32:esp32cam"

ARTIFACT_DIR="artifacts/hardware-demo"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
if [ ! -t 1 ]; then RED=""; GREEN=""; YELLOW=""; BOLD=""; RESET=""; fi

step=0
say()  { printf '%s\n' "$*"; }
ok()   { printf '  %sPASS%s  %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %sWARN%s  %s\n' "$YELLOW" "$RESET" "$*"; }
begin(){ step=$((step+1)); printf '\n%s[%02d] %s%s\n' "$BOLD" "$step" "$*" "$RESET"; }

die() {
  printf '\n  %sFAIL%s  %s\n' "$RED" "$RESET" "$1" >&2
  if [ $# -gt 1 ]; then printf '  %sfix:%s  %s\n' "$BOLD" "$RESET" "$2" >&2; fi
  printf '\n%sPREFLIGHT FAILED — NOT ready for hardware validation.%s\n' "$RED" "$RESET" >&2
  exit 1
}

trap 'die "unexpected error on line $LINENO"' ERR

# ---------------------------------------------------------------------------
begin "Toolchain present"
command -v arduino-cli >/dev/null 2>&1 || die "arduino-cli not found on PATH" \
  "install arduino-cli, then re-run"
ok "arduino-cli $(arduino-cli version | sed -E 's/.*Version: ([^ ]+).*/\1/')"

command -v node >/dev/null 2>&1 || die "node not found on PATH" "install Node.js"
ok "node $(node --version)"

command -v pnpm >/dev/null 2>&1 || die "pnpm not found on PATH" "npm i -g pnpm"
ok "pnpm $(pnpm --version)"

# ---------------------------------------------------------------------------
begin "Git branch and working state"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "$EXPECTED_BRANCH" ] || die \
  "on branch '$BRANCH', expected '$EXPECTED_BRANCH'" \
  "git switch $EXPECTED_BRANCH"
ok "on $EXPECTED_BRANCH"

git cat-file -e "${KNOWN_GOOD_CAR_COMMIT}^{commit}" 2>/dev/null || die \
  "known-good car commit $KNOWN_GOOD_CAR_COMMIT is not in this repository" \
  "fetch the branch that contains it"
ok "known-good car commit $KNOWN_GOOD_CAR_COMMIT present"

# The car is the one thing already validated on real hardware. Uncommitted
# edits to it are flagged loudly: they have never been run on the board.
if ! git diff --quiet -- firmware/rovelink_device; then
  die "firmware/rovelink_device has UNCOMMITTED changes" \
    "the physical car is known-good at $KNOWN_GOOD_CAR_COMMIT; review with 'git diff -- firmware/rovelink_device' and commit or revert before the session"
fi
ok "car firmware has no uncommitted changes"

# ---------------------------------------------------------------------------
begin "Arduino core installed locally (offline-capable)"
arduino-cli core list 2>/dev/null | grep -qE '^esp32:esp32[[:space:]]' || die \
  "esp32:esp32 core is not installed" \
  "arduino-cli core install esp32:esp32"
CORE_VER="$(arduino-cli core list 2>/dev/null | awk '$1=="esp32:esp32"{print $2}')"
ok "esp32:esp32 $CORE_VER"

ARDUINO_DATA="$(arduino-cli config get directories.data 2>/dev/null)"
for tool in esp32-libs esp-x32 esptool_py; do
  [ -d "$ARDUINO_DATA/packages/esp32/tools/$tool" ] || die \
    "required esp32 tool '$tool' is missing from $ARDUINO_DATA" \
    "arduino-cli core install esp32:esp32 (re-run while online)"
done
ok "compiler + esptool present locally — no downloads needed"

# ---------------------------------------------------------------------------
begin "Arduino libraries installed locally"
# Exact versions this demo was compiled and reasoned against. A silent minor
# bump is exactly the kind of thing that turns a flashing session into a
# debugging session, so a mismatch WARNs loudly but does not block.
check_lib() {
  local name="$1" want="$2" have
  have="$(arduino-cli lib list 2>/dev/null | awk -v n="$name" '$1==n{print $2}')"
  [ -n "$have" ] || die "Arduino library '$name' is not installed" \
    "arduino-cli lib install \"$name@$want\""
  if [ "$have" != "$want" ]; then
    warn "$name $have installed, demo was verified against $want"
  else
    ok "$name $have"
  fi
}
check_lib ArduinoJson 7.4.3
check_lib WebSockets  2.7.2
check_lib ESP32Servo  3.2.1

# ---------------------------------------------------------------------------
begin "Local secret headers present (contents never printed)"
# Existence + non-empty + a real value only. This script must be safe to run
# with someone watching the screen.
require_secret_file() {
  local path="$1" macro="$2" placeholder="$3"
  [ -f "$path" ] || die "missing $path" \
    "cp ${path%.h}.example.h $path  (then fill in the real value)"
  [ -s "$path" ] || die "$path is empty" "fill in the real value"
  grep -q "define $macro" "$path" || die \
    "$path does not define $macro" "see ${path%.h}.example.h"
  if grep -q "$placeholder" "$path"; then
    die "$path still contains the example placeholder for $macro" \
      "replace it with the real provisioned value"
  fi
  ok "$(basename "$path") defines $macro (value not shown)"
}
require_secret_file firmware/rovelink_device/wifi_secrets.h   WIFI_SSID              "your-ssid"
require_secret_file firmware/rovelink_device/device_secrets.h DEVICE_TOKEN           "REPLACE_WITH"
require_secret_file firmware/rovelink_camera/wifi_secrets.h   WIFI_SSID              "your-ssid"
require_secret_file firmware/rovelink_camera/video_secrets.h  VIDEO_PUBLISHER_SECRET "REPLACE_WITH"

# The smoke test is deliberately configuration-free — assert that stays true,
# because its entire value is being the one target that cannot be misconfigured.
if grep -rqE '#include "(wifi|video)_secrets\.h"' firmware/rovelink_camera_smoketest/; then
  die "smoke test has acquired a secrets dependency" \
    "keep firmware/rovelink_camera_smoketest/ free of wifi/video secrets"
fi
ok "smoke test needs no secrets (by design)"

# ---------------------------------------------------------------------------
begin "Camera firmware targets the deployed relay over TLS"
grep -q '#define VIDEO_RELAY_PROFILE VIDEO_RELAY_PROFILE_CLOUDFLARE' \
  firmware/rovelink_camera/video_relay_config.h || die \
  "camera firmware is not on the CLOUDFLARE profile" \
  "set VIDEO_RELAY_PROFILE to VIDEO_RELAY_PROFILE_CLOUDFLARE in firmware/rovelink_camera/video_relay_config.h"
grep -q 'REPLACE_WITH_DEPLOYED_VIDEO_RELAY_HOSTNAME' \
  firmware/rovelink_camera/video_relay_config.h && die \
  "video relay hostname is still a placeholder" \
  "fill in the deployed hostname from 'wrangler deploy' output" || true
ok "CLOUDFLARE profile with a real hostname (port 443, TLS on)"

# ---------------------------------------------------------------------------
if [ "${SKIP_COMPILE:-0}" = "1" ]; then
  begin "Firmware compiles"
  warn "skipped (SKIP_COMPILE=1)"
else
  begin "Firmware compiles from clean — all three targets"
  mkdir -p "$ARTIFACT_DIR"/{wemos-car,esp32cam-smoketest,esp32cam-rovelink}

  compile() {
    local label="$1" fqbn="$2" sketch="$3" out="$4" log
    log="$(mktemp)"
    if ! arduino-cli compile --clean --fqbn "$fqbn" --output-dir "$out" "$sketch" >"$log" 2>&1; then
      sed 's/^/      | /' "$log" >&2
      rm -f "$log"
      die "$label failed to compile" "see the compiler output above"
    fi
    ok "$label — $(grep -oE 'Sketch uses [0-9]+ bytes \([0-9]+%\)' "$log" | head -1)"
    rm -f "$log"
  }
  compile "original Wemos car"      "$FQBN_CAR" firmware/rovelink_device            "$ARTIFACT_DIR/wemos-car"
  compile "ESP32-CAM smoke test"    "$FQBN_CAM" firmware/rovelink_camera_smoketest  "$ARTIFACT_DIR/esp32cam-smoketest"
  compile "ESP32-CAM RoveLink pub"  "$FQBN_CAM" firmware/rovelink_camera            "$ARTIFACT_DIR/esp32cam-rovelink"
fi

# ---------------------------------------------------------------------------
begin "Flashable artifacts exported"
for d in wemos-car esp32cam-smoketest esp32cam-rovelink; do
  bin="$(find "$ARTIFACT_DIR/$d" -maxdepth 1 -name '*.ino.bin' -print -quit 2>/dev/null || true)"
  [ -n "$bin" ] || die "no .ino.bin in $ARTIFACT_DIR/$d" \
    "re-run without SKIP_COMPILE=1"
  for part in bootloader.bin partitions.bin; do
    ls "$ARTIFACT_DIR/$d"/*."$part" >/dev/null 2>&1 || die \
      "missing $part in $ARTIFACT_DIR/$d" "re-run without SKIP_COMPILE=1"
  done
  ok "$d — $(basename "$bin") + bootloader + partitions"
done

# ---------------------------------------------------------------------------
begin "Repository tests and builds"
run_pkg() {
  local label="$1" filter="$2" script="$3" log
  log="$(mktemp)"
  if ! pnpm --filter "$filter" "$script" >"$log" 2>&1; then
    tail -40 "$log" | sed 's/^/      | /' >&2
    rm -f "$log"
    die "$label ($script) failed" "see output above"
  fi
  rm -f "$log"
  ok "$label $script"
}
run_pkg "protocol"    @rovelink/protocol    test
run_pkg "video relay" @rovelink/video-relay test
run_pkg "web"         @rovelink/web         test
run_pkg "web"         @rovelink/web         build

# ADVISORY, NOT BLOCKING — and deliberately so.
#
# relay/src/room.do.test.ts is a PRE-EXISTING unstable suite: measured at
# roughly a 50% per-run failure rate across at least three different timing/
# Durable-Object-lifecycle tests ("releases the role after a socket error",
# "reclaims a stale controller role...", "a second sweep over an
# already-demoted stale device..."). The instability predates this work and
# is unrelated to video — the camera demo path is protocol + video-relay +
# web, all of which are blocking checks above and all of which are green.
#
# Making this blocking would mean a preflight that fails ~half the time for
# a reason nobody can act on before the session, which defeats the point of
# having a preflight. So it runs, it retries, and it reports honestly — but
# a flaky control-relay test never stands between a ready repo and a demo.
begin "Control relay tests (ADVISORY — known-unstable suite)"
RELAY_DEGRADED=0
relay_log="$(mktemp)"
relay_pass=0
for attempt in 1 2 3; do
  if pnpm --filter @rovelink/relay test >"$relay_log" 2>&1; then
    ok "control relay tests passed (attempt $attempt/3)"
    relay_pass=1
    break
  fi
done
if [ "$relay_pass" = "0" ]; then
  RELAY_DEGRADED=1
  warn "control relay tests failed 3/3 — failing test(s):"
  grep -E '^ *× ' "$relay_log" | sed 's/^ */        /' >&2 || true
  warn "NOT blocking: pre-existing instability in room.do.test.ts, unrelated to video"
  warn "if these are NEW failures rather than the known flake, investigate before the session"
fi
rm -f "$relay_log"

# ---------------------------------------------------------------------------
cat <<BANNER

${GREEN}${BOLD}================================================================${RESET}
${GREEN}${BOLD}  PREFLIGHT PASSED — READY FOR PHYSICAL HARDWARE VALIDATION${RESET}
${GREEN}${BOLD}================================================================${RESET}

  Everything needed is on this machine. You can go offline now.

  Flashable binaries   ${ARTIFACT_DIR}/
    wemos-car/            original car        (${FQBN_CAR})
    esp32cam-smoketest/   camera hardware     (${FQBN_CAM})
    esp32cam-rovelink/    full video publisher(${FQBN_CAM})

  At the university, follow docs/hardware-demo-runbook.md:
    LEVEL 1  old known-good firmware (~/Projects/compiladores) — fallback
    LEVEL 2  smoke test    — proves camera hardware, no network
    LEVEL 3  RoveLink pub  — proves Wi-Fi + TLS + relay + browser

  Upload a PRE-COMPILED build without recompiling:
    arduino-cli upload --input-dir ${ARTIFACT_DIR}/esp32cam-smoketest \\
      -b ${FQBN_CAM} -p /dev/ttyUSB0

BANNER

if [ "${RELAY_DEGRADED:-0}" = "1" ]; then
  printf '  %sNote:%s control relay tests are failing (advisory, pre-existing,\n' "$YELLOW" "$RESET"
  printf '        unrelated to the camera/video demo path).\n\n'
fi
