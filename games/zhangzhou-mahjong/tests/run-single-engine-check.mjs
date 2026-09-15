import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function findSingleGameCore(rootDir) {
    const stack = [rootDir];
    while (stack.length) {
        const dir = stack.pop();
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (fullPath.endsWith(path.join('src', 'engine', 'game-core.js'))) {
                return fullPath;
            }
        }
    }
    return null;
}

const gameCorePath = findSingleGameCore(process.cwd());
assert.ok(gameCorePath, 'single game-core.js not found');

const single = await import(pathToFileURL(gameCorePath));
assert.equal(typeof single.serializeState, 'function');
assert.equal(typeof single.applyAction, 'function');
assert.equal(typeof single.runAITurn, 'function');
assert.equal(typeof single.getLegalActions, 'function');

const snapshot = single.serializeState();
const baseline = JSON.stringify(snapshot);

const legal = single.getLegalActions(snapshot, 0);
assert.ok(Array.isArray(legal), 'getLegalActions should return array');

const nextByApply = single.applyAction(snapshot, { type: 'PASS', seatId: 0, payload: {} });
assert.ok(nextByApply && typeof nextByApply === 'object', 'applyAction should return state object');
assert.equal(JSON.stringify(single.serializeState()), baseline, 'applyAction(inputState, action) should not mutate global state');

const nextByAI = single.runAITurn(snapshot, 1);
assert.ok(nextByAI && typeof nextByAI === 'object', 'runAITurn should return state object');
assert.equal(JSON.stringify(single.serializeState()), baseline, 'runAITurn(inputState, seatId) should not mutate global state');

console.log('single-engine checks passed');
