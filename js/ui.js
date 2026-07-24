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
        this._initMenuBar();
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
                    pen: "鉛筆", brush: "筆刷", eraser: "橡皮擦", fill: "填色", picker: "選色器"
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

        slider.addEventListener("input", () => {
            const size = parseInt(slider.value);
            if (drawingCanvas.tool === "eraser") {
                drawingCanvas.setEraserSize(size);
            } else {
                drawingCanvas.setBrushSize(size);
            }
            if (this._onBrushSizeChange) this._onBrushSizeChange(size);
        });
    },

    _setSliderRange(min, max, value) {
        const slider = document.getElementById("brush-size-slider");
        slider.min = min;
        slider.max = max;
        slider.value = value;
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
    //  MENU BAR
    // ================================================================

    _initMenuBar() {
        // Toggle menu dropdowns
        document.querySelectorAll(".menu-item").forEach(item => {
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                // Close others
                document.querySelectorAll(".menu-item.active").forEach(m => {
                    if (m !== item) m.classList.remove("active");
                });
                item.classList.toggle("active");
            });
        });

        // Close menus on outside click
        document.addEventListener("click", () => {
            document.querySelectorAll(".menu-item.active").forEach(m => m.classList.remove("active"));
        });

        // Menu actions
        document.getElementById("menu-new-room").addEventListener("click", () => {
            document.querySelectorAll(".menu-item.active").forEach(m => m.classList.remove("active"));
            this.showCreateRoomDialog();
        });
        document.getElementById("menu-join-room").addEventListener("click", () => {
            document.querySelectorAll(".menu-item.active").forEach(m => m.classList.remove("active"));
            this.showJoinRoomDialog();
        });
        document.getElementById("menu-undo").addEventListener("click", () => {
            document.querySelectorAll(".menu-item.active").forEach(m => m.classList.remove("active"));
            drawingCanvas.undo();
        });
        document.getElementById("menu-clear").addEventListener("click", () => {
            document.querySelectorAll(".menu-item.active").forEach(m => m.classList.remove("active"));
            drawingCanvas.clearCanvas();
        });
        document.getElementById("menu-rules").addEventListener("click", () => {
            document.querySelectorAll(".menu-item.active").forEach(m => m.classList.remove("active"));
            alert("🎨 Fake Artist 遊戲規則：\n\n" +
                "1. 一位玩家是「偽藝術家」，其他是真藝術家\n" +
                "2. 真藝術家知道題目，偽藝術家只知道類別\n" +
                "3. 每人輪流在畫布上畫一筆，偽藝術家要假裝知道題目\n" +
                "4. 所有人畫完後，投票猜誰是偽藝術家\n" +
                "5. 偽藝術家被揪出 → 偽藝術家猜題目，猜對則偽藝術家贏\n" +
                "6. 偽藝術家沒被揪出 → 偽藝術家直接獲勝");
        });
        document.getElementById("menu-about").addEventListener("click", () => {
            document.querySelectorAll(".menu-item.active").forEach(m => m.classList.remove("active"));
            alert("🎨 Fake Artist - 偽藝術家紐約行\n\n" +
                "靈感來自 Oink Games 桌遊《エセ芸術家ニューヨークへ行く》\n" +
                "使用 PeerJS P2P 連線技術\n" +
                "Windows XP 小畫家風格介面\n\n" +
                "v0.1 - Made with ❤️");
        });
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
        // ---- Room buttons ----
        document.getElementById("btn-room-create").addEventListener("click", () => {
            if (this._onCreateRoom) this._onCreateRoom();
        });
        document.getElementById("btn-room-join").addEventListener("click", () => {
            if (this._onJoinRoom) this._onJoinRoom();
        });
        document.getElementById("btn-room-start").addEventListener("click", () => {
            this.showDialog("dlg-word-setup");
        });
        document.getElementById("btn-room-copy").addEventListener("click", () => {
            const roomId = document.getElementById("share-room-id").textContent;
            navigator.clipboard.writeText(roomId).then(() => {
                alert("已複製房間名稱: " + roomId);
            }).catch(() => {
                prompt("手動複製房間名稱:", roomId);
            });
        });

        // ---- Word setup ----
        document.getElementById("btn-confirm-word").addEventListener("click", () => {
            if (this._onStartGame) this._onStartGame();
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

    // ---- Room Dialog Variants ----

    showCreateRoomDialog() {
        document.getElementById("dlg-room-title").textContent = "🎨 開新房間";
        document.getElementById("room-create-form").style.display = "block";
        document.getElementById("room-join-form").style.display = "none";
        document.getElementById("room-share-info").style.display = "none";
        document.getElementById("btn-room-create").style.display = "inline-block";
        document.getElementById("btn-room-join").style.display = "none";
        document.getElementById("btn-room-copy").style.display = "none";
        document.getElementById("btn-room-start").style.display = "none";
        this.showDialog("dlg-room");
    },

    showJoinRoomDialog() {
        document.getElementById("dlg-room-title").textContent = "🔗 加入房間";
        document.getElementById("room-create-form").style.display = "none";
        document.getElementById("room-join-form").style.display = "block";
        document.getElementById("room-share-info").style.display = "none";
        document.getElementById("btn-room-create").style.display = "none";
        document.getElementById("btn-room-join").style.display = "inline-block";
        document.getElementById("btn-room-copy").style.display = "none";
        document.getElementById("btn-room-start").style.display = "none";
        this.showDialog("dlg-room");
    },

    showRoomCreated(roomId) {
        document.getElementById("dlg-room-title").textContent = "🎨 房間已建立";
        document.getElementById("room-create-form").style.display = "none";
        document.getElementById("room-join-form").style.display = "none";
        document.getElementById("room-share-info").style.display = "block";
        document.getElementById("share-room-id").textContent = roomId;
        document.getElementById("btn-room-create").style.display = "none";
        document.getElementById("btn-room-join").style.display = "none";
        document.getElementById("btn-room-copy").style.display = "inline-block";
        document.getElementById("btn-room-start").style.display = "inline-block";
        this._isHost = true;
        this.showDialog("dlg-room");
    },

    getRoomCreateInput() {
        return {
            roomId: document.getElementById("input-room-id").value.trim(),
            playerName: document.getElementById("input-host-name").value.trim(),
        };
    },

    getRoomJoinInput() {
        return {
            roomId: document.getElementById("input-join-room-id").value.trim(),
            playerName: document.getElementById("input-join-name").value.trim(),
        };
    },

    getWordSetupInput() {
        return {
            word: document.getElementById("input-word").value.trim(),
            category: document.getElementById("input-category").value.trim(),
            rounds: parseInt(document.getElementById("input-rounds").value),
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

    showGameOver(result) {
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
            html += `<p>偽藝術家沒有被揪出來，直接獲勝！</p>`;
        }

        if (result.votes) {
            html += "<p>投票結果：</p>";
            result.votes.forEach(v => {
                html += `<p>${v.name}: ${v.count} 票</p>`;
            });
        }

        body.innerHTML = html;
        this.showDialog("dlg-game-over");
    },

    // ================================================================
    //  PLAYER LIST
    // ================================================================

    updatePlayerList(players, currentTurnPeerId) {
        const list = document.getElementById("player-list");

        if (!players || players.length === 0) {
            list.innerHTML = '<div class="player-entry" style="color:#808080;">等待玩家加入...</div>';
            return;
        }

        list.innerHTML = players.map(p => {
            const isTurn = p.peerId === currentTurnPeerId;
            return `<div class="player-entry${isTurn ? " current-turn" : ""}">
                <span class="player-dot${p.hasDrawn ? " drawn" : ""}"
                      style="background:${p.color || '#808080'}"></span>
                ${p.name}${p.isMe ? " (你)" : ""}${isTurn ? " 🎨" : ""}
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
    },

    updateTurnIndicator(peerId, name) {
        const indicator = document.getElementById("turn-indicator");
        const nameEl = document.getElementById("turn-name");
        if (indicator) indicator.style.display = "block";
        if (nameEl) nameEl.textContent = name || "-";
    },

    updateRoomStatus(text) {
        const el = document.getElementById("status-room");
        el.textContent = text;
        el.style.color = text === "未連線" ? "#808080" : "#000000";
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

    showYourPrompt(word, category) {
        if (word) {
            this.updateStatus("tool", `你的題目: ${word} (${category})`);
        } else {
            this.updateStatus("tool", `類別: ${category} (你是偽藝術家！)`);
        }
    },

};