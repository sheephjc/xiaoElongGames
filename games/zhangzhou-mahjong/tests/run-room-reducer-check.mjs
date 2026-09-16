import assert from 'node:assert/strict';
import {
    SEAT_IDS,
    buildHumanSeat,
    buildBotSeat,
    createStartedGameState,
    getOnlineHumanHostUid,
    normalizeSeatsForStart,
    syncHumanSeatControls,
    defaultStateReducer,
    processPendingActionMap
} from '../client/src/room-reducer.js';
import { applyOnlineGameAction, runBotTurns, createOnlineGameState } from '../client/src/online-game-engine.js';

function emptySeatMap() {
    return { '0': [], '1': [], '2': [], '3': [] };
}

function makeBaseGameState() {
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
            '1': 'bot',
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

function checkSeatIds() {
    assert.deepEqual(SEAT_IDS, ['0', '1', '2', '3']);
}

function checkNormalizeSeatsForStart() {
    const now = 1700000000000;
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true, now - 10),
        1: buildHumanSeat('1', 'u2', 'B', false, now - 10),
        2: null,
        3: buildBotSeat('3', now - 10)
    };

    const normalized = normalizeSeatsForStart(seats, now);
    assert.equal(normalized['0'].control, 'human');
    assert.equal(normalized['1'].control, 'bot');
    assert.equal(normalized['2'].isBot, true);
    assert.equal(normalized['3'].isBot, true);
}

function checkSyncSeatControls() {
    const now = 1700000000100;
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true, now - 10),
        1: buildHumanSeat('1', 'u2', 'B', true, now - 10),
        2: buildBotSeat('2', now - 10),
        3: null
    };

    const presence = {
        u1: { online: true },
        u2: { online: false }
    };

    const result = syncHumanSeatControls(seats, presence, now);
    assert.equal(result.changed, true);
    assert.equal(result.seats['0'].control, 'human');
    assert.equal(result.seats['1'].control, 'bot');
}

function checkSyncSeatControlRecovery() {
    const now = 1700000000105;
    const offlineSeat = buildHumanSeat('1', 'u2', 'B', false, now - 20);
    offlineSeat.control = 'bot';
    offlineSeat.online = false;

    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true, now - 20),
        1: offlineSeat,
        2: buildBotSeat('2', now - 20),
        3: null
    };

    const presence = {
        u1: { online: true },
        u2: { online: true }
    };

    const result = syncHumanSeatControls(seats, presence, now);
    assert.equal(result.changed, true);
    assert.equal(result.seats['1'].online, true);
    assert.equal(result.seats['1'].control, 'human');
}

function checkHostElection() {
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', false, Date.now()),
        1: buildBotSeat('1', Date.now()),
        2: buildHumanSeat('2', 'u2', 'B', true, Date.now()),
        3: buildHumanSeat('3', 'u3', 'C', true, Date.now())
    };

    assert.equal(getOnlineHumanHostUid(seats), 'u2');
}

function checkStartedGameState() {
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true),
        1: buildBotSeat('1'),
        2: buildBotSeat('2'),
        3: buildBotSeat('3')
    };

    const state = createStartedGameState(seats, 1700000000200, 1);
    assert.equal(state.phase, 'playing');
    assert.equal(Array.isArray(state.hands['0']), true);
    assert.equal(state.hands['0'].length >= 16, true);
    assert.equal(state.goldTile, null);
    assert.equal(state.goldRevealed, false);
    assert.equal(Array.isArray(state.wall), true);
}

function checkFirstDealerUsesHostSeat() {
    const now = 1700000000210;
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true, now),
        1: buildHumanSeat('1', 'u2', 'B', true, now),
        2: buildHumanSeat('2', 'u3', 'C', true, now),
        3: buildBotSeat('3', now)
    };

    const state = createStartedGameState(seats, now, 1, { hostUid: 'u3' });
    assert.equal(state.dealerSeat, 2);
}

function checkOpenGoldRevealFlow() {
    const now = 1700000000220;
    const seats = {
        '0': { control: 'human', uid: 'u1', isBot: false },
        '1': { control: 'human', uid: 'u2', isBot: false },
        '2': { control: 'human', uid: 'u3', isBot: false },
        '3': { control: 'human', uid: 'u4', isBot: false }
    };
    const state = createOnlineGameState({
        seats,
        now,
        roundNo: 1,
        dealerSeat: 1
    });
    const wallBefore = state.wall.length;

    const denied = applyOnlineGameAction(state, {
        type: 'OPEN_GOLD',
        seatId: 0,
        payload: {},
        ts: now + 1
    }, now + 1);
    assert.equal(denied.goldRevealed, false);
    assert.equal(denied.wall.length, wallBefore);

    const opened = applyOnlineGameAction(state, {
        type: 'OPEN_GOLD',
        seatId: 1,
        payload: {},
        ts: now + 2
    }, now + 2);
    assert.equal(opened.goldRevealed, true);
    assert.equal(typeof opened.goldTile, 'string');
    assert.equal(String(opened.goldTile).startsWith('H'), false);
    assert.equal(opened.wall.length, wallBefore - 1);
}

function checkDealerOnlyActionsInReducer() {
    const now = 1700000000230;
    const seats = {
        '0': buildHumanSeat('0', 'u1', 'A', true, now),
        '1': buildHumanSeat('1', 'u2', 'B', true, now),
        '2': buildHumanSeat('2', 'u3', 'C', true, now),
        '3': buildHumanSeat('3', 'u4', 'D', true, now)
    };

    const base = createOnlineGameState({
        seats,
        now,
        roundNo: 1,
        dealerSeat: 1
    });

    const nonDealerOpen = defaultStateReducer(base, {
        type: 'OPEN_GOLD',
        seatId: 0,
        payload: {},
        ts: now + 1
    }, now + 1, { seats, hostUid: 'u1', actorUid: 'u1' });
    assert.equal(nonDealerOpen.goldRevealed, false);

    const dealerOpen = defaultStateReducer(base, {
        type: 'OPEN_GOLD',
        seatId: 1,
        payload: {},
        ts: now + 2
    }, now + 2, { seats, hostUid: 'u1', actorUid: 'u2' });
    assert.equal(dealerOpen.goldRevealed, true);
    assert.equal(typeof dealerOpen.goldTile, 'string');

    const ended = {
        ...dealerOpen,
        phase: 'ended',
        endedAt: now + 3
    };
    const nonDealerRoundStart = defaultStateReducer(ended, {
        type: 'ROUND_START',
        seatId: 0,
        payload: {},
        ts: now + 4
    }, now + 4, { seats, hostUid: 'u1', actorUid: 'u1' });
    assert.equal(nonDealerRoundStart.roundNo, ended.roundNo);

    const dealerRoundStart = defaultStateReducer(ended, {
        type: 'ROUND_START',
        seatId: 1,
        payload: {},
        ts: now + 5
    }, now + 5, { seats, hostUid: 'u1', actorUid: 'u2' });
    assert.equal(dealerRoundStart.roundNo, ended.roundNo + 1);
    assert.equal(dealerRoundStart.goldRevealed, false);
}

function checkPendingActionProcessing() {
    const now = 1700000000300;
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true, now),
        1: buildBotSeat('1', now),
        2: buildBotSeat('2', now),
        3: buildBotSeat('3', now)
    };

    const actions = {
        a1: { status: 'pending', createdAt: 1, action: { type: 'PASS', seatId: 0 } },
        a2: { status: 'pending', createdAt: 2, action: { type: 'ROUND_START', seatId: 0 } },
        a3: { status: 'processed', createdAt: 3, action: { type: 'PASS', seatId: 0 } }
    };

    const result = processPendingActionMap(actions, 'host-1', null, 7, seats, defaultStateReducer, now);

    assert.equal(result.changed, true);
    assert.equal(result.processedCount >= 2, true);
    assert.equal(result.gameVersion >= 9, true);
    assert.equal(result.actionPatch.a1, null);
    assert.equal(result.actionPatch.a2, null);
    assert.equal(result.actionPatch.a3, null);
    assert.equal(result.removedActionCount >= 3, true);
    assert.equal(result.gameState.phase, 'playing');
    assert.equal(typeof result.gameState.turnSeat, 'number');
}

function checkBotClaimResolution() {
    const state = makeBaseGameState();
    const seats = {
        '0': { control: 'human' },
        '1': { control: 'bot' },
        '2': { control: 'human' },
        '3': { control: 'human' }
    };

    const afterDiscard = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 10
    }, 10);

    assert.equal(!!afterDiscard.pendingClaim, true);

    const botResult = runBotTurns(afterDiscard, seats, 11, 1);
    assert.equal(botResult.appliedSteps >= 1, true);
    assert.equal(botResult.state.pendingClaim, null);
    assert.equal(botResult.state.turnSeat, 1);
    assert.equal(Array.isArray(botResult.state.shows['1']), true);
    assert.equal(botResult.state.shows['1'][0].type, 'GANG');
    assert.equal(botResult.state.scores[1], 3);
    assert.equal(botResult.state.scores[0], -1);
    assert.equal(botResult.state.scores[2], -1);
    assert.equal(botResult.state.scores[3], -1);
}

function checkClaimTimeoutWaitForHuman() {
    const state = makeBaseGameState();
    state.seatControls['1'] = 'human';

    const afterDiscard = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 20
    }, 20);

    assert.equal(!!afterDiscard.pendingClaim, true);

    const result = runBotTurns(afterDiscard, {
        '0': { control: 'human' },
        '1': { control: 'human' },
        '2': { control: 'human' },
        '3': { control: 'human' }
    }, afterDiscard.pendingClaim.expiresAt + 1, 6);

    assert.equal(result.appliedSteps, 0);
    assert.equal(!!result.state.pendingClaim, true);
    assert.equal(result.state.turnSeat, 0);
}

function checkBotClaimResolutionAcrossSeatPositions() {
    for (const claimSeat of [1, 2, 3]) {
        const state = makeBaseGameState();
        state.goldTile = 'Z7';
        state.roundCount = 1;
        state.turnSeat = 0;
        state.wall = ['S1', 'S2', 'S3', 'S4'];
        state.hands['0'] = ['W5', 'T1'];
        state.hands['1'] = ['W1', 'T2'];
        state.hands['2'] = ['W2', 'T3'];
        state.hands['3'] = ['W3', 'T4'];
        state.hands[String(claimSeat)] = ['W5', 'W5', 'W5', 'T9'];
        state.rivers = emptySeatMap();
        state.shows = emptySeatMap();
        state.flowers = emptySeatMap();
        state.pendingClaim = null;
        state.currentDraw = { seatId: 0, tile: 'T1', ts: 50 + claimSeat, reason: 'NORMAL' };

        const afterDiscard = applyOnlineGameAction(state, {
            type: 'DISCARD',
            seatId: 0,
            payload: { index: 0 },
            ts: 60 + claimSeat
        }, 60 + claimSeat);

        assert.equal(!!afterDiscard.pendingClaim, true);
        assert.equal(afterDiscard.pendingClaim?.optionsBySeat?.[String(claimSeat)]?.GANG, true);

        const seats = {
            '0': { control: 'human' },
            '1': { control: claimSeat === 1 ? 'bot' : 'human' },
            '2': { control: claimSeat === 2 ? 'bot' : 'human' },
            '3': { control: claimSeat === 3 ? 'bot' : 'human' }
        };
        const result = runBotTurns(afterDiscard, seats, 70 + claimSeat, 2);
        assert.equal(result.appliedSteps >= 1, true);
        assert.equal(result.state.pendingClaim, null);
        assert.equal(result.state.turnSeat, claimSeat);
        assert.equal(result.state.shows[String(claimSeat)]?.[0]?.type, 'GANG');
    }
}

function checkClaimPriorityHuOverPengAndChi() {
    const state = makeBaseGameState();
    state.goldTile = 'Z7';
    state.aiSpeedMode = 'fast';
    state.roundCount = 1;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'bot',
        '2': 'bot',
        '3': 'bot'
    };
    state.wall = ['S1', 'S2', 'S3'];
    state.hands['0'] = ['T5', 'W3'];
    state.hands['1'] = ['T4', 'T6', 'W1', 'W2'];
    state.hands['2'] = ['T5', 'T5', 'W4', 'W5'];
    state.hands['3'] = ['W1', 'W1', 'W1', 'W2', 'W2', 'W2', 'W3', 'W3', 'W3', 'T2', 'T2', 'T2', 'S5', 'S5', 'S5', 'T5'];
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();
    state.pendingClaim = null;
    state.currentDraw = { seatId: 0, tile: 'W3', ts: 90, reason: 'NORMAL' };

    const afterDiscard = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 91
    }, 91);

    assert.equal(!!afterDiscard.pendingClaim, true);
    assert.equal((afterDiscard.pendingClaim?.optionsBySeat?.['1']?.CHI || []).length > 0, true);
    assert.equal(afterDiscard.pendingClaim?.optionsBySeat?.['2']?.PENG, true);
    assert.equal(afterDiscard.pendingClaim?.optionsBySeat?.['3']?.HU, true);

    const seats = {
        '0': { control: 'human' },
        '1': { control: 'bot' },
        '2': { control: 'bot' },
        '3': { control: 'bot' }
    };
    const result = runBotTurns(afterDiscard, seats, 92, 2);
    assert.equal(result.appliedSteps >= 1, true);
    assert.equal(result.state.phase, 'ended');
    assert.equal(result.state.outcome?.reason, 'DISCARD_HU');
    assert.equal(result.state.outcome?.winner, 3);
    assert.equal(result.state.pendingClaim, null);
}

function checkOfflineTakeoverResolvesPendingClaim() {
    const state = makeBaseGameState();
    state.seatControls['1'] = 'human';

    const afterDiscard = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 25
    }, 25);

    assert.equal(!!afterDiscard.pendingClaim, true);

    const now = 1700000000500;
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true, now - 10),
        1: buildHumanSeat('1', 'u2', 'B', false, now - 10),
        2: buildHumanSeat('2', 'u3', 'C', true, now - 10),
        3: buildHumanSeat('3', 'u4', 'D', true, now - 10)
    };
    seats['1'].control = 'bot';

    const result = processPendingActionMap({}, 'host-1', afterDiscard, 10, seats, defaultStateReducer, now);
    assert.equal(result.changed, true);
    assert.equal(result.gameVersion > 10, true);
    assert.equal(result.gameState.pendingClaim, null);
    assert.equal(result.gameState.seatControls['1'], 'bot');
    assert.equal(typeof result.gameState.turnSeat, 'number');
    assert.equal(result.gameState.turnSeat !== 0, true);
    assert.equal(result.gameState.shows['1'][0].type, 'GANG');
}

function checkReconnectStopsBotAutoClaim() {
    const base = makeBaseGameState();
    base.seatControls['1'] = 'human';

    const afterDiscard = applyOnlineGameAction(base, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 27
    }, 27);

    assert.equal(!!afterDiscard.pendingClaim, true);
    assert.equal(afterDiscard.pendingClaim?.optionsBySeat?.['1']?.GANG, true);

    // 模拟上一拍已经掉线切 bot，但在本拍开始前用户重连
    afterDiscard.seatControls['1'] = 'bot';

    const now = 1000;
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true, now - 10),
        1: buildHumanSeat('1', 'u2', 'B', true, now - 10),
        2: buildHumanSeat('2', 'u3', 'C', true, now - 10),
        3: buildHumanSeat('3', 'u4', 'D', true, now - 10)
    };

    const result = processPendingActionMap({}, 'host-1', afterDiscard, 20, seats, defaultStateReducer, now);

    assert.equal(result.changed, true);
    assert.equal(result.gameState.seatControls['1'], 'human');
    assert.equal(!!result.gameState.pendingClaim, true);
    assert.equal(Array.isArray(result.gameState.shows['1']), true);
    assert.equal(result.gameState.shows['1'].length, 0);
}

function checkSelfHuSettlement() {
    const state = makeBaseGameState();
    state.roundCount = 1;
    state.turnSeat = 0;
    state.hands['0'] = ['W2', 'W2', 'W2', 'W3', 'W3', 'W3', 'W4', 'W4', 'W4', 'T2', 'T2', 'T2', 'S5', 'S5', 'S5', 'Z1', 'Z1'];
    state.currentDraw = { seatId: 0, tile: 'Z1', ts: 30, reason: 'NORMAL' };

    const settled = applyOnlineGameAction(state, {
        type: 'HU',
        seatId: 0,
        payload: {},
        ts: 31
    }, 31);

    assert.equal(settled.phase, 'ended');
    assert.equal(settled.outcome?.isSelfDraw, true);
    assert.equal(settled.outcome?.winner, 0);
    assert.equal(Array.isArray(settled.outcome?.payout), true);
    assert.equal(settled.scores[0], 9);
    assert.equal(settled.scores[1], -3);
    assert.equal(settled.scores[2], -3);
    assert.equal(settled.scores[3], -3);
}

function checkRoundStartCarryScoreAndDealer() {
    const base = createOnlineGameState({
        dealerSeat: 0,
        dealerStreak: 1,
        scores: [5, -2, -1, -2],
        roundNo: 3,
        now: 100
    });

    const ended = { ...base, phase: 'ended', endedAt: 200 };
    const next = applyOnlineGameAction(ended, {
        type: 'ROUND_START',
        seatId: 0,
        payload: {},
        ts: 201
    }, 201);

    assert.equal(next.phase, 'playing');
    assert.equal(next.roundNo, 4);
    assert.equal(next.dealerSeat, 0);
    assert.equal(next.dealerStreak, 1);
    assert.deepEqual(next.scores, [5, -2, -1, -2]);
}

function checkAnGangAction() {
    const state = makeBaseGameState();
    state.turnSeat = 0;
    state.hands['0'] = ['W2', 'W2', 'W2', 'W2', 'T3'];
    state.wall = ['T9', 'T8', 'T7'];

    const after = applyOnlineGameAction(state, {
        type: 'AN_GANG',
        seatId: 0,
        payload: { char: 'W2' },
        ts: 300
    }, 300);

    assert.equal(after.shows['0'][0].type, 'AN_GANG');
    assert.equal(after.shows['0'][0].tiles.length, 4);
    assert.equal(after.scores[0], 6);
    assert.equal(after.scores[1], -2);
    assert.equal(after.scores[2], -2);
    assert.equal(after.scores[3], -2);
    assert.equal(after.currentDraw?.reason, 'GANG');
}

function checkBuGangAction() {
    const state = makeBaseGameState();
    state.turnSeat = 0;
    state.hands['0'] = ['T5', 'W3'];
    state.shows['0'] = [{ type: 'PENG', tiles: ['T5', 'T5', 'T5'] }];
    state.wall = ['S1', 'S2', 'S3'];

    const after = applyOnlineGameAction(state, {
        type: 'BU_GANG',
        seatId: 0,
        payload: { char: 'T5' },
        ts: 400
    }, 400);

    assert.equal(after.shows['0'][0].type, 'BU_GANG');
    assert.equal(after.shows['0'][0].tiles.length, 4);
    assert.equal(after.scores[0], 3);
    assert.equal(after.scores[1], -1);
    assert.equal(after.scores[2], -1);
    assert.equal(after.scores[3], -1);
    assert.equal(after.currentDraw?.reason, 'GANG');
}

function checkQiangGangHuFromBuGang() {
    const state = makeBaseGameState();
    state.goldTile = 'Z7';
    state.roundCount = 1;
    state.turnSeat = 0;
    state.wall = ['S1', 'S2', 'S3'];
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.hands['0'] = ['T5', 'W3'];
    state.shows['0'] = [{ type: 'PENG', tiles: ['T5', 'T5', 'T5'] }];
    state.hands['1'] = ['W1', 'W1', 'W1', 'W2', 'W2', 'W2', 'W3', 'W3', 'W3', 'T2', 'T2', 'T2', 'S5', 'S5', 'S5', 'T5'];
    state.hands['2'] = ['W4'];
    state.hands['3'] = ['W6'];

    const pending = applyOnlineGameAction(state, {
        type: 'BU_GANG',
        seatId: 0,
        payload: { char: 'T5' },
        ts: 500
    }, 500);

    assert.equal(pending.pendingClaim?.kind, 'QIANG_GANG');
    assert.equal(pending.pendingClaim?.source?.seatId, 0);
    assert.equal(pending.pendingClaim?.source?.tile, 'T5');
    assert.equal(pending.pendingClaim?.optionsBySeat?.['1']?.HU, true);
    assert.equal(pending.shows['0'][0].type, 'PENG');

    const settled = applyOnlineGameAction(pending, {
        type: 'HU',
        seatId: 1,
        payload: {},
        ts: 501
    }, 501);

    assert.equal(settled.phase, 'ended');
    assert.equal(settled.outcome?.reason, 'QIANG_GANG_HU');
    assert.equal(settled.outcome?.winner, 1);
    assert.equal(settled.outcome?.loser, 0);
    assert.equal(settled.outcome?.specialTypes.includes('抢杠胡'), true);
    assert.equal(settled.shows['0'][0].type, 'PENG');
    assert.equal(settled.scores[0], -8);
    assert.equal(settled.scores[1], 8);
    assert.equal(settled.scores[2], 0);
    assert.equal(settled.scores[3], 0);
}

function checkQiangGangPassCompletesBuGang() {
    const state = makeBaseGameState();
    state.goldTile = 'Z7';
    state.turnSeat = 0;
    state.wall = ['S1', 'S2', 'S3'];
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.hands['0'] = ['T5', 'W3'];
    state.shows['0'] = [{ type: 'PENG', tiles: ['T5', 'T5', 'T5'] }];
    state.hands['1'] = ['W1', 'W1', 'W1', 'W2', 'W2', 'W2', 'W3', 'W3', 'W3', 'T2', 'T2', 'T2', 'S5', 'S5', 'S5', 'T5'];

    const pending = applyOnlineGameAction(state, {
        type: 'BU_GANG',
        seatId: 0,
        payload: { char: 'T5' },
        ts: 520
    }, 520);

    assert.equal(pending.pendingClaim?.kind, 'QIANG_GANG');

    const afterPass = applyOnlineGameAction(pending, {
        type: 'PASS',
        seatId: 1,
        payload: {},
        ts: 521
    }, 521);

    assert.equal(afterPass.pendingClaim, null);
    assert.equal(afterPass.shows['0'][0].type, 'BU_GANG');
    assert.equal(afterPass.shows['0'][0].tiles.length, 4);
    assert.equal(afterPass.scores[0], 3);
    assert.equal(afterPass.scores[1], -1);
    assert.equal(afterPass.scores[2], -1);
    assert.equal(afterPass.scores[3], -1);
    assert.equal(afterPass.currentDraw?.reason, 'GANG');
}

function checkQiangGangHuFromAnGang() {
    const state = makeBaseGameState();
    state.goldTile = 'Z7';
    state.roundCount = 1;
    state.turnSeat = 0;
    state.wall = ['S1', 'S2', 'S3'];
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.hands['0'] = ['T5', 'T5', 'T5', 'T5', 'W3'];
    state.shows['0'] = [];
    state.hands['1'] = ['W1', 'W1', 'W1', 'W2', 'W2', 'W2', 'W3', 'W3', 'W3', 'T2', 'T2', 'T2', 'S5', 'S5', 'S5', 'T5'];
    state.hands['2'] = ['W4'];
    state.hands['3'] = ['W6'];

    const afterGang = applyOnlineGameAction(state, {
        type: 'AN_GANG',
        seatId: 0,
        payload: { char: 'T5' },
        ts: 540
    }, 540);

    assert.equal(afterGang.pendingClaim, null);
    assert.equal(afterGang.shows['0'][0].type, 'AN_GANG');
    assert.equal(afterGang.shows['0'][0].tiles.length, 4);
    assert.equal(afterGang.scores[0], 6);
    assert.equal(afterGang.scores[1], -2);
    assert.equal(afterGang.scores[2], -2);
    assert.equal(afterGang.scores[3], -2);
    assert.equal(afterGang.currentDraw?.reason, 'GANG');

    const settled = applyOnlineGameAction(afterGang, {
        type: 'HU',
        seatId: 1,
        payload: {},
        ts: 541
    }, 541);

    assert.equal(settled.phase, 'playing');
    assert.equal(settled.outcome, null);
    assert.equal(settled.pendingClaim, null);
    assert.equal(settled.scores[0], 6);
    assert.equal(settled.scores[1], -2);
    assert.equal(settled.scores[2], -2);
    assert.equal(settled.scores[3], -2);
}

function checkChuiFengSettlement() {
    const state = makeBaseGameState();
    state.goldTile = 'Z7';
    state.dealerSeat = 0;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.scores = [0, 0, 0, 0];
    state.wall = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
    state.hands['0'] = ['W5', 'T1'];
    state.hands['1'] = ['W5', 'T2'];
    state.hands['2'] = ['W5', 'T3'];
    state.hands['3'] = ['W5', 'T4'];
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();
    state.pendingClaim = null;
    state.currentDraw = { seatId: 0, tile: 'T1', ts: 600, reason: 'NORMAL' };

    const after0 = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 601
    }, 601);
    assert.equal(after0.pendingClaim, null);
    assert.equal(after0.chuiFeng?.active, true);
    assert.equal(after0.chuiFeng?.targetTile, 'W5');
    assert.equal(after0.turnSeat, 1);

    const after1 = applyOnlineGameAction(after0, {
        type: 'DISCARD',
        seatId: 1,
        payload: { index: 0 },
        ts: 602
    }, 602);
    assert.equal(after1.pendingClaim, null);
    assert.equal(after1.chuiFeng?.followCount, 2);
    assert.equal(after1.turnSeat, 2);

    const after2 = applyOnlineGameAction(after1, {
        type: 'DISCARD',
        seatId: 2,
        payload: { index: 0 },
        ts: 603
    }, 603);
    assert.equal(after2.pendingClaim, null);
    assert.equal(after2.chuiFeng?.followCount, 3);
    assert.equal(after2.turnSeat, 3);

    const after3 = applyOnlineGameAction(after2, {
        type: 'DISCARD',
        seatId: 3,
        payload: { index: 0 },
        ts: 604
    }, 604);
    assert.equal(after3.pendingClaim, null);
    assert.equal(after3.chuiFeng?.active, false);
    assert.equal(after3.scores[0], -3);
    assert.equal(after3.scores[1], 1);
    assert.equal(after3.scores[2], 1);
    assert.equal(after3.scores[3], 1);
    assert.equal(after3.instantScoreLog.some((x) => x.type === 'CHUI_FENG'), true);
}

function checkChuiFengFailNoSettlement() {
    const state = makeBaseGameState();
    state.goldTile = 'Z7';
    state.dealerSeat = 0;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.scores = [0, 0, 0, 0];
    state.wall = ['S1', 'S2', 'S3', 'S4'];
    state.hands['0'] = ['W5', 'T1'];
    state.hands['1'] = ['T8', 'T2'];
    state.hands['2'] = ['W5', 'T3'];
    state.hands['3'] = ['W5', 'T4'];
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();
    state.pendingClaim = null;
    state.currentDraw = { seatId: 0, tile: 'T1', ts: 620, reason: 'NORMAL' };

    const after0 = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 621
    }, 621);
    const after1 = applyOnlineGameAction(after0, {
        type: 'DISCARD',
        seatId: 1,
        payload: { index: 0 },
        ts: 622
    }, 622);

    assert.equal(after1.chuiFeng?.active, false);
    assert.equal(after1.chuiFeng?.failed, true);
    assert.deepEqual(after1.scores, [0, 0, 0, 0]);
    assert.equal(after1.instantScoreLog.some((x) => x.type === 'CHUI_FENG'), false);
}

function checkBotMustFollowChuiFengWhenPossible() {
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true),
        1: buildBotSeat('1'),
        2: buildBotSeat('2'),
        3: buildBotSeat('3')
    };

    const state = createOnlineGameState({ seats, now: 1700000010000, dealerSeat: 0, roundNo: 1 });
    state.turnSeat = 1;
    state.phase = 'playing';
    state.goldRevealed = true;
    state.goldTile = 'W1';
    state.pendingClaim = null;
    state.currentDraw = { seatId: 1, tile: 'S5', ts: 1700000010001, reason: 'NORMAL' };
    state.hands['1'] = ['Z1', 'W2', 'W3', 'W4', 'T2', 'T3', 'T4', 'S2', 'S3', 'S4', 'W6', 'W7', 'W8', 'T6', 'T7', 'T8', 'S9'];
    state.shows['1'] = [];
    state.rivers['1'] = [];
    state.seatControls = { '0': 'human', '1': 'bot', '2': 'bot', '3': 'bot' };
    state.botActionReadyAt = 1700000010000;
    state.chuiFeng = {
        dealerDiscardCount: 1,
        targetTile: 'Z1',
        followCount: 1,
        active: true,
        failed: false
    };

    const result = runBotTurns(state, seats, 1700000010400, 1);
    assert.equal(result.appliedSteps, 1);
    assert.equal(result.state.lastAction?.type, 'DISCARD');
    assert.equal(result.state.lastDiscard?.seatId, 1);
    assert.equal(result.state.lastDiscard?.tile, 'Z1');
}

function checkBotDiscardPrefersIsolatedHonor() {
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true),
        1: buildBotSeat('1'),
        2: buildBotSeat('2'),
        3: buildBotSeat('3')
    };

    const state = createOnlineGameState({ seats, now: 1700000010200, dealerSeat: 0, roundNo: 1 });
    state.turnSeat = 1;
    state.phase = 'playing';
    state.goldRevealed = true;
    state.goldTile = 'W1';
    state.pendingClaim = null;
    state.currentDraw = { seatId: 1, tile: 'S6', ts: 1700000010201, reason: 'NORMAL' };
    state.hands['1'] = ['Z1', 'W2', 'W3', 'W4', 'T2', 'T3', 'T4', 'S2', 'S3', 'S4', 'W6', 'W7', 'W8', 'T6', 'T7', 'T8', 'S9'];
    state.shows['1'] = [];
    state.rivers['1'] = [];
    state.seatControls = { '0': 'human', '1': 'bot', '2': 'bot', '3': 'bot' };
    state.botActionReadyAt = 1700000010200;
    state.chuiFeng = {
        dealerDiscardCount: 2,
        targetTile: 'W9',
        followCount: 2,
        active: true,
        failed: false
    };

    const result = runBotTurns(state, seats, 1700000010600, 1);
    assert.equal(result.appliedSteps, 1);
    assert.equal(result.state.lastAction?.type, 'DISCARD');
    assert.equal(result.state.lastDiscard?.seatId, 1);
    assert.equal(result.state.lastDiscard?.tile, 'Z1');
}

function checkBotSkipsChiWhenItWouldDiscardSameClaimTile() {
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true),
        1: buildBotSeat('1'),
        2: buildHumanSeat('2', 'u3', 'C', true),
        3: buildHumanSeat('3', 'u4', 'D', true)
    };

    const state = createOnlineGameState({ seats, now: 1700000010800, dealerSeat: 0, roundNo: 1 });
    state.turnSeat = 0;
    state.phase = 'playing';
    state.goldRevealed = true;
    state.goldTile = 'W1';
    state.pendingClaim = null;
    state.currentDraw = { seatId: 0, tile: 'T5', ts: 1700000010801, reason: 'NORMAL' };
    state.hands['0'] = ['T5', 'W9'];
    state.hands['1'] = ['T5', 'T6', 'T7', 'W2', 'W3', 'W4', 'W3', 'W4', 'W5', 'S2', 'S3', 'S4', 'S2', 'S3', 'S4', 'W8'];
    state.hands['2'] = ['W2', 'W3'];
    state.hands['3'] = ['S7', 'S8'];
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();
    state.seatControls = { '0': 'human', '1': 'bot', '2': 'human', '3': 'human' };
    state.botClaimReadyAt = 1700000010800;

    const afterDiscard = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 1700000010802
    }, 1700000010802);

    assert.equal(!!afterDiscard.pendingClaim, true);
    assert.equal((afterDiscard.pendingClaim?.optionsBySeat?.['1']?.CHI || []).length > 0, true);

    const result = runBotTurns(afterDiscard, seats, 1700000010900, 1);
    assert.equal(result.appliedSteps, 1);
    assert.equal(result.state.pendingClaim, null);
    assert.equal(result.state.turnSeat, 1);
    assert.equal(result.state.shows['1'].length, 0);
    assert.equal(result.state.currentDraw?.seatId, 1);
    assert.equal(result.state.currentDraw?.reason, 'NORMAL');
}

function checkMultiHuPriorityBySeatDistance() {
    const state = makeBaseGameState();
    state.goldTile = 'Z7';
    state.roundCount = 1;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.wall = ['S1', 'S2', 'S3'];
    state.hands['0'] = ['T5', 'W3'];
    state.hands['1'] = ['W1', 'W1', 'W1', 'W2', 'W2', 'W2', 'W3', 'W3', 'W3', 'T2', 'T2', 'T2', 'S5', 'S5', 'S5', 'T5'];
    state.hands['2'] = ['W1', 'W1', 'W1', 'W2', 'W2', 'W2', 'W3', 'W3', 'W3', 'S2', 'S2', 'S2', 'T3', 'T3', 'T3', 'T5'];
    state.hands['3'] = ['W4'];
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();

    const afterDiscard = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 700
    }, 700);

    assert.equal(!!afterDiscard.pendingClaim, true);
    assert.equal(afterDiscard.pendingClaim?.optionsBySeat?.['1']?.HU, true);
    assert.equal(afterDiscard.pendingClaim?.optionsBySeat?.['2']?.HU, true);

    const afterSeat2Hu = applyOnlineGameAction(afterDiscard, {
        type: 'HU',
        seatId: 2,
        payload: {},
        ts: 701
    }, 701);
    assert.equal(!!afterSeat2Hu.pendingClaim, true);

    const settled = applyOnlineGameAction(afterSeat2Hu, {
        type: 'HU',
        seatId: 1,
        payload: {},
        ts: 702
    }, 702);

    assert.equal(settled.phase, 'ended');
    assert.equal(settled.outcome?.reason, 'DISCARD_HU');
    assert.equal(settled.outcome?.winner, 1);
    assert.equal(settled.outcome?.loser, 0);
}

function checkWhiteDragonAsGoldLogicForChi() {
    const state = makeBaseGameState();
    state.goldTile = 'W5';
    state.roundCount = 1;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.wall = ['S1', 'S2', 'S3'];
    state.hands['0'] = ['Z7', 'T1'];
    state.hands['1'] = ['W3', 'W4', 'T2', 'S9'];
    state.hands['2'] = ['W6'];
    state.hands['3'] = ['W7'];
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();

    const afterDiscard = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 750
    }, 750);

    assert.equal(!!afterDiscard.pendingClaim, true);
    const chiOptions = afterDiscard.pendingClaim?.optionsBySeat?.['1']?.CHI || [];
    assert.equal(Array.isArray(chiOptions), true);
    assert.equal(chiOptions.some((opt) => opt[0] === 'W3' && opt[1] === 'W4'), true);

    const afterChi = applyOnlineGameAction(afterDiscard, {
        type: 'CHI',
        seatId: 1,
        payload: { choice: ['W3', 'W4'] },
        ts: 751
    }, 751);

    assert.equal(afterChi.pendingClaim, null);
    assert.equal(afterChi.turnSeat, 1);
    assert.equal(afterChi.shows['1'][0].type, 'CHI');
    assert.equal(afterChi.shows['1'][0].tiles.includes('Z7'), true);
}

function checkClaimsKeepPhysicalGold() {
    for (const { hand, discard, gold = 'W5', type, choice, meld } of [
        { hand: ['W5', 'Z7', 'W4', 'T1'], discard: 'W3', type: 'CHI', choice: ['W4', 'W5'], meld: ['W3', 'W4', 'Z7'] },
        { hand: ['W5', 'Z7', 'Z7', 'T1'], discard: 'Z7', type: 'PENG', meld: ['Z7', 'Z7', 'Z7'] },
        { hand: ['W5', 'W4', 'T1'], discard: 'W3', type: 'CHI' },
        { hand: ['W5', 'W5', 'T1'], discard: 'Z7', type: 'PENG' },
        { hand: ['Z7', 'Z7', 'T1'], discard: 'Z7', gold: 'Z7', type: 'PENG' },
        { hand: ['W3', 'W4', 'Z7', 'Z7'], discard: 'W5', type: 'CHI' }
    ]) {
        const state = makeBaseGameState();
        state.goldTile = gold;
        state.roundCount = 3;
        state.seatControls = { '0': 'human', '1': 'human', '2': 'human', '3': 'human' };
        state.hands = { '0': [discard, 'T9'], '1': hand, '2': ['S1'], '3': ['S9'] };
        const pending = applyOnlineGameAction(state, {
            type: 'DISCARD', seatId: 0, payload: { index: 0 }, ts: 760
        }, 760);
        const options = pending.pendingClaim?.optionsBySeat?.['1'];
        if (!meld) {
            assert.equal(type === 'CHI' ? !!options?.CHI?.length : !!options?.PENG, false);
            const after = applyOnlineGameAction(pending, { type, seatId: 1, payload: { choice }, ts: 761 }, 761);
            assert.deepEqual(after.shows['1'], []);
            assert.deepEqual(after.hands['1'], pending.hands['1']);
            continue;
        }
        assert.ok(type === 'CHI' ? options?.CHI?.length : options?.PENG);
        const after = applyOnlineGameAction(pending, { type, seatId: 1, payload: { choice }, ts: 761 }, 761);
        assert.deepEqual([...after.shows['1'][0].tiles].sort(), [...meld].sort());
        assert.equal(after.hands['1'].filter(t => t === gold).length, hand.filter(t => t === gold).length);
    }
}

function checkWhiteDragonAsGoldLogicForHu() {
    const state = makeBaseGameState();
    state.goldTile = 'W5';
    state.roundCount = 1;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.wall = ['S1', 'S2', 'S3'];
    state.hands['0'] = ['Z7', 'T1'];
    state.hands['1'] = ['W1', 'W1', 'W1', 'W2', 'W2', 'W2', 'T2', 'T2', 'T2', 'S5', 'S5', 'S5', 'Z1', 'Z1', 'W3', 'W4'];
    state.hands['2'] = ['W6'];
    state.hands['3'] = ['W7'];
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();

    const afterDiscard = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 800
    }, 800);

    assert.equal(!!afterDiscard.pendingClaim, true);
    assert.equal(afterDiscard.pendingClaim?.discard?.tile, 'Z7');
    assert.equal(afterDiscard.pendingClaim?.optionsBySeat?.['1']?.HU, true);

    const settled = applyOnlineGameAction(afterDiscard, {
        type: 'HU',
        seatId: 1,
        payload: {},
        ts: 801
    }, 801);

    assert.equal(settled.phase, 'ended');
    assert.equal(settled.outcome?.reason, 'DISCARD_HU');
    assert.equal(settled.outcome?.winner, 1);
}

function checkYouJinStacksGangFlowerFromReplenish() {
    const state = makeBaseGameState();
    state.goldTile = 'W1';
    state.roundCount = 2;
    state.dealerSeat = 0;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.wall = ['S9', 'S8', 'S7'];
    state.hands['0'] = [
        'W1',
        'W2', 'W3', 'W4',
        'W2', 'W3', 'W4',
        'T2', 'T3', 'T4',
        'S2', 'S3', 'S4',
        'Z1', 'Z1', 'Z1',
        'T9'
    ];
    state.currentDraw = { seatId: 0, tile: 'T9', ts: 900, reason: 'GANG_FLOWER' };
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();

    const settled = applyOnlineGameAction(state, {
        type: 'HU',
        seatId: 0,
        payload: {},
        ts: 901
    }, 901);

    assert.equal(settled.phase, 'ended');
    assert.equal(settled.outcome?.isSelfDraw, true);
    assert.equal(Array.isArray(settled.outcome?.specialTypes), true);
    const types = settled.outcome?.specialTypes || [];
    assert.equal(types.includes('游金'), true);
    assert.equal(types.includes('杠上开花'), true);
    assert.equal(types.includes('花开富贵'), true);
}

function checkDoubleGoldCannotDiscardHu() {
    const state = makeBaseGameState();
    state.goldTile = 'W1';
    state.roundCount = 2;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.wall = ['S1', 'S2', 'S3'];
    state.hands['0'] = ['T9', 'W3'];
    state.hands['1'] = [
        'W1', 'W1',
        'W2', 'W3', 'W4',
        'W2', 'W3', 'W4',
        'T2', 'T3', 'T4',
        'S2', 'S3', 'S4',
        'Z1', 'Z1'
    ];
    state.hands['2'] = ['W6'];
    state.hands['3'] = ['W7'];
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();
    state.pendingClaim = null;
    state.currentDraw = { seatId: 0, tile: 'T9', ts: 920, reason: 'NORMAL' };

    const afterDiscard = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 921
    }, 921);

    const huOption = afterDiscard.pendingClaim?.optionsBySeat?.['1']?.HU;
    assert.equal(huOption, undefined);
}

function checkSanJinSelfDrawBonusWhenGoldDrawn() {
    const state = makeBaseGameState();
    state.goldTile = 'W1';
    state.roundCount = 1;
    state.dealerSeat = 0;
    state.dealerStreak = 0;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.scores = [0, 0, 0, 0];
    state.hands['0'] = [
        'W1', 'W1', 'W1',
        'W2', 'W3', 'W4',
        'T2', 'T3', 'T4',
        'S2', 'S3', 'S4',
        'Z1', 'Z1', 'Z1',
        'T9', 'T8'
    ];
    state.currentDraw = { seatId: 0, tile: 'W1', ts: 930, reason: 'NORMAL' };
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();

    const settled = applyOnlineGameAction(state, {
        type: 'HU',
        seatId: 0,
        payload: {},
        ts: 931
    }, 931);

    assert.equal(settled.phase, 'ended');
    assert.equal(settled.outcome?.isSelfDraw, true);
    assert.equal(settled.outcome?.scoreAsSelfDraw, true);
    assert.equal(settled.outcome?.specialTypes.includes('三金倒'), true);
    assert.equal(settled.scores[0], 72);
    assert.equal(settled.scores[1], -24);
    assert.equal(settled.scores[2], -24);
    assert.equal(settled.scores[3], -24);
}

function checkSanJinNoSelfDrawBonusWhenNonGoldDrawn() {
    const state = makeBaseGameState();
    state.goldTile = 'W1';
    state.roundCount = 1;
    state.dealerSeat = 0;
    state.dealerStreak = 0;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.scores = [0, 0, 0, 0];
    state.hands['0'] = [
        'W1', 'W1', 'W1',
        'W2', 'W3', 'W4',
        'T2', 'T3', 'T4',
        'S2', 'S3', 'S4',
        'Z1', 'Z1', 'Z1',
        'T9', 'T8'
    ];
    state.currentDraw = { seatId: 0, tile: 'T9', ts: 940, reason: 'NORMAL' };
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();

    const settled = applyOnlineGameAction(state, {
        type: 'HU',
        seatId: 0,
        payload: {},
        ts: 941
    }, 941);

    assert.equal(settled.phase, 'ended');
    assert.equal(settled.outcome?.isSelfDraw, true);
    assert.equal(settled.outcome?.scoreAsSelfDraw, false);
    assert.equal(settled.outcome?.specialTypes.includes('三金倒'), true);
    assert.equal(settled.scores[0], 48);
    assert.equal(settled.scores[1], -16);
    assert.equal(settled.scores[2], -16);
    assert.equal(settled.scores[3], -16);
}

function checkNormalHuAddsRoundAndGangTypes() {
    const state = makeBaseGameState();
    state.goldTile = 'W1';
    state.roundCount = 0;
    state.dealerSeat = 0;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.hands['0'] = ['W2', 'W2', 'W2', 'W3', 'W3', 'W3', 'W4', 'W4', 'W4', 'T2', 'T2', 'T2', 'S5', 'S5', 'S5', 'Z1', 'Z1'];
    state.currentDraw = { seatId: 0, tile: 'Z1', ts: 950, reason: 'GANG' };
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();

    const settled = applyOnlineGameAction(state, {
        type: 'HU',
        seatId: 0,
        payload: {},
        ts: 951
    }, 951);

    const types = settled.outcome?.specialTypes || [];
    assert.equal(types.includes('天胡'), true);
    assert.equal(types.includes('杠上开花'), true);
}

function checkSanJinFirstRoundNoGangFlowerStack() {
    const state = makeBaseGameState();
    state.goldTile = 'W1';
    state.roundCount = 0;
    state.dealerSeat = 0;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.hands['0'] = [
        'W1', 'W1', 'W1',
        'W2', 'W3', 'W4',
        'T2', 'T3', 'T4',
        'S2', 'S3', 'S4',
        'Z1', 'Z1', 'Z1',
        'T9', 'T8'
    ];
    state.currentDraw = { seatId: 0, tile: 'W1', ts: 960, reason: 'NORMAL' };
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();

    const settled = applyOnlineGameAction(state, {
        type: 'HU',
        seatId: 0,
        payload: {},
        ts: 961
    }, 961);

    const types = settled.outcome?.specialTypes || [];
    assert.equal(types.includes('三金倒'), false);
    assert.equal(types.includes('天胡'), true);
    assert.equal(types.includes('杠上开花'), false);
    assert.equal(types.includes('花开富贵'), false);
}

function checkSanJinStacksGangFlowerFromReplenish() {
    const state = makeBaseGameState();
    state.goldTile = 'W1';
    state.roundCount = 2;
    state.dealerSeat = 0;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.hands['0'] = [
        'W1', 'W1', 'W1',
        'W2', 'W3', 'W4',
        'T2', 'T3', 'T4',
        'S2', 'S3', 'S4',
        'Z1', 'Z1', 'Z1',
        'T9', 'T8'
    ];
    state.currentDraw = { seatId: 0, tile: 'W1', ts: 970, reason: 'GANG_FLOWER' };
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();

    const settled = applyOnlineGameAction(state, {
        type: 'HU',
        seatId: 0,
        payload: {},
        ts: 971
    }, 971);

    const types = settled.outcome?.specialTypes || [];
    assert.equal(types.includes('三金倒'), true);
    assert.equal(types.includes('天胡'), false);
    assert.equal(types.includes('地胡'), false);
    assert.equal(types.includes('杠上开花'), true);
    assert.equal(types.includes('花开富贵'), true);
}

function checkSanJinMandatoryHuBlocksDiscard() {
    const state = makeBaseGameState();
    state.goldTile = 'W1';
    state.roundCount = 1;
    state.turnSeat = 0;
    state.seatControls = {
        '0': 'human',
        '1': 'human',
        '2': 'human',
        '3': 'human'
    };
    state.hands['0'] = [
        'W1', 'W1', 'W1',
        'W2', 'W3', 'W4',
        'T2', 'T3', 'T4',
        'S2', 'S3', 'S4',
        'Z1', 'Z1', 'Z1',
        'T9', 'T8'
    ];
    state.currentDraw = { seatId: 0, tile: 'W1', ts: 980, reason: 'NORMAL' };
    state.rivers = emptySeatMap();
    state.shows = emptySeatMap();
    state.flowers = emptySeatMap();

    const beforeHand = [...state.hands['0']];
    const afterDiscard = applyOnlineGameAction(state, {
        type: 'DISCARD',
        seatId: 0,
        payload: { index: 0 },
        ts: 981
    }, 981);

    assert.equal(afterDiscard.phase, 'playing');
    assert.deepEqual(afterDiscard.hands['0'], beforeHand);
    assert.equal(afterDiscard.turnSeat, 0);
    assert.equal(afterDiscard.lastDiscard, null);
}

function checkMalformedStateShapeDoesNotCrashProcessing() {
    const now = 1700000011000;
    const seats = {
        0: buildHumanSeat('0', 'u1', 'A', true, now),
        1: buildBotSeat('1', now),
        2: buildHumanSeat('2', 'u3', 'C', true, now),
        3: buildHumanSeat('3', 'u4', 'D', true, now)
    };

    const malformed = {
        phase: 'playing',
        turnSeat: 0,
        dealerSeat: 0,
        dealerStreak: 0,
        roundNo: 1,
        roundCount: 0,
        seatControls: {
            '0': 'human',
            '1': 'bot',
            '2': 'human',
            '3': 'human'
        },
        scores: [0, 0, 0, 0],
        wall: ['W2', 'W3', 'W4']
    };

    const afterDraw = applyOnlineGameAction(malformed, {
        type: 'FLOWER_REPLENISH',
        seatId: 0,
        payload: {},
        ts: now
    }, now);

    assert.equal(Array.isArray(afterDraw.hands?.['0']), true);
    assert.equal(Array.isArray(afterDraw.rivers?.['0']), true);
    assert.equal(Array.isArray(afterDraw.shows?.['0']), true);
    assert.equal(Array.isArray(afterDraw.flowers?.['0']), true);

    const actions = {
        malformedAction: {
            status: 'pending',
            createdAt: 1,
            action: { type: 'DISCARD', seatId: 0, payload: { index: 0 } }
        }
    };

    const processed = processPendingActionMap(
        actions,
        'host-1',
        malformed,
        20,
        seats,
        defaultStateReducer,
        now + 1
    );

    assert.equal(processed.changed, true);
    assert.equal(processed.actionPatch.malformedAction, null);
    assert.equal(processed.removedActionCount >= 1, true);
    assert.equal(Array.isArray(processed.gameState.hands?.['0']), true);
    assert.equal(Array.isArray(processed.gameState.rivers?.['0']), true);
}

checkSeatIds();
checkNormalizeSeatsForStart();
checkSyncSeatControls();
checkSyncSeatControlRecovery();
checkHostElection();
checkStartedGameState();
checkFirstDealerUsesHostSeat();
checkOpenGoldRevealFlow();
checkDealerOnlyActionsInReducer();
checkPendingActionProcessing();
checkBotClaimResolution();
checkClaimTimeoutWaitForHuman();
checkBotClaimResolutionAcrossSeatPositions();
checkClaimPriorityHuOverPengAndChi();
checkOfflineTakeoverResolvesPendingClaim();
checkReconnectStopsBotAutoClaim();
checkSelfHuSettlement();
checkRoundStartCarryScoreAndDealer();
checkAnGangAction();
checkBuGangAction();
checkQiangGangHuFromBuGang();
checkQiangGangPassCompletesBuGang();
checkQiangGangHuFromAnGang();
checkChuiFengSettlement();
checkChuiFengFailNoSettlement();
checkBotMustFollowChuiFengWhenPossible();
checkBotDiscardPrefersIsolatedHonor();
checkBotSkipsChiWhenItWouldDiscardSameClaimTile();
checkMultiHuPriorityBySeatDistance();
checkWhiteDragonAsGoldLogicForChi();
checkClaimsKeepPhysicalGold();
checkWhiteDragonAsGoldLogicForHu();
checkYouJinStacksGangFlowerFromReplenish();
checkDoubleGoldCannotDiscardHu();
checkSanJinSelfDrawBonusWhenGoldDrawn();
checkSanJinNoSelfDrawBonusWhenNonGoldDrawn();
checkNormalHuAddsRoundAndGangTypes();
checkSanJinFirstRoundNoGangFlowerStack();
checkSanJinStacksGangFlowerFromReplenish();
checkSanJinMandatoryHuBlocksDiscard();
checkMalformedStateShapeDoesNotCrashProcessing();

console.log('room-reducer checks passed');
