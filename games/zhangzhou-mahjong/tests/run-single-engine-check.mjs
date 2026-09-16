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

let nextTileId = 0;
function tile(code) {
    const type = code[0];
    const val = Number(code.slice(1)) - 1;
    return { type, val, char: single.MAHJONG_TILES[type][val], id: ++nextTileId };
}

function claimState(hand, discard, gold = 'W5') {
    const state = single.serializeState(snapshot);
    state.gold = tile(gold);
    state.roundCount = 3;
    state.turn = 3;
    state.lastDiscard = tile(discard);
    state.players[3].river = [state.lastDiscard];
    state.players[0].hand = hand.map(tile);
    return state;
}

function meldChars(state, seatId = 0) {
    return state.players[seatId].show[0].tiles.map(t => t.char).sort();
}

// Gold sorts before white dragon, so matching only the logical value used to
// consume gold even though the legal chi option was supplied by white dragon.
for (const [gold, discard, companion, choice] of [
    ['W5', 'W3', 'W4', [3, 4]],
    ['T5', 'T4', 'T6', [4, 5]],
    ['S5', 'S7', 'S6', [4, 5]]
]) {
    const state = claimState([gold, 'Z7', companion, 'Z1'], discard, gold);
    assert.ok(single.getLegalActions(state, 0).some(a => a.type === 'CHI'));
    const after = single.applyAction(state, { type: 'CHI', seatId: 0, payload: { choice } });
    assert.deepEqual(meldChars(after), [discard, companion, 'Z7'].map(c => tile(c).char).sort());
    assert.ok(after.players[0].hand.some(t => t.id === state.players[0].hand[0].id), 'chi must keep the physical gold tile');
}

for (const [hand, discard, type, choice] of [
    [['W3', 'W4'], 'Z7', 'CHI', [2, 3]],
    [['W5', 'Z7', 'Z7', 'T1'], 'Z7', 'PENG', undefined]
]) {
    const state = claimState(hand, discard);
    assert.ok(single.getLegalActions(state, 0).some(a => a.type === type));
    const after = single.applyAction(state, { type, seatId: 0, payload: { choice } });
    assert.ok(after.players[0].show[0].tiles.every(t => t.char !== state.gold.char));
    assert.equal(after.players[3].river.length, 0);
}

// Invalid/stale actions must neither claim gold nor consume an unrelated last tile.
for (const [hand, discard, gold, type, choice] of [
    [['W5', 'W4', 'T1'], 'W3', 'W5', 'CHI', [3, 4]],
    [['W3', 'W4'], 'W5', 'W5', 'CHI', [2, 3]],
    [['Z7', 'Z7'], 'W5', 'W5', 'PENG', undefined],
    [['W5', 'W5'], 'Z7', 'W5', 'PENG', undefined],
    [['Z7', 'Z7'], 'Z7', 'Z7', 'PENG', undefined],
    [['W5', 'Z7', 'W4'], 'W3', 'W5', 'CHI', [3, 8]]
]) {
    const state = claimState(hand, discard, gold);
    const after = single.applyAction(state, { type, seatId: 0, payload: { choice } });
    assert.deepEqual(after, state, `invalid ${type} should leave all tiles unchanged`);
}

// Exercise the AI's actual reaction path. Its next discard is claimed by the
// human, stopping the synchronous turn loop before another draw is needed.
{
    const state = claimState(['S9', 'S9', 'T1', 'S1'], 'W3');
    state.turn = 1;
    state.lastDiscard = null;
    state.players[3].river = [];
    state.players[1].hand = ['W3'].map(tile);
    state.players[2].hand = ['W5', 'Z7', 'W4', 'Z1', 'T8', 'S9'].map(tile);
    const after = single.runAITurn(state, 1);
    assert.deepEqual(meldChars(after, 2), ['W3', 'W4', 'Z7'].map(c => tile(c).char).sort());
    assert.ok(after.players[2].hand.some(t => t.char === state.gold.char), 'AI chi must keep gold');
}

console.log('single-engine checks passed');
