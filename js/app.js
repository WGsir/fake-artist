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

    // 以「房主身上的 gameHost」資料為來源構造玩家列表（含 hasDrawn / color / currentTurn）
    // 遊戲進行中一律使用此函式；大廳狀態時退回 _hostLobbyPlayers()
    function _hostActivePlayers() {
        if (!gameHost || gameHost.state === "lobby" || gameHost.players.size === 0) {
            const list = _hostLobbyPlayers();
            return list.map(p => ({ ...p, hasDrawn: false }));
        }
        const list = [...gameHost.players.values()].map(p => ({
            peerId: p.peerId,
            name: p.name,
            color: p.color,
            hasDrawn: !!p.hasDrawn,
            isMe: p.peerId === peerManager.myPeerId,
            isHost: p.peerId === peerManager.myPeerId,
        }));
        return list;
    }

    // 大廳階段廣播 player-list 給所有已連線玩家（gameHost 尚未建立時專用）。
    // 遊戲進行中時 gameHost.addPlayer/removePlayer 已會自己廣播，不需走這條。
    function _broadcastLobbyPlayerList() {
        // 若 gameHost 已存在且非 lobby，交給 gameHost 自己廣播，避免重複
        if (gameHost && gameHost.state !== "lobby") return;

        const list = _hostActivePlayers().map(p => ({
            peerId: p.peerId,
            name: p.name,
            color: p.color,
            hasDrawn: !!p.hasDrawn,
        }));
        peerManager.broadcastToAll({
            type: "player-list",
            players: list,
            currentTurnPeerId: gameHost ? gameHost.currentTurnPeerId : null,
        });
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
        UI.updatePlayerList(_hostActivePlayers(), null);
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
            // gameHost 已存在（gameHost 內 addPlayer 會自己廣播 player-list）
            gameHost.addPlayer(peerId, name);
        }
        const count = peerManager.getPlayerCount();
        UI.updatePlayerCount(count);
        UI.updatePlayerList(_hostActivePlayers(),
            gameHost ? gameHost.currentTurnPeerId : null);
        // lobby 階段 gameHost 還沒建立 → 手動廣播 player-list 給所有已連線玩家，
        // 否則先前加入的玩家（如玩家 A）畫面上不會出現新玩家。
        _broadcastLobbyPlayerList();
        // 同步更新 share 對話框中的玩家列表
        if (UI._isHost) {
            UI.updateLobbyPlayers(_hostLobbyPlayers());
            UI.updateLobbyCount(count);
        }
    }

    function onPlayerLeave(peerId) {
        if (gameHost) {
            gameHost.removePlayer(peerId);
        }
        const count = peerManager.getPlayerCount();
        UI.updatePlayerCount(count);
        UI.updatePlayerList(_hostActivePlayers(),
            gameHost ? gameHost.currentTurnPeerId : null);
        // 同 onPlayerJoin：lobby 階段缺 gameHost 時，手動廣播 player-list
        _broadcastLobbyPlayerList();
        // 同步更新 share 對話框中的玩家列表
        if (UI._isHost) {
            UI.updateLobbyPlayers(_hostLobbyPlayers());
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
                // 題目尚未發送 → 先清空 HUD 題目/類型欄，等 your-prompt 來再填
                UI.setGamePrompt("?", "?", "準備中");
                UI.setTurn("idle", {});  // 等 turn-change 來之前先 reset
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
                UI.setTurn("voting", { sub: `大家指控 ${msg.accusedName} — 等待偽藝術家猜題…` });
                break;

            case "fake-guess-prompt":
                handleFakeGuessPrompt(msg.category, msg.wordLength);
                break;

            case "game-over":
                handleGameOver(msg);
                break;

            case "new-game-wait":
                // 房主已重置遊戲，玩家回到等待狀態
                UI.closeDialog();
                drawingCanvas.resetCanvas();
                UI.setCanvasEnabled(false);
                UI.updateStatus("tool", "等待房主開始新遊戲...");
                UI.updateStatus("room", "已連線");
                // 清空 HUD 題目/類型（回到待機）
                UI.resetGamePrompt("等待房主開始遊戲", "—", "準備中");
                UI.setTurn("idle", { text: "等待房主開始新遊戲" });
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
        // 加入成功 → 顯示「等待房主開始」提示（不關閉、不可跳過）
        UI.setTurn("idle", { text: "已加入房間，等待房主開始遊戲", sub: `房間代碼: ${code}` });
        UI.setCanvasEnabled(false);
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
        UI.showYourPrompt(msg);
        UI.updateStatus("room",
            msg.isFake
                ? "⚠️ 你是偽藝術家！"
                : `題目: ${msg.word}`);
    }

    function handleMyTurn() {
        UI.setCanvasEnabled(true);
        UI.showDoneDrawingButton(true);
        UI.updateStatus("tool", "輪到你畫了！🎨");
        UI.setTurn("myturn", {});
    }

    function handleTurnChange(msg) {
        const isMe = msg.peerId === peerManager.myPeerId;

        if (peerManager.isHost) {
            // 房主 UI：直接更新自己的玩家列表，以顯示誰正在畫/已畫
            UI.updatePlayerList(_hostActivePlayers(),
                gameHost ? gameHost.currentTurnPeerId : msg.peerId);
        }

        if (isMe) {
            UI.setCanvasEnabled(true);
            UI.showDoneDrawingButton(true);
            UI.updateStatus("tool", `輪到你畫了！(第 ${msg.round}/${msg.totalRounds} 輪)`);
            UI.setTurn("myturn", {
                round: `第 ${msg.round}/${msg.totalRounds} 輪`,
            });
        } else {
            UI.setCanvasEnabled(false);
            UI.showDoneDrawingButton(false);
            UI.updateStatus("tool", `輪到: ${msg.name} (第 ${msg.round}/${msg.totalRounds} 輪)`);
            UI.setTurn("awaiting", {
                name: msg.name,
                round: `第 ${msg.round}/${msg.totalRounds} 輪 — 等 ${msg.name} 畫完`,
            });
        }

        // Update turn indicator only (player list already updated via player-list message)
        UI.updateTurnIndicator(msg.peerId, msg.name);
    }

    function handleVotingStart(players) {
        UI.setCanvasEnabled(false);
        UI.showDoneDrawingButton(false);
        UI.updateStatus("tool", "🗳️ 投票時間！");
        UI.setTurn("voting", {});
        UI.showVoteDialog(players);
    }

    function handleFakeGuessPrompt(category, wordLength) {
        UI.setCanvasEnabled(false);
        UI.showDoneDrawingButton(false);
        UI.updateStatus("tool", "🤔 你被揪出來了！猜猜題目？");
        UI.setTurn("guessing", { sub: `類別「${category}」・字數 ${wordLength}` });
        UI.showFakeGuessDialog(category, wordLength);
    }

    function handleGameOver(result) {
        UI.setCanvasEnabled(false);
        UI.showDoneDrawingButton(false);
        UI.updateStatus("tool", "遊戲結束");
        // 遊戲結算 → HUD 公開顯示本局題目與類型，右側設為「結算」
        UI.setGamePrompt(result.word, result.category, "結算");
        UI.setTurn("idle", { text: "遊戲結束", sub: "等待房主開始新遊戲" });
        // 只有房主可按「開始新遊戲」按鈕
        UI.showGameOver(result, !!peerManager.isHost);
    }

    // ================================================================
    //  DIALOG ACTION CALLBACKS
    // ================================================================

    function onStartGame() {
        // 題目由系統從題庫隨機生成；固定 2 輪
        const { word, category } = _pickRandomPrompt();
        const rounds = CONFIG.GAME.DRAW_ROUNDS;

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
        // 在啟動遊戲「之前」先把 banner reset 成 idle，
        // 之後 gameHost.startGame 會同步觸發 turn-change / onMyTurn 把 banner
        // 蓋成正確狀態（例如房主是第一個作畫 → myturn）。若 reset 放在 startGame 之後
        // 會把剛剛設好的 myturn banner 覆蓋回 idle，造成 banner 顯示錯誤。
        UI.resetTurnBanner();
        const started = gameHost.startGame(word, category, rounds);
        if (started) {
            UI.closeDialog();
            drawingCanvas.resetCanvas();
            // 注意：不強制 setCanvasEnabled(false)。
            // gameHost.startGame 已透過 turn-change/onMyTurn 把「輪到」的玩家（含房主）啟用。
            // 若房主是第一個畫的玩家，這裡關掉會害他畫不出來，所以只在 client 等待邏輯裡處理。
            if (!peerManager.isHost) {
                // client 由 host 的 turn-change 訊息控制啟用
                UI.setCanvasEnabled(false);
            }
            // 房主這邊立刻顯示遊戲中玩家列表
            UI.updatePlayerList(_hostActivePlayers(),
                gameHost ? gameHost.currentTurnPeerId : null);
            // 房主也在 HUD 顯示本局題目/類型（房主題目 caller 還沒至 setGamePrompt，這裡先填）
            UI.setGamePrompt(word, category, "遊戲中");
            UI.updateStatus("room", `遊戲中 | 題目已隨機分配 | 類別: ${category}`);
        } else {
            alert("無法開始遊戲，請稍候再試。");
        }
    }

    // Session 內已抽過的題目索引，避免短期內重複
    const _usedPromptIndices = new Set();

    // 從題庫隨機挑一題（本局 session 內不重複，直到整庫抽完才重置）
    function _pickRandomPrompt() {
        const bank = CONFIG.WORD_BANK;
        if (!bank.length) return { word: "", category: "" };

        // 整庫抽完 → 清空重來，讓題目可以周而復始
        if (_usedPromptIndices.size >= bank.length) _usedPromptIndices.clear();

        // 從尚未抽過的索引中隨機挑一個
        const remaining = [];
        for (let i = 0; i < bank.length; i++) {
            if (!_usedPromptIndices.has(i)) remaining.push(i);
        }
        const idx = remaining[Math.floor(Math.random() * remaining.length)];
        _usedPromptIndices.add(idx);
        return bank[idx];
    }

    function onDoneDrawing() {
        if (peerManager.isHost) {
            // Host done drawing — notify game host directly (no broadcast needed)
            if (gameHost && gameHost.state === "playing") {
                const hostPlayer = gameHost.players.get(peerManager.myPeerId);
                if (hostPlayer) hostPlayer.hasDrawn = true;
                gameHost._advanceTurn();
            }
            // 立刻刷新房主自己看到的玩家列表（標記你自己為已畫）
            UI.updatePlayerList(_hostActivePlayers(),
                gameHost ? gameHost.currentTurnPeerId : null);
        } else {
            // Client done drawing
            peerManager.sendToHost({
                type: "player-done",
            });
        }

        UI.setCanvasEnabled(false);
        UI.showDoneDrawingButton(false);
        UI.updateStatus("tool", "等待其他人完成...");
        UI.setTurn("awaiting", { text: "你畫完了，等其他人…", round: "已交回畫筆" });
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
            // 注意：這裡「不」呼叫 UI.closeDialog()。
            // 因為若房主是最後一個投票者，gameHost.handleMessage 會同步觸發
            // _resolveVotes → handleFakeGuessPrompt 或 handleGameOver，而那些 handler
            // 會顯示「猜題」或「結算」視窗。若這裡再 closeDialog() 會把剛顯示的視窗
            // 立刻關掉，造成房主看不到下一步視窗。
            // 若還沒到結算（只是登記一票），就關閉投票視窗等結果。
            if (!gameHost || gameHost.state === "voting") {
                UI.closeDialog();
            }
        } else {
            // Client voting
            peerManager.sendToHost({
                type: "vote",
                votedPeerId: votedPeerId,
            });
            UI.closeDialog();
        }
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
            // 注意：不呼叫 UI.closeDialog()。
            // handleMessage 會觸發 _resolveFakeGuess → handleGameOver，顯示結算視窗。
            // 若這裡 closeDialog 會把結算視窗關掉。讓 handleGameOver 自己控制。
        } else {
            peerManager.sendToHost({
                type: "fake-guess",
                guess: guess,
            });
            UI.closeDialog();
        }
    }

    function onPlayAgain() {
        if (!peerManager.isHost) {
            // 只有房主可以開始新遊戲；其他玩家按不到這按鈕
            return;
        }

        UI.closeDialog();
        drawingCanvas.resetCanvas();

        // 提醒所有玩家：進入等待房主開始新遊戲狀態
        peerManager.broadcastToAll({ type: "new-game-wait" });

        // Reset game
        if (gameHost) gameHost.reset();
        gameHost = null;

        // 回到 share/lobby 對話框
        UI.showRoomShare(peerManager.roomCode || "?", _hostLobbyPlayers());
        UI.updatePlayerCount(peerManager.getPlayerCount());
        UI.updateStatus("tool", "工具: 鉛筆");
        UI.updateStatus("room", "房間代碼: " + (peerManager.roomCode || "?") + " (Host)");
        // 房主回到等待狀態：清空 HUD 題目/類型
        UI.resetGamePrompt("等待房主開始遊戲", "—", "準備中");
        UI.setCanvasEnabled(true);
        UI.setTurn("idle", {});
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
