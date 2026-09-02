/**
 * Controller settings panel: profile switcher, interactive diagram, live
 * input visualization, and Steam-style rebind flow. A focused overlay, not
 * a redesign of the main dashboard.
 */

import { CONTROLLER_DIAGRAM_SVG } from './controller-diagram.ts';

const ACTION_ROW = (action: string, label: string): string => `
  <li class="binding-row" data-action="${action}">
    <span class="label">${label}</span>
    <output class="binding-row__value" id="binding-${action}"></output>
    <button type="button" class="button binding-row__rebind" id="rebind-${action}">Rebind</button>
  </li>`;

export const CONTROLLER_SETTINGS_TEMPLATE = `
<div class="settings-overlay" id="settings-overlay">
  <div class="settings-panel module" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div class="module__header">
      <h2 id="settings-title" class="label">Controller settings</h2>
      <button type="button" class="label hover:text-ice" id="settings-close">Close</button>
    </div>

    <div class="settings-body">
      <p class="label" id="settings-controller-status">Controller: not detected</p>

      <div class="settings-profiles" role="group" aria-label="Profile">
        <button type="button" class="button" data-profile="racing" id="profile-racing" aria-pressed="false">Racing</button>
        <button type="button" class="button" data-profile="stick" id="profile-stick" aria-pressed="false">Stick</button>
        <button type="button" class="button" data-profile="custom" id="profile-custom" aria-pressed="false">Custom</button>
      </div>
      <p class="text-ice-2 -mt-2 text-[0.7rem] leading-relaxed" id="profile-description"></p>

      <div class="controller-diagram" id="controller-diagram">
        ${CONTROLLER_DIAGRAM_SVG}
      </div>

      <dl class="settings-live" id="settings-live">
        <div class="settings-live__row">
          <dt class="label">Left stick</dt>
          <dd class="settings-live__value" id="live-left-stick">X 0.00 · Y 0.00</dd>
        </div>
        <div class="settings-live__row">
          <dt class="label">Right stick</dt>
          <dd class="settings-live__value" id="live-right-stick">X 0.00 · Y 0.00</dd>
        </div>
        <div class="settings-live__row">
          <dt class="label">L2</dt>
          <dd class="settings-live__value"><meter id="live-l2" min="0" max="1" value="0"></meter></dd>
        </div>
        <div class="settings-live__row">
          <dt class="label">R2</dt>
          <dd class="settings-live__value"><meter id="live-r2" min="0" max="1" value="0"></meter></dd>
        </div>
        <div class="settings-live__row">
          <dt class="label">Throttle</dt>
          <dd class="settings-live__value" id="live-throttle">0%</dd>
        </div>
        <div class="settings-live__row">
          <dt class="label">Steering</dt>
          <dd class="settings-live__value" id="live-steering">0%</dd>
        </div>
      </dl>

      <ul class="binding-list" id="binding-list">
        ${ACTION_ROW('throttle', 'Throttle')}
        ${ACTION_ROW('steering', 'Steering')}
        ${ACTION_ROW('gripperOpen', 'Gripper open')}
        ${ACTION_ROW('gripperClose', 'Gripper close')}
        ${ACTION_ROW('arm', 'Arm')}
        ${ACTION_ROW('disarm', 'Disarm')}
        ${ACTION_ROW('emergencyStop', 'Emergency stop')}
      </ul>

      <p class="settings-capture" id="settings-capture" hidden role="status">Press a control…</p>
      <ul class="settings-conflicts" id="settings-conflicts" hidden></ul>

      <div class="settings-reset">
        <button type="button" class="button" id="reset-racing">Reset to Racing</button>
        <button type="button" class="button" id="reset-stick">Reset to Stick</button>
      </div>
    </div>
  </div>
</div>
`;
