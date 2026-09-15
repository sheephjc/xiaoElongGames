import assert from 'node:assert/strict';
import { ACTION_TYPES } from '../client/singleplayer/src/shared/action-schema.js';
import { SUPPORTED_ONLINE_ACTION_TYPES } from '../client/src/online-game-engine.js';

const missingInOnline = ACTION_TYPES.filter((type) => !SUPPORTED_ONLINE_ACTION_TYPES.includes(type));
assert.equal(
    missingInOnline.length,
    0,
    `online action support missing: ${missingInOnline.join(', ')}`
);

console.log('action parity checks passed');
