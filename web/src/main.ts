import './style.css';
import { mountControl } from './control-view.ts';
import { $ } from './ui/dom.ts';

// No router, no splash, no prior fetch: the dashboard mounts at once
// with its initial state and from then on only updates what changes.
mountControl($('#app', HTMLDivElement));
