import assert from 'node:assert/strict';
import test from 'node:test';

import { rssiQuality, rttQuality, SIGNAL_QUALITY_LABEL } from './quality.ts';

test('rttQuality: bands from excellent to poor at the documented boundaries', () => {
  assert.equal(rttQuality(0), 'excellent');
  assert.equal(rttQuality(80), 'excellent');
  assert.equal(rttQuality(81), 'good');
  assert.equal(rttQuality(200), 'good');
  assert.equal(rttQuality(201), 'fair');
  assert.equal(rttQuality(400), 'fair');
  assert.equal(rttQuality(401), 'poor');
  assert.equal(rttQuality(5000), 'poor');
});

test('rssiQuality: bands from excellent to poor at the documented boundaries', () => {
  assert.equal(rssiQuality(-40), 'excellent');
  assert.equal(rssiQuality(-60), 'excellent');
  assert.equal(rssiQuality(-61), 'good');
  assert.equal(rssiQuality(-70), 'good');
  assert.equal(rssiQuality(-71), 'fair');
  assert.equal(rssiQuality(-80), 'fair');
  assert.equal(rssiQuality(-81), 'poor');
  assert.equal(rssiQuality(-100), 'poor');
});

test('SIGNAL_QUALITY_LABEL: every band has a plain-language label', () => {
  assert.equal(SIGNAL_QUALITY_LABEL.excellent, 'Excellent');
  assert.equal(SIGNAL_QUALITY_LABEL.good, 'Good');
  assert.equal(SIGNAL_QUALITY_LABEL.fair, 'Fair');
  assert.equal(SIGNAL_QUALITY_LABEL.poor, 'Poor');
});
