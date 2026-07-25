// ============================================================
// Fake Artist - app.js
// 應用程式入口 — 初始化、模式切換、事件綁定
// ============================================================

(function () {
    "use strict";

    // ---- Module-local state ----
    // Note: drawingCanvas / peerManager / gameHost are global on canvas.js / peer.js / game.js
    let hostPendingName = "";
    let hostCreateRetries = 0;

    // ---- Bootstrap ----
    function init() {
        // 1. Init drawing canvas
        const canvasEl = document.getElementById("drawing-canvas");
        const canvasFrame = document.getElementById("canvas-frame");
        drawingCanvas = new DrawingCanvas(canvasEl, canvasFrame);

        // 2. Init peer manager
        peerManager = new PeerManager();

        // 3. Init UI
        UI.init();
        UI.setCanvasEnabled(true); // enabled until game restricts it

        // 4. Wire up UI callbacks
        UI._onToolChange = onToolChange;
        UI._onBrushSizeChange = onBrushSizeChange;
        UI._onDoneDrawing = onDoneDrawing;
        UI._onCreateRoom = onCreateRoom;
        UI._onJoinRoom = onJoinRoom;
        UI._onStartGame = onStartGame;
        UI._onVote = onVote;
        UI._onFakeGuess = onFakeGuess;
        UI._onPlayAgain = onPlayAgain;

        // 5. Wire up canvas callbacks
        drawingCanvas.onLocalStrokeComplete = onLocalStrokeComplete;
        drawingCanvas.onLocalStrokeBatch = onLocalStrokeBatch;
        drawingCanvas.onLocalCanvasAction = onLocalCanvasAction;

        // 6. Wire up peer callbacks
        peerManager.onPlayerJoin = onPlayerJoin;
        peerManager.onPlayerLeave = onPlayerLeave;
        peerManager.onHostMessage = onHostMessage;
        peerManager.onClientMessage = onClientMessage;
        peerManager.onConnected = onConnectedToHost;
        peerManager.onDisconnected = onDisconnectedFromHost;
        peerManager.onError = onPeerError;
        peerManager.onHostReady = onHostReady;

        // 7. Wire up game host-as-player callbacks
        onGamePrompt = handleGamePrompt;
        onMyTurn = handleMyTurn;
        onTurnChange = handleTurnChange;
        onVotingStart = handleVotingStart;
        onFakeGuessPrompt = handleFakeGuessPrompt;
        onGameOver = handleGameOver;

        // 8. Show initial room dialog (entry choice)
        UI.showEntryDialog();

        console.log("[App] Fake Artist initialized!");
    }

    // ================================================================
    //  CANVAS CALLBACKS
    // ================================================================

    function onToolChange(tool) {
        // Could update UI or send to host if needed
    }

    function onBrushSizeChange(size) {
        // Local only
    }

    function onLocalStrokeBatch(batchData) {
        // Send stroke batch to host for real-time relay
        if (!peerManager || !peerManager.isHost) {
            peerManager.sendToHost({
                type: "stroke-batch",
                strokeData: batchData,
            });
        } else {
            peerManager.broadcastExcept({
                type: "stroke-relay-batch",
                strokeData: batchData,
                fromPeerId: peerManager.myPeerId,
            }, peerManager.myPeerId);
        }
    }

    function onLocalStrokeComplete(strokeData) {
        // Send stroke to host for relay
        if (!peerManager || !peerManager.isHost) {
            // Client: send to host
            peerManager.sendToHost({
                type: "stroke-full",
                strokeData: strokeData,
            });
        } else {
            // Host: relay to other players directly
            peerManager.broadcastExcept({
                type: "stroke-relay",
                strokeData: strokeData,
                fromPeerId: peerManager.myPeerId,
            }, peerManager.myPeerId);
        }
    }

    // ---- Canvas actions (fill, undo, redo, clear) ----
    // These are small semantic operations instead of whole-canvas bitmaps,
    // which keeps them reliable even after a large flood fill.
    function onLocalCanvasAction(action) {
        if (!peerManager) return;
        if (!peerManager.isHost) {
            peerManager.sendToHost({ type: "canvas-action", action: action });
        } else {
            peerManager.broadcastExcept({
                type: "canvas-relay-action",
                action: action,
                fromPeerId: peerManager.myPeerId,
            }, peerManager.myPeerId);
        }
    }

    // ================================================================
    //  ROOM CALLBACKS
    // ================================================================

    // ---- Host ----
    function generateRoomCode() {
        const cs = CONFIG.ROOM_CODE.CHARSET;
        const len = CONFIG.ROOM_CODE.LENGTH;
        let out = "";
        for (let i = 0; i < len; i++) {
            out += cs[Math.floor(Math.random() * cs.length)];
        }
        return out;
    }

    function _hostLobbyPlayers() {
        const hostSelf = {
            peerId: peerManager.myPeerId,
            name: peerManager.myName,
            color: "#3498DB",
            isMe: true,
            isHost: true,
        };
        const others = Array.from(peerManager.connections.values()).map(conn => ({
            peerId: conn.peer,
            name: conn.metadata ? conn.metadata.name : "Unknown",
            color: "#FFC080",
            isMe: false,
            isHost: false,
        }));
        return [hostSelf, ...others];
    }

    function onCreateRoom() {
        const { playerName } = UI.getRoomCreateInput();
        if (!playerName) {
            alert("請輸入你的名稱！");
            return;
        }

        // 生成房間代碼並嘗試建立；若碰撞則由 onPeerError 重試
        hostPendingName = playerName;
        hostCreateRetries = 0;
        startHostWithGeneratedCode();
    }

    function startHostWithGeneratedCode() {
        const code = generateRoomCode();
        hostCreateRetries += 1;
        UI.showConnecting("正在建立房間代碼 " + code + "...");
        peerManager.createHost(code, hostPendingName);
    }

    function onHostReady(roomCode, peerId) {
        // Peer 已開通，可安全顯示 share 對話
        UI.showRoomShare(roomCode, _hostLobbyPlayers());
        UI.updatePlayerCount(peerManager.getPlayerCount());
        UI.updatePlayerList(_hostLobbyPlayers(), null);
        UI.updateRoomStatus("房間代碼: " + roomCode + " (Host)");
    }

    // ---- Join (client) ----
    function onJoinRoom() {
        const { roomCode, playerName } = UI.getRoomJoinInput();
        if (!roomCode) {
            alert("請輸入房間代碼！");
            UI.showJoinRoomDialog();
            return;
        }
        if (roomCode.length !== CONFIG.ROOM_CODE.LENGTH) {
            alert("房間代碼必須是 " + CONFIG.ROOM_CODE.LENGTH + " 個字元！");
            UI.showJoinRoomDialog();
            return;
        }
        if (!playerName) {
            alert("請輸入你的名稱！");
            return;
        }

        peerManager.joinRoom(roomCode, playerName);
        UI.showConnecting("正在連線到房間 " + roomCode + "...");
        UI.updateRoomStatus("連線中...");
    }

    // ================================================================
    //  PEER CALLBACKS
    // ================================================================

    function onPlayerJoin(peerId, name) {
        // Prevent late joins after game starts
        if (gameHost && gameHost.state !== "lobby") {
            console.warn("[App] Player tried to join during game:", peerId);
            // Send rejection message
            peerManager.sendToPeer({ type: "join-rejected", reason: "遊戲已開始" }, peerId);
            return;
        }

        if (gameHost) {
            gameHost.addPlayer(peerId, name);
        }
        const count = peerManager.getPlayerCount();
        UI.updatePlayerCount(count);
        const lobbyPlayers = _hostLobbyPlayers();
        UI.updatePlayerList(lobbyPlayers, null);
        // 同步更新 share 對話框中的玩家列表
        if (UI._isHost) {
            UI.updateLobbyPlayers(lobbyPlayers);
            UI.updateLobbyCount(count);
        }
    }

    function onPlayerLeave(peerId) {
        if (gameHost) {
            gameHost.removePlayer(peerId);
        }
        const count = peerManager.getPlayerCount();
        UI.updatePlayerCount(count);
        const lobbyPlayers = _hostLobbyPlayers();
        UI.updatePlayerList(lobbyPlayers,
            gameHost ? gameHost.currentTurnPeerId : null);
        // 同步更新 share 對話框中的玩家列表
        if (UI._isHost) {
            UI.updateLobbyPlayers(lobbyPlayers);
            UI.updateLobbyCount(count);
        }
    }

    function onHostMessage(msg) {
        // Client received message from host
        console.log("[App] Client received:", msg.type);

        switch (msg.type) {
            case "welcome":
                UI.updateRoomStatus("已連線 — 房間: " + peerManager.hostConn.peer);
                UI.updatePlayerList(msg.players.map(p => ({
                    ...p,
                    isMe: p.peerId === peerManager.myPeerId,
                    hasDrawn: false,
                })), null);
                UI.updatePlayerCount(msg.players.length);
                break;

            case "player-list":
                UI.updatePlayerList(msg.players.map(p => ({
                    ...p,
                    isMe: p.peerId === peerManager.myPeerId,
                })), msg.currentTurnPeerId);
                UI.updatePlayerCount(msg.players.length);
                break;

            case "game-start":
                drawingCanvas.resetCanvas();
                UI.setCanvasEnabled(false);
                UI.showDoneDrawingButton(false);
                UI.updateStatus("tool", "等待題目...");
                break;

            case "your-prompt":
                handleGamePrompt(msg);
                break;

            case "turn-change":
                handleTurnChange(msg);
                break;

            case "stroke-relay":
                if (msg.strokeData && msg.fromPeerId !== peerManager.myPeerId) {
                    drawingCanvas.drawRemoteStroke(msg.strokeData);
                }
                break;

            case "stroke-relay-batch":
                if (msg.strokeData && msg.fromPeerId !== peerManager.myPeerId) {
                    drawingCanvas.drawRemoteStrokeBatch(msg.strokeData);
                }
                break;

            case "canvas-relay-action":
                if (msg.action && msg.fromPeerId !== peerManager.myPeerId) {
                    drawingCanvas.applyRemoteCanvasAction(msg.action);
                }
                break;

            case "voting-start":
                handleVotingStart(msg.players);
                break;

            case "vote-result":
                // Show vote results but wait for game-over for final result
                UI.updateStatus("tool", `被指控: ${msg.accusedName}`);
                break;

            case "fake-guess-prompt":
                handleFakeGuessPrompt(msg.category, msg.wordLength);
                break;

            case "game-over":
                handleGameOver(msg);
                break;

            case "join-rejected":
                UI.closeDialog();
                alert("無法加入：遊戲已經開始了！");
                UI.updateRoomStatus("未連線");
                break;

            default:
                console.warn("[App] Unknown host message:", msg.type);
        }
    }

    function onClientMessage(msg, fromPeerId) {
        // Host received message from a client
        if (gameHost) {
            gameHost.handleMessage(msg, fromPeerId);
        }

        // Also draw strokes on host canvas
        switch (msg.type) {
            case "stroke-batch":
                if (msg.strokeData) {
                    drawingCanvas.drawRemoteStrokeBatch(msg.strokeData);
                }
                break;
            case "stroke-full":
                if (msg.strokeData) {
                    drawingCanvas.drawRemoteStroke(msg.strokeData); // smooth replay
                }
                break;
            case "canvas-action":
                if (msg.action) {
                    drawingCanvas.applyRemoteCanvasAction(msg.action);
                }
                break;
        }
    }

    function onConnectedToHost() {
        console.log("[App] Connected to host!");
        UI.closeDialog();
        const code = peerManager.roomCode || "?";
        UI.updateRoomStatus("已連線 — 房間代碼: " + code);
    }

    function onDisconnectedFromHost() {
        UI.updateRoomStatus("已斷線");
        UI.updatePlayerCount(0);
        UI.updatePlayerList([], null);
        UI.setCanvasEnabled(false);
        alert("與 Host 的連線已中斷。");
    }

    function onPeerError(err) {
        console.error("[App] Peer error:", err);

        // Host 端：房間代碼撞號 → 重新產生代碼再試
        if (peerManager.isHost && err.type === "unavailable-id") {
            if (hostCreateRetries < CONFIG.ROOM_CODE.COLLISION_RETRIES) {
                console.warn("[App] Room code collision, retrying (" +
                    hostCreateRetries + "/" + CONFIG.ROOM_CODE.COLLISION_RETRIES + ")");
                // 清掉舊 peer 再重試
                try { peerManager.disconnect(); } catch (e) { /* ignore */ }
                startHostWithGeneratedCode();
                return;
            }
            UI.closeDialog();
            alert("連續產生房間代碼都發生碰撞，請稍後再試。");
            return;
        }

        // Client 端的錯誤
        if (err.type === "peer-unavailable") {
            UI.closeDialog();
            UI.updateRoomStatus("未連線");
            alert("找不到這個房間代碼！\n" +
                "請確認 6 位英數代碼是否正確（不分大小寫），\n" +
                "或請房主重新分享代碼。");
            UI.showJoinRoomDialog();
            return;
        }

        if (err.type === "unavailable-id") {
            UI.closeDialog();
            alert("無法建立連線，請稍後再試。");
        } else {
            // 連線中其他錯誤：關掉 spinner 視窗
            UI.closeDialog();
        }
    }

    // ================================================================
    //  GAME CALLBACKS (Host-as-player scenarios)
    // ================================================================

    function handleGamePrompt(msg) {
        UI.showYourPrompt(msg.word, msg.category);
        UI.updateStatus("room",
            msg.isFake
                ? "⚠️ 你是偽藝術家！"
                : `題目: ${msg.word}`);
    }

    function handleMyTurn() {
        UI.setCanvasEnabled(true);
        UI.showDoneDrawingButton(true);
        UI.updateStatus("tool", "輪到你畫了！🎨");
    }

    function handleTurnChange(msg) {
        const isMe = msg.peerId === peerManager.myPeerId;

        if (isMe) {
            UI.setCanvasEnabled(true);
            UI.showDoneDrawingButton(true);
            UI.updateStatus("tool", `輪到你畫了！(第 ${msg.round}/${msg.totalRounds} 輪)`);
        } else {
            UI.setCanvasEnabled(false);
            UI.showDoneDrawingButton(false);
            UI.updateStatus("tool", `輪到: ${msg.name} (第 ${msg.round}/${msg.totalRounds} 輪)`);
        }

        // Update turn indicator only (player list already updated via player-list message)
        UI.updateTurnIndicator(msg.peerId, msg.name);
    }

    function handleVotingStart(players) {
        UI.setCanvasEnabled(false);
        UI.showDoneDrawingButton(false);
        UI.updateStatus("tool", "🗳️ 投票時間！");
        UI.showVoteDialog(players);
    }

    function handleFakeGuessPrompt(category, wordLength) {
        UI.setCanvasEnabled(false);
        UI.showDoneDrawingButton(false);
        UI.updateStatus("tool", "🤔 你被揪出來了！猜猜題目？");
        UI.showFakeGuessDialog(category, wordLength);
    }

    function handleGameOver(result) {
        UI.setCanvasEnabled(false);
        UI.showDoneDrawingButton(false);
        UI.updateStatus("tool", "遊戲結束");
        UI.showGameOver(result);
    }

    // ================================================================
    //  DIALOG ACTION CALLBACKS
    // ================================================================

    function onStartGame() {
        const { word, category, rounds } = UI.getWordSetupInput();
        if (!word || !category) {
            alert("請輸入題目和類別！");
            return;
        }

        if (peerManager.getPlayerCount() < CONFIG.GAME.MIN_PLAYERS) {
            alert(`至少需要 ${CONFIG.GAME.MIN_PLAYERS} 名玩家！`);
            return;
        }

        // Initialize game host
        gameHost = new GameHost();

        // Add existing players to game
        const playerList = peerManager.getPlayerList();
        playerList.forEach(p => {
            gameHost.addPlayer(p.peerId, p.name);
        });

        // Start game
        const started = gameHost.startGame(word, category, rounds);
        if (started) {
            UI.closeDialog();
            drawingCanvas.resetCanvas();
            UI.setCanvasEnabled(false); // will be enabled when it's host's turn
            UI.updateStatus("room", `遊戲中 | 題目: ${word} | 類別: ${category}`);
        }
    }

    function onDoneDrawing() {
        if (peerManager.isHost) {
            // Host done drawing — notify game host directly (no broadcast needed)
            if (gameHost && gameHost.state === "playing") {
                const hostPlayer = gameHost.players.get(peerManager.myPeerId);
                if (hostPlayer) hostPlayer.hasDrawn = true;
                gameHost._advanceTurn();
            }
        } else {
            // Client done drawing
            peerManager.sendToHost({
                type: "player-done",
            });
        }

        UI.setCanvasEnabled(false);
        UI.showDoneDrawingButton(false);
        UI.updateStatus("tool", "等待其他人完成...");
    }

    function onVote(votedPeerId) {
        if (peerManager.isHost) {
            // Host voting — handle locally
            if (gameHost) {
                gameHost.handleMessage({
                    type: "vote",
                    votedPeerId: votedPeerId,
                }, peerManager.myPeerId);
            }
        } else {
            // Client voting
            peerManager.sendToHost({
                type: "vote",
                votedPeerId: votedPeerId,
            });
        }
        UI.closeDialog();
        UI.updateStatus("tool", "等待投票結果...");
    }

    function onFakeGuess() {
        const guess = UI.getFakeGuessInput();
        if (!guess) {
            alert("請輸入你猜的題目！");
            return;
        }

        if (peerManager.isHost) {
            // Host is fake artist — handle locally
            if (gameHost) {
                gameHost.handleMessage({
                    type: "fake-guess",
                    guess: guess,
                }, peerManager.myPeerId);
            }
        } else {
            peerManager.sendToHost({
                type: "fake-guess",
                guess: guess,
            });
        }
        UI.closeDialog();
    }

    function onPlayAgain() {
        UI.closeDialog();
        drawingCanvas.resetCanvas();

        if (peerManager.isHost) {
            // Reset game
            if (gameHost) gameHost.reset();
            gameHost = null;

            // 回到 share/lobby 對話框使用同一個簡單 API
            UI.showRoomShare(peerManager.roomCode || "?", _hostLobbyPlayers());
            UI.updatePlayerCount(peerManager.getPlayerCount());
            UI.updateStatus("tool", "工具: 鉛筆");
            UI.updateStatus("room", "房間代碼: " + (peerManager.roomCode || "?") + " (Host)");
            UI.setCanvasEnabled(true);
        } else {
            UI.updateStatus("tool", "等待 Host 開始新遊戲...");
            UI.updateStatus("room", "已連線");
            UI.setCanvasEnabled(false);
        }
    }

    // ================================================================
    //  STARTUP
    // ================================================================

    // Run on DOM ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
