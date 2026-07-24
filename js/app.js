// ============================================================
// Fake Artist - app.js
// 應用程式入口 — 初始化、模式切換、事件綁定
// ============================================================

(function () {
    "use strict";

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

        // 6. Wire up peer callbacks
        peerManager.onPlayerJoin = onPlayerJoin;
        peerManager.onPlayerLeave = onPlayerLeave;
        peerManager.onHostMessage = onHostMessage;
        peerManager.onClientMessage = onClientMessage;
        peerManager.onConnected = onConnectedToHost;
        peerManager.onDisconnected = onDisconnectedFromHost;
        peerManager.onError = onPeerError;

        // 7. Wire up game host-as-player callbacks
        onGamePrompt = handleGamePrompt;
        onMyTurn = handleMyTurn;
        onTurnChange = handleTurnChange;
        onVotingStart = handleVotingStart;
        onFakeGuessPrompt = handleFakeGuessPrompt;
        onGameOver = handleGameOver;

        // 8. Show initial room dialog
        UI.showCreateRoomDialog();

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

    // ================================================================
    //  ROOM CALLBACKS
    // ================================================================

    function onCreateRoom() {
        const { roomId, playerName } = UI.getRoomCreateInput();
        if (!roomId || !playerName) {
            alert("請輸入房間名稱和你的名稱！");
            return;
        }

        peerManager.createHost(roomId, playerName);

        // Show room created screen (will also wait for peer open)
        setTimeout(() => {
            UI.showRoomCreated(roomId);
            UI.updateRoomStatus("房間: " + roomId + " (Host)");
            UI.updatePlayerCount(1);
            UI.updatePlayerList([{
                peerId: peerManager.myPeerId,
                name: playerName,
                color: "#3498DB",
                hasDrawn: false,
                isMe: true,
            }], null);
        }, 500);
    }

    function onJoinRoom() {
        const { roomId, playerName } = UI.getRoomJoinInput();
        if (!roomId || !playerName) {
            alert("請輸入房間名稱和你的名稱！");
            return;
        }

        peerManager.joinRoom(roomId, playerName);
        UI.closeDialog();
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
        UI.updatePlayerList(peerManager.getPlayerList(), null);

        // Update room share dialog if open
        const shareCount = document.getElementById("share-player-count");
        if (shareCount) shareCount.textContent = count;
    }

    function onPlayerLeave(peerId) {
        if (gameHost) {
            gameHost.removePlayer(peerId);
        }
        const count = peerManager.getPlayerCount();
        UI.updatePlayerCount(count);
        UI.updatePlayerList(peerManager.getPlayerList(),
            gameHost ? gameHost.currentTurnPeerId : null);

        // Update room share dialog if open
        const shareCount = document.getElementById("share-player-count");
        if (shareCount) shareCount.textContent = count;
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
        }
    }

    function onConnectedToHost() {
        console.log("[App] Connected to host!");
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
        if (err.type === "peer-unavailable") {
            alert("找不到該房間，請確認房間名稱是否正確。");
        } else if (err.type === "unavailable-id") {
            alert("房間名稱已被使用，請換一個名稱。");
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

            // Show room dialog (share-info view)
            UI._isHost = true;
            document.getElementById("dlg-room-title").textContent = "🎨 房間已建立";
            document.getElementById("room-create-form").style.display = "none";
            document.getElementById("room-join-form").style.display = "none";
            document.getElementById("room-share-info").style.display = "block";
            document.getElementById("btn-room-create").style.display = "none";
            document.getElementById("btn-room-join").style.display = "none";
            document.getElementById("btn-room-copy").style.display = "inline-block";
            document.getElementById("btn-room-start").style.display = "inline-block";
            document.getElementById("share-player-count").textContent =
                peerManager.getPlayerCount();
            UI.showDialog("dlg-room");
            UI.updateStatus("tool", "工具: 鉛筆");
            UI.updateStatus("room", "房間: " + peerManager.myPeerId + " (Host)");
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