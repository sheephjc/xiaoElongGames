import assert from 'node:assert/strict';
import {
    buildHumanSeat,
    createStartedGameState,
    defaultStateReducer,
    getOnlineHumanHostUid,
    processPendingActionMap,
    syncHumanSeatControls
} from '../client/src/room-reducer.js';
import { applyOnlineGameAction } from '../client/src/online-game-engine.js';

function emptySeatMap() {
    return { '0': [], '1': [], '2': [], '3': [] };
}

function makeClaimReadyState() {
    return {
        phase: 'playing',
        startedAt: 1,
        endedAt: null,
        roundNo: 1,
        roundCount: 0,
        dealerSeat: 0,
        dealerStreak: 0,
        turnSeat: 0,
        goldTile: 'W1',
        wall: ['T9', 'T8', 'T7', 'T6'],
        hands: {
            '0': ['W5', 'T1'],
            '1': ['W5', 'W5', 'W5', 'T2'],
            '2': ['W7', 'W8'],
            '3': ['S5', 'S6']
        },
        rivers: emptySeatMap(),
        flowers: emptySeatMap(),
        shows: emptySeatMap(),
        scores: [0, 0, 0, 0],
        lastDiscard: null,
        currentDraw: null,
        pendingClaim: null,
        winner: null,
        outcome: null,
        instantScoreLog: [],
        seatControls: {
            '0': 'human',
            '1': 'human',
            '2': 'human',
            '3': 'human'
        },
        lastAction: {
            type: 'ROUND_START',
            seatId: 0,
            payload: {},
            ts: 1
        },
        actionLog: []
    };
}

function makeHumanSeats(onlineFlags, now) {
    return {
        '0': buildHumanSeat('0', 'u1', 'A', !!onlineFlags['0'], now),
        '1': buildHumanSeat('1', 'u2', 'B', !!onlineFlags['1'], now),
        '2': buildHumanSeat('2', 'u3', 'C', !!onlineFlags['2'], now),
        '3': buildHumanSeat('3', 'u4', 'D', !!onlineFlags['3'], now)
    };
}

function checkOfflineTakeoverCycles() {
    for (let i = 0; i < 3; i += 1) {
        const baseTs = 1700001000000 + i * 1000;
        const state = makeClaimReadyState();

        const afterDiscard = applyOnlineGameAction(state, {
            type: 'DISCARD',
            seatId: 0,
            payload: { index: 0 },
            ts: baseTs
        }, baseTs);

        assert.equal(!!afterDiscard.pendingClaim, true, `cycle ${i + 1}: pending claim should exist before takeover`);

        const seats = makeHumanSeats({ '0': true, '1': false, '2': true, '3': true }, baseTs + 1);
        const result = processPendingActionMap(
            {},
            'host-1',
            afterDiscard,
            10,
            seats,
            defaultStateReducer,
            baseTs + 2
        );

        assert.equal(result.changed, true, `cycle ${i + 1}: takeover should advance state`);
        assert.equal(result.gameState.pendingClaim, null, `cycle ${i + 1}: pending claim should be resolved by bot`);
        assert.equal(result.gameState.seatControls['1'], 'bot', `cycle ${i + 1}: seat 1 should be bot controlled`);
        assert.equal(result.gameState.shows['1']?.[0]?.type, 'GANG', `cycle ${i + 1}: bot should execute GANG claim`);
    }
}

function checkReconnectReclaimCycles() {
    for (let i = 0; i < 3; i += 1) {
        const baseTs = 1700001100000 + i * 1000;
        const state = makeClaimReadyState();

        const afterDiscard = applyOnlineGameAction(state, {
            type: 'DISCARD',
            seatId: 0,
            payload: { index: 0 },
            ts: baseTs
        }, baseTs);

        assert.equal(!!afterDiscard.pendingClaim, true, `cycle ${i + 1}: pending claim should exist before reconnect`);
        afterDiscard.seatControls['1'] = 'bot';

        const seats = makeHumanSeats({ '0': true, '1': true, '2': true, '3': true }, baseTs + 1);
        const result = processPendingActionMap(
            {},
            'host-1',
            afterDiscard,
            20,
            seats,
            defaultStateReducer,
            baseTs + 2
        );

        assert.equal(result.changed, true, `cycle ${i + 1}: control sync should update state`);
        assert.equal(result.gameState.seatControls['1'], 'human', `cycle ${i + 1}: seat 1 should reclaim human control`);
        assert.equal(!!result.gameState.pendingClaim, true, `cycle ${i + 1}: pending claim window should remain for human`);
        assert.equal(result.gameState.shows['1']?.length || 0, 0, `cycle ${i + 1}: reconnect path should not auto-claim`);
    }
}

function checkHostMigrationOrderCycles() {
    const now = 1700001200000;
    let seats = makeHumanSeats({ '0': true, '1': true, '2': true, '3': true }, now);

    const rounds = [
        { presence: { u1: { online: false }, u2: { online: true }, u3: { online: true }, u4: { online: true } }, expectedHost: 'u2' },
        { presence: { u1: { online: false }, u2: { online: false }, u3: { online: true }, u4: { online: true } }, expectedHost: 'u3' },
        { presence: { u1: { online: false }, u2: { online: false }, u3: { online: false }, u4: { online: true } }, expectedHost: 'u4' }
    ];

    rounds.forEach((round, index) => {
        const syncResult = syncHumanSeatControls(seats, round.presence, now + index + 1);
        seats = syncResult.seats;
        const nextHost = getOnlineHumanHostUid(seats);
        assert.equal(nextHost, round.expectedHost, `host migration cycle ${index + 1}: expected ${round.expectedHost}`);
    });
}

function checkMultiRoundStartStability() {
    const seats = makeHumanSeats({ '0': true, '1': true, '2': true, '3': true }, 1700001300000);
    let state = createStartedGameState(seats, 1700001300000, 1);

    for (let i = 0; i < 3; i += 1) {
        const base = i + 1;
        state = {
            ...state,
            phase: 'ended',
            endedAt: 1700001300100 + i,
            scores: [3 * base, -base, -base, -base]
        };

        const next = applyOnlineGameAction(state, {
            type: 'ROUND_START',
            seatId: 0,
            payload: {},
            ts: 1700001300200 + i
        }, 1700001300200 + i);

        assert.equal(next.phase, 'playing', `round cycle ${i + 1}: should restart into playing phase`);
        assert.equal(next.roundNo, state.roundNo + 1, `round cycle ${i + 1}: round number should increment`);
        assert.deepEqual(next.scores, state.scores, `round cycle ${i + 1}: scores should carry over`);
        assert.equal(next.dealerSeat, state.dealerSeat, `round cycle ${i + 1}: dealer seat should carry over`);

        state = next;
    }
}

checkOfflineTakeoverCycles();
checkReconnectReclaimCycles();
checkHostMigrationOrderCycles();
checkMultiRoundStartStability();

console.log('online stability checks passed');
