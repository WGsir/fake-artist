// ============================================================
// Fake Artist - game.js
// 遊戲狀態機（Host 端執行）
// ============================================================

class GameHost {

    constructor() {
        // ---- Game state ----
        this.state = "lobby";          // lobby | playing | voting | fake-guessing | game-over
        this.word = "";                // 完整題目（如「大象」）
        this.category = "";           // 類別（如「動物」）
        this.totalRounds = 2;         // 總繪圖輪數
        this.currentRound = 0;        // 目前第幾輪
        this.fakeArtistPeerId = null; // 偽藝術家的 peerId

        // ---- Player game data (extends peer player list) ----
        // Map<peerId, { name, color, role, hasDrawn, votesReceived }>
        this.players = new Map();

        // ---- Turn management ----
        this.currentTurnPeerId = null;
        this.drawnThisRound = new Set();   // peerIds that have drawn in current round
        this.drawingOrder = [];            // order of drawing for current round

        // ---- Voting ----
        this.votes = new Map();            // voterPeerId → votedPeerId
        this.fakeGuess = null;
    }

    // ================================================================
    //  INIT / RESET
    // ================================================================

    reset() {
        this.state = "lobby";
        this.word = "";
        this.category = "";
        this.totalRounds = 2;
        this.currentRound = 0;
        this.fakeArtistPeerId = null;
        this.players.clear();
        this.currentTurnPeerId = null;
        this.drawnThisRound.clear();
        this.drawingOrder = [];
        this.votes.clear();
        this.fakeGuess = null;
    }

    // ================================================================
    //  PLAYER MANAGEMENT
    // ================================================================

    addPlayer(peerId, name) {
        // Idempotent — don't re-add existing players
        if (this.players.has(peerId)) return;

        const colors = [
            "#E74C3C", "#3498DB", "#2ECC71", "#F39C12", "#9B59B6",
            "#1ABC9C", "#E67E22", "#E91E63", "#00BCD4", "#FF5722",
        ];
        const colorIndex = this.players.size % colors.length;

        this.players.set(peerId, {
            peerId,
            name,
            color: colors[colorIndex],
            role: "real",           // assigned later
            hasDrawn: false,
            votesReceived: 0,
        });

        this._broadcastPlayerList();
    }

    removePlayer(peerId) {
        this.players.delete(peerId);
        this.drawnThisRound.delete(peerId);
        this.drawingOrder = this.drawingOrder.filter(id => id !== peerId);
        this.votes.delete(peerId);

        // If fake artist left, reassign?
        if (peerId === this.fakeArtistPeerId && this.state === "playing") {
            // Pick new fake artist among remaining real artists
            this._assignFakeArtist();
        }

        // If current turn player left, advance turn
        if (peerId === this.currentTurnPeerId) {
            this._advanceTurn();
        }

        this._broadcastPlayerList();
    }

    _assignFakeArtist() {
        const realPlayers = [...this.players.values()].filter(p => p.role === "real");
        if (realPlayers.length === 0) return;

        // Reset all roles
        this.players.forEach(p => p.role = "real");

        const fake = realPlayers[Math.floor(Math.random() * realPlayers.length)];
        fake.role = "fake";
        this.fakeArtistPeerId = fake.peerId;
        console.log("[Game] Fake artist assigned:", fake.name, "(peer:", fake.peerId + ")");
    }

    // ================================================================
    //  START GAME
    // ================================================================

    startGame(word, category, rounds) {
        if (this.players.size < CONFIG.GAME.MIN_PLAYERS) {
            console.warn("[Game] Not enough players");
            return false;
        }

        this.word = word;
        this.category = category;
        this.totalRounds = rounds || CONFIG.GAME.DRAW_ROUNDS;
        this.currentRound = 1;
        this.state = "playing";

        // Reset player game state
        this.players.forEach(p => {
            p.role = "real";
            p.hasDrawn = false;
            p.votesReceived = 0;
        });
        this.drawnThisRound.clear();
        this.drawingOrder = [];
        this.votes.clear();
        this.fakeGuess = null;

        // Pick fake artist
        this._assignFakeArtist();

        // Send prompts to each player
        this.players.forEach((p, peerId) => {
            const isFake = p.role === "fake";
            const msg = {
                type: "your-prompt",
                word: isFake ? null : this.word,
                category: this.category,
                wordLength: this.word.length,    // fake artist knows word length
                isFake: isFake,
            };

            if (peerId === peerManager.myPeerId) {
                // Host is a player too — process locally
                this._handlePromptLocally(msg);
            } else {
                peerManager.sendToPeer(msg, peerId);
            }
        });

        // Broadcast game start
        peerManager.broadcastToAll({
            type: "game-start",
            round: 1,
            totalRounds: this.totalRounds,
        });

        // Handle host's own prompt locally
        // Already handled above

        // Start first turn
        this._advanceTurn();

        return true;
    }

    _handlePromptLocally(msg) {
        // This is called on the host when host is also a player
        // The app.js should have a handler for this
        if (typeof onGamePrompt === "function") {
            onGamePrompt(msg);
        }
    }

    // ================================================================
    //  TURN MANAGEMENT
    // ================================================================

    _advanceTurn() {
        if (this.state !== "playing") return;

        // Check if all players have drawn this round
        const undrawnPlayers = [...this.players.keys()].filter(
            id => !this.drawnThisRound.has(id)
        );

        if (undrawnPlayers.length === 0) {
            // Round complete
            this.currentRound++;
            if (this.currentRound > this.totalRounds) {
                // All rounds done → voting
                this._startVoting();
                return;
            }

            // Start new round — reset drawn status
            this.drawnThisRound.clear();
            this.drawingOrder = [];
            const newUndrawn = [...this.players.keys()];

            // Pick next player (different from last round's first if possible)
            this._pickNextTurn(newUndrawn);
        } else {
            this._pickNextTurn(undrawnPlayers);
        }
    }

    _pickNextTurn(candidates) {
        if (candidates.length === 0) return;

        // Prefer someone who hasn't been first before, else random
        const prevFirst = this.drawingOrder.length > 0 ? this.drawingOrder[0] : null;
        const nonFirst = candidates.filter(id => id !== prevFirst);

        const pool = nonFirst.length > 0 ? nonFirst : candidates;
        const nextId = pool[Math.floor(Math.random() * pool.length)];

        this.currentTurnPeerId = nextId;
        this.drawnThisRound.add(nextId);
        this.drawingOrder.push(nextId);

        // Notify all clients
        const turnPlayer = this.players.get(nextId);
        const turnMsg = {
            type: "turn-change",
            peerId: nextId,
            name: turnPlayer ? turnPlayer.name : "Unknown",
            round: this.currentRound,
            totalRounds: this.totalRounds,
        };
        peerManager.broadcastToAll(turnMsg);

        // Re-broadcast player list with updated currentTurnPeerId
        this._broadcastPlayerList();

        // Also notify host UI (host doesn't receive its own broadcast)
        if (typeof onTurnChange === "function") {
            onTurnChange(turnMsg);
        }

        // If host is the turn player, enable drawing
        if (nextId === peerManager.myPeerId) {
            this._notifyMyTurn();
        }
    }

    _notifyMyTurn() {
        if (typeof onMyTurn === "function") {
            onMyTurn();
        }
    }

    // ================================================================
    //  HANDLE CLIENT MESSAGES
    // ================================================================

    handleMessage(msg, fromPeerId) {
        switch (msg.type) {

            case "join":
                this.addPlayer(fromPeerId, msg.name);
                break;

            case "stroke-batch":
                // Relay incremental batch to all OTHER players
                peerManager.broadcastExcept({
                    type: "stroke-relay-batch",
                    strokeData: msg.strokeData || msg,
                    fromPeerId: fromPeerId,
                }, fromPeerId);
                break;

            case "stroke-full":
                // Relay complete stroke to all OTHER players
                peerManager.broadcastExcept({
                    type: "stroke-relay",
                    strokeData: msg.strokeData || msg,
                    fromPeerId: fromPeerId,
                }, fromPeerId);
                break;

            case "canvas-action":
                // Relay non-stroke canvas operations. The host applies the
                // action locally in app.js after this method returns.
                peerManager.broadcastExcept({
                    type: "canvas-relay-action",
                    action: msg.action,
                    fromPeerId: fromPeerId,
                }, fromPeerId);
                break;

            case "player-done":
                // Only accept from current turn player
                if (fromPeerId !== this.currentTurnPeerId) {
                    console.warn("[Game] player-done from non-current player:", fromPeerId);
                    break;
                }
                this.players.get(fromPeerId).hasDrawn = true;
                this._advanceTurn();
                break;

            case "vote":
                // Record vote
                this.votes.set(fromPeerId, msg.votedPeerId);
                console.log("[Game] Vote:", fromPeerId, "→", msg.votedPeerId);

                // Check if all votes are in
                if (this.votes.size >= this.players.size) {
                    this._resolveVotes();
                }
                break;

            case "fake-guess":
                this.fakeGuess = msg.guess;
                this._resolveFakeGuess();
                break;

            default:
                console.warn("[Game] Unknown message type:", msg.type);
        }
    }

    // ================================================================
    //  VOTING
    // ================================================================

    _startVoting() {
        this.state = "voting";
        this.votes.clear();

        peerManager.broadcastToAll({
            type: "voting-start",
            players: this.getPlayerListForVoting(),
        });

        // If host is a player, also show vote UI locally
        if (this.players.has(peerManager.myPeerId)) {
            if (typeof onVotingStart === "function") {
                onVotingStart(this.getPlayerListForVoting());
            }
        }
    }

    getPlayerListForVoting() {
        return [...this.players.values()].map(p => ({
            peerId: p.peerId,
            name: p.name,
            color: p.color,
        }));
    }

    _resolveVotes() {
        // Tally votes
        this.players.forEach(p => p.votesReceived = 0);
        this.votes.forEach((votedPeerId) => {
            const p = this.players.get(votedPeerId);
            if (p) p.votesReceived++;
        });

        // Find player with most votes
        let maxVotes = 0;
        let accusedPeerId = null;
        this.players.forEach((p, peerId) => {
            if (p.votesReceived > maxVotes) {
                maxVotes = p.votesReceived;
                accusedPeerId = peerId;
            }
        });

        // Handle ties: if multiple have same max votes, pick the first (or random)
        const tiedPlayers = [...this.players.values()].filter(p => p.votesReceived === maxVotes);
        if (tiedPlayers.length > 1) {
            accusedPeerId = tiedPlayers[Math.floor(Math.random() * tiedPlayers.length)].peerId;
        }

        const accusedPlayer = this.players.get(accusedPeerId);

        // Broadcast vote results
        const voteResults = [...this.players.values()].map(p => ({
            peerId: p.peerId,
            name: p.name,
            count: p.votesReceived,
        }));

        peerManager.broadcastToAll({
            type: "vote-result",
            accusedPeerId: accusedPeerId,
            accusedName: accusedPlayer ? accusedPlayer.name : "Unknown",
            votes: voteResults,
        });

        if (accusedPeerId === this.fakeArtistPeerId) {
            // Fake artist caught! They get to guess the word
            this.state = "fake-guessing";

            // Send guess prompt to fake artist only
            const fakePlayer = this.players.get(this.fakeArtistPeerId);
            const guessMsg = {
                type: "fake-guess-prompt",
                category: this.category,
                wordLength: this.word.length,
            };

            if (this.fakeArtistPeerId === peerManager.myPeerId) {
                // Host is the fake artist
                if (typeof onFakeGuessPrompt === "function") {
                    onFakeGuessPrompt(this.category, this.word.length);
                }
            } else {
                peerManager.sendToPeer(guessMsg, this.fakeArtistPeerId);
            }
        } else {
            // Wrong person accused → fake artist wins!
            this._endGame(true);
        }
    }

    _resolveFakeGuess() {
        const correct = this.fakeGuess === this.word;
        this._endGame(correct); // fakeArtistWon = correct (they guessed right)
    }

    _endGame(fakeArtistWon) {
        this.state = "game-over";

        const fakePlayer = this.players.get(this.fakeArtistPeerId);
        const voteResults = [...this.players.values()].map(p => ({
            peerId: p.peerId,
            name: p.name,
            count: p.votesReceived,
        }));

        const result = {
            type: "game-over",
            fakeArtistWon: fakeArtistWon,
            word: this.word,
            category: this.category,
            fakeArtist: fakePlayer ? fakePlayer.name : "Unknown",
            fakeArtistPeerId: this.fakeArtistPeerId,
            fakeGuess: this.fakeGuess,
            fakeCorrect: this.fakeGuess === this.word,
            votes: voteResults,
            allPlayers: [...this.players.values()].map(p => ({
                peerId: p.peerId,
                name: p.name,
                role: p.role,
                color: p.color,
            })),
        };

        peerManager.broadcastToAll(result);

        // Show on host too
        if (typeof onGameOver === "function") {
            onGameOver(result);
        }
    }

    // ================================================================
    //  PLAYER LIST BROADCAST
    // ================================================================

    _broadcastPlayerList() {
        const list = [...this.players.values()].map(p => ({
            peerId: p.peerId,
            name: p.name,
            color: p.color,
            hasDrawn: p.hasDrawn,
        }));

        peerManager.broadcastToAll({
            type: "player-list",
            players: list,
            currentTurnPeerId: this.currentTurnPeerId,
        });
    }
}

// ---- Singleton (only instantiated on Host) ----
let gameHost = null;

// ---- Global callbacks for host-as-player scenarios ----
// These are set by app.js
let onGamePrompt = null;      // (msg) — when host receives their own prompt
let onMyTurn = null;          // () — when it becomes host's turn
let onTurnChange = null;      // (msg) — when turn changes (host UI update)
let onVotingStart = null;     // (players) — when voting starts (host as player)
let onFakeGuessPrompt = null; // (category, wordLength) — host is the fake artist
let onGameOver = null;        // (result) — game over screen
