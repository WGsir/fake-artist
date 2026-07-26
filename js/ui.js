// ============================================================
// Fake Artist - ui.js
// Windows XP mspaint 風格 UI 輔助
// ============================================================

const UI = {

    // ---- State references (set by app.js) ----
    _onToolChange: null,
    _onColorPick: null,
    _onBrushSizeChange: null,
    _onUndo: null,
    _onDoneDrawing: null,
    _onCreateRoom: null,
    _onJoinRoom: null,
    _onStartGame: null,
    _onVote: null,
    _onFakeGuess: null,
    _onPlayAgain: null,

    // ---- Current UI state ----
    _isHost: false,
    _currentDialog: null,
    _selectedVote: null,

    // ================================================================
    //  INIT
    // ================================================================

    init() {
        this._initColorPalette();
        this._initFgBgIndicator();
        this._initToolButtons();
        this._initBrushSlider();
        this._initDialogButtons();
        this._initDoneDrawingButton();
        this._initUndoButton();
    },

    // ================================================================
    //  COLOR PALETTE
    // ================================================================

    _initColorPalette() {
        const paletteDiv = document.getElementById("color-palette");
        paletteDiv.innerHTML = "";

        CONFIG.COLOR_PALETTE.forEach((color, i) => {
            const cell = document.createElement("div");
            cell.className = "color-cell";
            cell.style.backgroundColor = color;
            cell.dataset.color = color;
            cell.addEventListener("click", () => {
                // Left click = foreground, right click = background
                drawingCanvas.setFgColor(color);
                this._updateFgBgIndicator();
                this._highlightSelectedColor(color, "fg");
            });
            cell.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                drawingCanvas.setBgColor(color);
                this._updateFgBgIndicator();
                this._highlightSelectedColor(color, "bg");
            });
            paletteDiv.appendChild(cell);
        });
    },

    _initFgBgIndicator() {
        const fgBox = document.getElementById("fg-color-box");
        const bgBox = document.getElementById("bg-color-box");
        fgBox.style.backgroundColor = CONFIG.DEFAULT_FG;
        bgBox.style.backgroundColor = CONFIG.DEFAULT_BG;
    },

    _updateFgBgIndicator() {
        document.getElementById("fg-color-box").style.backgroundColor = drawingCanvas.fgColor;
        document.getElementById("bg-color-box").style.backgroundColor = drawingCanvas.bgColor;
    },

    _highlightSelectedColor(color, which) {
        // Remove existing selections
        document.querySelectorAll(".color-cell.selected").forEach(c => c.classList.remove("selected"));
        // Find and select the matching cell
        const cells = document.querySelectorAll(".color-cell");
        cells.forEach(c => {
            if (c.dataset.color.toLowerCase() === color.toLowerCase()) {
                c.classList.add("selected");
            }
        });
    },

    onColorPick(color) {
        this._updateFgBgIndicator();
        this._highlightSelectedColor(color, "fg");
    },

    // ================================================================
    //  TOOL BUTTONS
    // ================================================================

    _initToolButtons() {
        const toolBtns = document.querySelectorAll(".tool-btn[data-tool]");
        toolBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                const tool = btn.dataset.tool;

                // Deselect all
                toolBtns.forEach(b => b.classList.remove("selected"));
                // Select clicked
                btn.classList.add("selected");

                // Update drawing canvas
                drawingCanvas.setTool(tool);

                // Update status bar
                const toolNames = {
                    pen: "鉛筆", eraser: "橡皮擦", fill: "填色", picker: "選色器"
                };
                this.updateStatus("tool", "工具: " + (toolNames[tool] || tool));

                // Update brush size slider range
                if (tool === "eraser") {
                    this._setSliderRange(CONFIG.ERASER.MIN_SIZE, CONFIG.ERASER.MAX_SIZE,
                        drawingCanvas.eraserSize);
                } else {
                    this._setSliderRange(CONFIG.BRUSH.MIN_SIZE, CONFIG.BRUSH.MAX_SIZE,
                        drawingCanvas.brushSize);
                }

                if (this._onToolChange) this._onToolChange(tool);
            });
        });
    },

    // ================================================================
    //  BRUSH SIZE SLIDER
    // ================================================================

    _initBrushSlider() {
        const slider = document.getElementById("brush-size-slider");
        slider.min = CONFIG.BRUSH.MIN_SIZE;
        slider.max = CONFIG.BRUSH.MAX_SIZE;
        slider.value = CONFIG.BRUSH.DEFAULT_SIZE;
        this._refreshSizePreview(parseInt(slider.value));

        slider.addEventListener("input", () => {
            const size = parseInt(slider.value);
            if (drawingCanvas.tool === "eraser") {
                drawingCanvas.setEraserSize(size);
            } else {
                drawingCanvas.setBrushSize(size);
            }
            this._refreshSizePreview(size);
            if (this._onBrushSizeChange) this._onBrushSizeChange(size);
        });
    },

    _setSliderRange(min, max, value) {
        const slider = document.getElementById("brush-size-slider");
        slider.min = min;
        slider.max = max;
        slider.value = value;
        this._refreshSizePreview(parseInt(value));
    },

    // 預覽圓的直徑跟隨目前筆刷/橡皮擦尺寸
    _refreshSizePreview(size) {
        const el = document.getElementById("brush-size-preview");
        if (!el) return;
        const clamped = Math.max(1, Math.min(size, 24));
        el.style.setProperty("--preview-size", clamped + "px");
    },

    // ================================================================
    //  UNDO BUTTON
    // ================================================================

    _initUndoButton() {
        document.getElementById("btn-undo").addEventListener("click", () => {
            drawingCanvas.undo();
        });
    },

    // ================================================================
    //  DONE DRAWING BUTTON
    // ================================================================

    _initDoneDrawingButton() {
        document.getElementById("btn-done-drawing").addEventListener("click", () => {
            if (this._onDoneDrawing) this._onDoneDrawing();
        });
    },

    showDoneDrawingButton(show) {
        document.getElementById("btn-done-drawing").style.display = show ? "block" : "none";
    },

    // ================================================================
    //  DIALOGS
    // ================================================================

    showDialog(dialogId) {
        this._currentDialog = dialogId;
        // Hide all dialogs
        document.querySelectorAll("#overlay .xp-dialog").forEach(d => d.style.display = "none");
        // Show target
        const dlg = document.getElementById(dialogId);
        if (dlg) dlg.style.display = "block";
        // Show overlay
        document.getElementById("overlay").classList.add("active");
    },

    closeDialog() {
        document.getElementById("overlay").classList.remove("active");
        document.querySelectorAll("#overlay .xp-dialog").forEach(d => d.style.display = "none");
        this._currentDialog = null;
        this._selectedVote = null;
    },

    _initDialogButtons() {
        // ---- Room: entry choice ----
        document.getElementById("btn-choice-create").addEventListener("click", () => {
            this.showCreateRoomDialog();
        });
        document.getElementById("btn-choice-join").addEventListener("click", () => {
            this.showJoinRoomDialog();
        });

        // ---- Room: create / join confirm ----
        document.getElementById("btn-room-create-confirm").addEventListener("click", () => {
            if (this._onCreateRoom) this._onCreateRoom();
        });
        document.getElementById("btn-room-join-confirm").addEventListener("click", () => {
            if (this._onJoinRoom) this._onJoinRoom();
        });

        // ---- Room: share dialog actions ----
        document.getElementById("btn-room-start").addEventListener("click", () => {
            if (this._onStartGame) this._onStartGame();
        });
        document.getElementById("btn-room-copy").addEventListener("click", () => {
            const code = document.getElementById("share-room-id").textContent.trim();
            navigator.clipboard.writeText(code).then(() => {
                this._flashCopyButton();
                this.updateRoomStatus("代碼已複製: " + code);
            }).catch(() => {
                prompt("手動複製房間代碼:", code);
            });
        });

        // ---- Vote ----
        document.getElementById("btn-confirm-vote").addEventListener("click", () => {
            if (this._onVote && this._selectedVote !== null) {
                this._onVote(this._selectedVote);
            }
        });

        // ---- Fake guess ----
        document.getElementById("btn-confirm-guess").addEventListener("click", () => {
            if (this._onFakeGuess) this._onFakeGuess();
        });

        // ---- Play again ----
        document.getElementById("btn-play-again").addEventListener("click", () => {
            if (this._onPlayAgain) this._onPlayAgain();
        });
    },

    _flashCopyButton() {
        const btn = document.getElementById("btn-room-copy");
        if (!btn) return;
        const original = btn.textContent;
        btn.textContent = "✅ 已複製！";
        btn.disabled = true;
        setTimeout(() => {
            btn.textContent = original;
            btn.disabled = false;
        }, 1200);
    },

    // ================================================================
    //  ROOM DIALOGS (entry / create / join / share / connecting)
    // ================================================================

    /** Show the initial "what do you want to do?" dialog. */
    showEntryDialog() {
        this._isHost = false;
        this.showDialog("dlg-room-entry");
    },

    /** Host flow: ask for player name (room code is auto-generated later). */
    showCreateRoomDialog() {
        const input = document.getElementById("input-host-name");
        if (input) input.value = "";
        this.showDialog("dlg-room-create");
    },

    /** Client flow: ask for room code + player name. */
    showJoinRoomDialog() {
        const codeInput = document.getElementById("input-join-room-id");
        const nameInput = document.getElementById("input-join-name");
        if (codeInput) codeInput.value = "";
        if (nameInput) nameInput.value = "";
        this.showDialog("dlg-room-join");
    },

    /** Go back from create/join dialog to the entry dialog. */
    backToEntry() {
        this.showEntryDialog();
    },

    /** Show the share/lobby dialog with the auto-generated code & live player list. */
    showRoomShare(roomCode, players) {
        this._isHost = true;
        document.getElementById("share-room-id").textContent = roomCode;
        this.updateLobbyPlayers(players || []);
        this.updateLobbyCount(players ? players.length : 1);
        this.showDialog("dlg-room-share");
    },

    /** Update the player list shown inside the share dialog. */
    updateLobbyPlayers(players) {
        const list = document.getElementById("room-lobby-list");
        if (!list) return;
        list.innerHTML = "";

        if (!players || players.length === 0) {
            list.innerHTML = '<div class="room-lobby-entry" style="color:#808080;">等待玩家加入...</div>';
            return;
        }
        const wrapped = document.createElement("div");
        players.forEach(p => {
            const entry = document.createElement("div");
            entry.className = "room-lobby-entry";
            entry.innerHTML = `
                <span class="player-dot" style="background:${p.color || "#3498DB"}"></span>
                <span>${p.name}${p.isMe ? " (你)" : ""}</span>
                ${p.isHost ? '<span class="room-lobby-host-tag">Host</span>' : ""}
            `;
            wrapped.appendChild(entry);
        });
        list.innerHTML = wrapped.innerHTML;
    },

    updateLobbyCount(count) {
        const el = document.getElementById("share-player-count");
        if (el) el.textContent = count;
    },

    /** Show a modal spinner while P2P is being established. */
    showConnecting(text) {
        const t = document.getElementById("connecting-text");
        if (t && text) t.textContent = text;
        this.showDialog("dlg-room-connecting");
    },

    getRoomCreateInput() {
        return {
            playerName: document.getElementById("input-host-name").value.trim(),
        };
    },

    getRoomJoinInput() {
        // Normalize the code: uppercase + strip the project prefix if user pasted full id
        let raw = document.getElementById("input-join-room-id").value.trim().toUpperCase();
        if (raw.startsWith(CONFIG.ROOM_CODE.PREFIX.toUpperCase())) {
            raw = raw.slice(CONFIG.ROOM_CODE.PREFIX.length);
        }
        return {
            roomCode: raw,
            playerName: document.getElementById("input-join-name").value.trim(),
        };
    },

    getFakeGuessInput() {
        return document.getElementById("input-fake-guess").value.trim();
    },

    // ================================================================
    //  VOTE DIALOG
    // ================================================================

    showVoteDialog(players) {
        const body = document.getElementById("vote-body");
        this._selectedVote = null;

        let html = "<p>你覺得誰是偽藝術家？點擊玩家名稱投票：</p>";
        players.forEach(p => {
            html += `<button class="vote-player-btn" data-peer="${p.peerId}">
                <span class="player-dot" style="background:${p.color || '#808080'}"></span>
                ${p.name}
            </button>`;
        });

        body.innerHTML = html;

        // Bind click events
        body.querySelectorAll(".vote-player-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                body.querySelectorAll(".vote-player-btn").forEach(b => b.classList.remove("selected"));
                btn.classList.add("selected");
                this._selectedVote = btn.dataset.peer;
                document.getElementById("btn-confirm-vote").disabled = false;
            });
        });

        document.getElementById("btn-confirm-vote").disabled = true;
        this.showDialog("dlg-vote");
    },

    // ================================================================
    //  FAKE GUESS DIALOG
    // ================================================================

    showFakeGuessDialog(category, wordLength) {
        document.getElementById("fake-category-hint").textContent = category;
        document.getElementById("fake-word-length").textContent = wordLength;
        document.getElementById("input-fake-guess").value = "";
        this.showDialog("dlg-fake-guess");
    },

    // ================================================================
    //  GAME OVER DIALOG
    // ================================================================

    showGameOver(result, isHost) {
        const body = document.getElementById("game-over-body");
        let html = "";

        if (result.fakeArtistWon) {
            html += `<p style="font-size:14px; font-weight:bold; color:#CC0000;">🎭 偽藝術家獲勝！</p>`;
        } else {
            html += `<p style="font-size:14px; font-weight:bold; color:#008000;">🎨 真藝術家獲勝！</p>`;
        }

        html += `<p>題目是：<strong>${result.word}</strong>（${result.category}）</p>`;
        html += `<p>偽藝術家是：<strong>${result.fakeArtist}</strong></p>`;

        if (result.fakeGuess) {
            html += `<p>偽藝術家猜了：<strong>${result.fakeGuess}</strong> — ${result.fakeCorrect ? "✅ 猜對" : "❌ 猜錯"}</p>`;
        } else if (result.fakeArtistWon && !result.fakeCorrect) {
            html += `<p>偽藝術家沒有被揭露銓出來（平票或未被投票），直接獲勝！</p>`;
        }

        if (result.votes) {
            html += "<p>投票結果：</p>";
            result.votes.forEach(v => {
                html += `<p>${v.name}: ${v.count} 票</p>`;
            });
        }

        body.innerHTML = html;

        // 只有房主可以開始新遊戲
        const againBtn = document.getElementById("btn-play-again");
        if (againBtn) {
            if (isHost) {
                againBtn.style.display = "block";
                againBtn.textContent = "🎮 開始新遊戲";
            } else {
                againBtn.style.display = "none";
            }
        }

        this.showDialog("dlg-game-over");
    },

    // ================================================================
    //  PLAYER LIST
    // ================================================================

    updatePlayerList(players, currentTurnPeerId) {
        const list = document.getElementById("player-list");

        if (!players || players.length === 0) {
            list.innerHTML = '<div class="player-entry" style="color:#808080;">等待玩家加入...</div>'
            return;
        }

        list.innerHTML = players.map(p => {
            const isTurn = p.peerId === currentTurnPeerId;
            const isMe = !!p.isMe && !isTurn;
            let badge = "";
            if (isTurn) {
                badge = `<span class="player-badge ${p.isMe ? "mine" : "other"}">${p.isMe ? "你在畫" : "正在畫"}</span>`;
            } else if (p.hasDrawn) {
                badge = `<span class="player-badge done">已畫</span>`;
            } else {
                badge = `<span class="player-badge waiting">等待</span>`;
            }
            return `<div class="player-entry${isTurn ? " current-turn" : ""}">
                <span class="player-dot${p.hasDrawn ? " drawn" : ""}"
                      style="background:${p.color || '#808080'}"></span>
                <span class="player-name">${p.name}${p.isMe ? " (你)" : ""}</span>
                ${badge}
            </div>`;
        }).join("");

        // Update turn indicator
        if (currentTurnPeerId) {
            const turnPlayer = players.find(p => p.peerId === currentTurnPeerId);
            document.getElementById("turn-indicator").style.display = "block";
            document.getElementById("turn-name").textContent = turnPlayer ? turnPlayer.name : "-";
        } else {
            document.getElementById("turn-indicator").style.display = "none";
        }
    },

    // ================================================================
    //  STATUS BAR
    // ================================================================

    updateStatus(field, text) {
        const el = document.getElementById("status-" + field);
        if (el) el.textContent = text;
    },

    updateCoords(x, y) {
        document.getElementById("status-coords").textContent =
            `${Math.round(x)}, ${Math.round(y)} px`;
    },

    updatePlayerCount(count) {
        document.getElementById("status-players").textContent = `玩家: ${count}`;
        const sidebarCount = document.getElementById("sidebar-player-count");
        if (sidebarCount) sidebarCount.textContent = count;
    },

    updateTurnIndicator(peerId, name) {
        const indicator = document.getElementById("turn-indicator");
        const nameEl = document.getElementById("turn-name");
        if (indicator) indicator.style.display = "block";
        if (nameEl) nameEl.textContent = name || "-";
    },

    // ================================================================
    //  TURN BANNER  (大橫幅, 在畫布正上方)
    // ----------------------------------------------------------------
    //  state: "idle"      — 遊戲還沒開始（lobby / game over）
    //         "awaiting" — 遊戲開始但不是我的回合（看別人畫）
    //         "myturn"   — 輪到本玩家作畫
    //         "voting"   — 進入投票階段
    //         "guessing" — 偽藝術家猜題目
    // ----------------------------------------------------------------
    setTurn(state, info) {
        info = info || {};

        const banner = document.getElementById("turn-banner");
        const textEl = document.getElementById("turn-banner-text");
        const subEl  = document.getElementById("turn-banner-sub");
        const tipEl  = document.getElementById("sidebar-tip-text");
        if (!banner) return;

        banner.setAttribute("data-state", state);

        let main = info.text || "";
        let sub  = info.sub  || "";
        let tip  = info.tip  || "真藝術家知道題目；偽藝術家只有類別。別讓你的筆跡洩漏答案！";

        if (state === "idle") {
            if (!main) main = "等待房主開始遊戲";
        } else if (state === "awaiting") {
            if (!main && info.name) main = `${info.name} 正在作畫…`;
            if (!sub && info.round) sub = info.round;
            if (!info.tip) tip = "盯緊畫布，注意誰畫得心虛；輪到你時再下筆。";
        } else if (state === "myturn") {
            if (!main) main = "輪到你畫了！";
            if (!sub && info.round) sub = "現在就到工具箱選色下筆 — 只能畫一筆";
            if (!info.tip) tip = "畫一筆後按下方「我畫完了」結束你的回合。";
        } else if (state === "voting") {
            if (!main) main = "投票：誰是偽藝術家？";
            if (!sub) sub = "看看對話框，選出可疑的人。";
            if (!info.tip) tip = "投票時不能繼續畫，仔細回想剛剛每個人的筆跡。";
        } else if (state === "guessing") {
            if (!main) main = "你被揪出來了！猜猜題目";
            if (!sub) sub = "偽藝術家只有類別可以參考。";
            if (!info.tip) tip = "你已經被指控，請猜出完整題目才能反敗為勝。";
        }

        if (textEl) textEl.textContent = main;
        if (subEl)  subEl.textContent  = sub;
        if (tipEl)  tipEl.textContent  = tip;

        // 同步把 menu 的 stage-hint 文字保留為狀態提示
        const stageHint = document.getElementById("canvas-stage-hint");
        if (stageHint) {
            if (state === "myturn") stageHint.textContent = "★ 輪到你畫 ★";
            else if (state === "awaiting" && info.name) stageHint.textContent = `${info.name} 正在畫`;
            else if (state === "voting") stageHint.textContent = "投票中";
            else if (state === "guessing") stageHint.textContent = "偽藝術家猜題目";
            else stageHint.textContent = "輪流畫一筆，找出偽藝術家";
        }

        // 在「不是我的回合」時，淡化左側工具箱讓玩家清楚現在不能畫
        const tb = document.getElementById("toolbox");
        if (tb) {
            if (state === "myturn") {
                tb.removeAttribute("data-disabled");
            } else {
                tb.setAttribute("data-disabled", "true");
            }
        }
    },

    // 一個糖衣封裝：給目前作畫玩家用
    updateRoleBadge(isMyTurn, turnName, roundLabel) {
        if (isMyTurn) {
            this.setTurn("myturn", { name: turnName, round: roundLabel });
        } else if (turnName) {
            this.setTurn("awaiting", { name: turnName, round: roundLabel });
        } else {
            this.setTurn("idle", {});
        }
    },

    // 開始遊戲前先 reset 回 idle，避免上一局 banner 留著
    resetTurnBanner() {
        this.setTurn("idle", {});
    },

    updateRoomStatus(text) {
        const el = document.getElementById("status-room");
        el.textContent = text;
        el.style.color = text === "未連線" ? "#808080" : "#000000";
        const hudStatus = document.getElementById("hud-room-status");
        if (hudStatus) hudStatus.textContent = text;
    },

    // ================================================================
    //  ENABLE/DISABLE CANVAS (when it's not your turn)
    // ================================================================

    setCanvasEnabled(enabled) {
        const canvas = document.getElementById("drawing-canvas");
        if (enabled) {
            canvas.style.pointerEvents = "auto";
            canvas.style.cursor = "crosshair";
        } else {
            canvas.style.pointerEvents = "none";
            canvas.style.cursor = "not-allowed";
        }
    },

    // ================================================================
    //  SHOW PROMPT TO PLAYER
    // ================================================================

    // 設定 HUD 的「題目」「類型」兩欄
    // word = null/falsy 時表示該玩家是偽藝術家（題目隱藏）
    // roundText = 指定右側角色徽章字樣（例如「真藝術家」/「偽藝術家」），不給則保留
    setGamePrompt(word, category, roundText) {
        const wordEl = document.getElementById("prompt-word-display");
        const catEl  = document.getElementById("prompt-category-display");
        const roundEl = document.getElementById("round-display");

        if (wordEl) wordEl.textContent = word ? word : "❓ (你是偽藝術家)";
        if (catEl)  catEl.textContent  = category || "—";
        if (roundEl && typeof roundText === "string") roundEl.textContent = roundText;
    },

    // 還原 HUD 的「題目」「類型」兩欄（回合結束、新局等待時呼叫）
    resetGamePrompt(wordText, categoryText, roundText) {
        const wordEl = document.getElementById("prompt-word-display");
        const catEl  = document.getElementById("prompt-category-display");
        const roundEl = document.getElementById("round-display");
        if (wordEl) wordEl.textContent = wordText || "等待房主開始遊戲";
        if (catEl)  catEl.textContent  = categoryText || "—";
        if (roundEl && typeof roundText === "string") roundEl.textContent = roundText;
    },

    showYourPrompt(word, category) {
        if (word) {
            this.updateStatus("tool", `你的題目: ${word} (${category})`);
            // 題目已知 → 顯示題目與類型，右側顯示真藝術家徽章
            this.setGamePrompt(word, category, "真藝術家");

            // 突顯右側 sidebar 提示，告知角色（並維持 banner）
            const tipEl = document.getElementById("sidebar-tip-text");
            if (tipEl) {
                tipEl.textContent = `你是真藝術家。題目「${word}」（${category}）。輪到你時要畫得像樣！`;
            }
        } else {
            this.updateStatus("tool", `類別: ${category} (你是偽藝術家！)`);
            // 偽藝術家看不到題目，但看得到類型
            this.setGamePrompt(null, category, "偽藝術家");

            const tipEl = document.getElementById("sidebar-tip-text");
            if (tipEl) {
                tipEl.textContent = `你是偽藝術家！你只知道類別「${category}」。要看別人怎麼畫，假裝自己也知道題目。`;
            }
        }
    },

};
