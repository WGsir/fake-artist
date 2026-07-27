// ============================================================
// Fake Artist - canvas.js
// Windows XP mspaint 風格繪圖引擎
// ============================================================

class DrawingCanvas {
    constructor(canvasElement, canvasFrame) {
        this.canvas = canvasElement;
        this.frame = canvasFrame;
        this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });

        // ---- State ----
        this.tool = "pen";          // pen | eraser | fill | picker
        this.fgColor = CONFIG.DEFAULT_FG;
        this.brushSize = CONFIG.BRUSH.DEFAULT_SIZE;
        this.eraserSize = CONFIG.ERASER.DEFAULT_SIZE;

        this.isDrawing = false;
        this.strokePoints = [];     // {x, y}[] for current stroke
        this.strokeData = [];       // serializable stroke for sync: {color, size, tool, points[]}

        // ---- Undo ----
        this.undoStack = [];
        this.redoStack = [];

        // ---- Remote stroke receiver ----
        this.onRemoteStroke = null; // callback set by app.js
        this.onLocalStrokeComplete = null; // callback set by app.js
        this.onLocalStrokeBatch = null;    // callback set by app.js for real-time sync
        // Called after a local non-stroke canvas action (fill, undo, redo,
        // clear). App relays the small action payload to the other players.
        this.onLocalCanvasAction = null;

        // ---- Batch sync timer ----
        this._batchTimer = null;
        this._lastBatchIndex = 0;
        this._strokeSequence = 0;

        // Remote strokes are rendered from their real-time batches. The
        // matching "full" message is then only used to commit undo history.
        this._remoteStrokeStates = new Map();

        // ---- Init ----
        this._initCanvas();
        this._initEvents();
        this._saveState(); // initial blank snapshot
    }

    // ================================================================
    //  INIT
    // ================================================================

    _initCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const w = CONFIG.CANVAS.WIDTH;
        const h = CONFIG.CANVAS.HEIGHT;

        // CSS 顯示尺寸改交給 CSS 控制（max-width: 100%; height: auto），
        // 這裡只設定 pixel buffer 與 transform。
        // 注意：不要寫 inline style.width/style.height，否則會蓋掉 CSS 的 max-width。
        // 在視窗寬度足夠時，canvas 仍以原始 800×600 顯示；
        // 視窗窄時，CSS 會等比縮小，且 _getPos 用 rect.width 比例換算，繪圖對位不受影響。

        // Actual pixel buffer（內部分辨率維持 800×600 * dpr）
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;

        // Scale all drawing to CSS pixels
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Canvas defaults
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.fillStyle = CONFIG.CANVAS_BG;
        this.ctx.fillRect(0, 0, w, h);

        // Store DPR for later
        this.dpr = dpr;
        this.cssWidth = w;
        this.cssHeight = h;
    }

    _initEvents() {
        this.canvas.addEventListener("pointerdown", this._onPointerDown.bind(this));
        this.canvas.addEventListener("pointermove", this._onPointerMove.bind(this));
        this.canvas.addEventListener("pointerup", this._onPointerUp.bind(this));
        this.canvas.addEventListener("pointercancel", this._onPointerUp.bind(this));
        this.canvas.addEventListener("pointerleave", this._onPointerUp.bind(this));
    }

    // ================================================================
    //  TOOLS
    // ================================================================

    setTool(tool) {
        this.tool = tool;
        const cursors = {
            pen: "crosshair",
            eraser: "cell",
            fill: "crosshair",
            picker: "crosshair",
        };
        this.canvas.style.cursor = cursors[tool] || "crosshair";
    }

    setFgColor(color) {
        this.fgColor = color;
        if (this.tool !== "eraser") {
            this.ctx.strokeStyle = color;
        }
    }

    setBrushSize(size) {
        this.brushSize = size;
        if (this.tool !== "eraser") {
            this.ctx.lineWidth = size;
        }
    }

    setEraserSize(size) {
        this.eraserSize = size;
        if (this.tool === "eraser") {
            this.ctx.lineWidth = size;
        }
    }

    getCurrentSize() {
        return this.tool === "eraser" ? this.eraserSize : this.brushSize;
    }

    // ================================================================
    //  POINTER EVENTS
    // ================================================================

    _getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (this.cssWidth / rect.width),
            y: (e.clientY - rect.top) * (this.cssHeight / rect.height),
        };
    }

    _onPointerDown(e) {
        if (e.button !== undefined && e.button !== 0) return; // left button only

        const pos = this._getPos(e);

        if (this.tool === "fill") {
            this._floodFill(pos);
            return;
        }

        if (this.tool === "picker") {
            this._pickColor(pos);
            return;
        }

        this.isDrawing = true;
        this.strokePoints = [pos];
        this.strokeData = {
            id: `${Date.now().toString(36)}-${++this._strokeSequence}`,
            tool: this.tool,
            color: this.tool === "eraser" ? null : this.fgColor,
            size: this.getCurrentSize(),
            points: [pos],
        };
        this._lastBatchIndex = 0;

        // Setup context for drawing
        this._setupStrokeCtx();

        // Draw a single dot for mousedown
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, this.ctx.lineWidth / 2, 0, Math.PI * 2);
        this.ctx.fill();

        // Send the first point immediately, so remote players see a dot even
        // before the first interval tick.
        this._sendBatch();

        // Start batch sync timer
        this._startBatchSync();

        this.canvas.setPointerCapture(e.pointerId);
    }

    _onPointerMove(e) {
        // Update status bar coords
        const pos = this._getPos(e);
        if (typeof UI !== "undefined" && UI.updateCoords) {
            UI.updateCoords(pos.x, pos.y);
        }

        if (!this.isDrawing) return;

        this.strokePoints.push(pos);
        this.strokeData.points.push(pos);

        if (this.strokePoints.length < 3) return;

        // Smooth curve: midpoint quadratic bezier
        const p0 = this.strokePoints[this.strokePoints.length - 3];
        const p1 = this.strokePoints[this.strokePoints.length - 2];
        const p2 = this.strokePoints[this.strokePoints.length - 1];

        const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

        this._setupStrokeCtx();
        this.ctx.beginPath();
        this.ctx.moveTo(mid1.x, mid1.y);
        this.ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
        this.ctx.stroke();
    }

    _onPointerUp(e) {
        if (!this.isDrawing) return;

        // A quick movement can end between pointermove events. Include the
        // pointerup position so the last visible segment is never omitted.
        if (e.type === "pointerup") {
            const pos = this._getPos(e);
            const last = this.strokePoints[this.strokePoints.length - 1];
            if (!last || pos.x !== last.x || pos.y !== last.y) {
                this.strokePoints.push(pos);
                this.strokeData.points.push(pos);
            }
        }

        // Stop batch sync
        this._stopBatchSync();

        // Draw final segment
        if (this.strokePoints.length >= 2) {
            const last = this.strokePoints[this.strokePoints.length - 1];
            const prev = this.strokePoints[this.strokePoints.length - 2];
            const mid = { x: (prev.x + last.x) / 2, y: (prev.y + last.y) / 2 };

            this._setupStrokeCtx();
            this.ctx.beginPath();
            this.ctx.moveTo(mid.x, mid.y);
            this.ctx.quadraticCurveTo(last.x, last.y, last.x, last.y);
            this.ctx.stroke();
        }

        // Flush the final points before the completion message. DataConnection
        // preserves message order, so receivers can commit this exact stroke.
        this._sendBatch();

        this.isDrawing = false;

        // Save undo state
        this._saveState();

        // Notify app of completed stroke (for sync)
        if (this.onLocalStrokeComplete && this.strokeData.points.length > 0) {
            this.onLocalStrokeComplete(this.strokeData);
        }

        this.strokePoints = [];
        this.strokeData = null;
        if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(e.pointerId)) {
            this.canvas.releasePointerCapture(e.pointerId);
        }
    }

    _setupStrokeCtx() {
        if (this.tool === "eraser") {
            this.ctx.globalCompositeOperation = "destination-out";
            this.ctx.lineWidth = this.eraserSize;
            // strokeStyle doesn't matter for destination-out
        } else {
            this.ctx.globalCompositeOperation = "source-over";
            this.ctx.strokeStyle = this.fgColor;
            this.ctx.fillStyle = this.fgColor;
            this.ctx.lineWidth = this.brushSize;
        }
    }

    // ================================================================
    //  FLOOD FILL (simple scanline)
    // ================================================================

    _floodFill(pos, { color = this.fgColor, notify = true } = {}) {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Get target color at click
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = Math.floor(pos.x * this.dpr);
        const py = Math.floor(pos.y * this.dpr);

        if (px < 0 || px >= w || py < 0 || py >= h) return false;

        const idx = (py * w + px) * 4;
        const targetR = imgData.data[idx];
        const targetG = imgData.data[idx + 1];
        const targetB = imgData.data[idx + 2];
        const targetA = imgData.data[idx + 3];

        // Parse fill color
        const fill = this._parseColor(color);
        if (!fill) return false;

        // If same color, skip
        if (targetR === fill.r && targetG === fill.g && targetB === fill.b && targetA === 255) return false;

        // Scanline flood fill
        const stack = [[px, py]];
        const visited = new Uint8Array(w * h); // 0/1

        while (stack.length > 0) {
            const [x, y] = stack.pop();
            let left = x;

            // Go left
            while (left >= 0 && this._matchColor(imgData, left, y, targetR, targetG, targetB, targetA)) {
                left--;
            }
            left++;

            // Go right, fill & queue
            let right = x;
            while (right < w && this._matchColor(imgData, right, y, targetR, targetG, targetB, targetA)) {
                right++;
            }
            right--;

            // Fill span
            for (let i = left; i <= right; i++) {
                const iidx = (y * w + i) * 4;
                imgData.data[iidx]     = fill.r;
                imgData.data[iidx + 1] = fill.g;
                imgData.data[iidx + 2] = fill.b;
                imgData.data[iidx + 3] = 255;
            }

            // Scan above and below
            for (let ny = y - 1; ny <= y + 1; ny += 2) {
                if (ny < 0 || ny >= h) continue;
                for (let i = left; i <= right; i++) {
                    const vidx = ny * w + i;
                    if (visited[vidx]) continue;
                    if (this._matchColor(imgData, i, ny, targetR, targetG, targetB, targetA)) {
                        stack.push([i, ny]);
                        visited[vidx] = 1;
                    }
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
        this._saveState();

        if (notify) {
            this._emitCanvasAction({
                type: "fill",
                x: pos.x,
                y: pos.y,
                color,
            });
        }
        return true;
    }

    _emitCanvasAction(action) {
        if (typeof this.onLocalCanvasAction === "function") {
            this.onLocalCanvasAction(action);
        }
    }

    applyRemoteCanvasAction(action) {
        if (!action || !action.type) return;

        switch (action.type) {
            case "fill":
                this._floodFill({ x: action.x, y: action.y }, {
                    color: action.color,
                    notify: false,
                });
                break;
            case "undo":
                this.undo(false);
                break;
            case "redo":
                this.redo(false);
                break;
            case "clear":
                this.clearCanvas({ color: action.color, notify: false });
                break;
        }
    }

    _matchColor(imgData, x, y, r, g, b, a) {
        const idx = (y * imgData.width + x) * 4;
        return (
            imgData.data[idx] === r &&
            imgData.data[idx + 1] === g &&
            imgData.data[idx + 2] === b &&
            imgData.data[idx + 3] === a
        );
    }

    _parseColor(hex) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return null;
        return {
            r: parseInt(m[1], 16),
            g: parseInt(m[2], 16),
            b: parseInt(m[3], 16),
        };
    }

    // ================================================================
    //  COLOR PICKER
    // ================================================================

    _pickColor(pos) {
        const px = Math.floor(pos.x * this.dpr);
        const py = Math.floor(pos.y * this.dpr);
        if (px < 0 || px >= this.canvas.width || py < 0 || py >= this.canvas.height) return;

        const imgData = this.ctx.getImageData(px, py, 1, 1);
        const r = imgData.data[0];
        const g = imgData.data[1];
        const b = imgData.data[2];
        const hex = "#" + [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("");
        this.setFgColor(hex);

        // Notify UI
        if (typeof UI !== "undefined" && UI.onColorPick) {
            UI.onColorPick(hex);
        }
    }

    // ================================================================
    //  BATCH SYNC (real-time stroke streaming)
    // ================================================================

    _startBatchSync() {
        this._stopBatchSync();
        this._batchTimer = setInterval(() => {
            this._sendBatch();
        }, CONFIG.SYNC.BATCH_INTERVAL_MS);
    }

    _stopBatchSync() {
        if (this._batchTimer) {
            clearInterval(this._batchTimer);
            this._batchTimer = null;
        }
    }

    _sendBatch() {
        if (!this.isDrawing || !this.strokeData) return;

        // Repeat the previous end point in every later batch. Each batch can
        // therefore connect to the already-rendered segment without a gap.
        const startIndex = this._lastBatchIndex === 0
            ? 0
            : this._lastBatchIndex - 1;
        const newPoints = this.strokeData.points.slice(startIndex);
        if (newPoints.length === 0) return;

        this._lastBatchIndex = this.strokeData.points.length;

        const batch = {
            id: this.strokeData.id,
            tool: this.strokeData.tool,
            color: this.strokeData.color,
            size: this.strokeData.size,
            points: newPoints,
        };

        if (this.onLocalStrokeBatch) {
            this.onLocalStrokeBatch(batch);
        }
    }

    // ================================================================
    //  REMOTE STROKE BATCH (incremental batch from another player)
    // ================================================================

    drawRemoteStrokeBatch(batchData) {
        const ctx = this.ctx;
        const points = batchData.points;

        if (!Array.isArray(points) || points.length === 0) return;
        if (batchData.id) {
            if (this._remoteStrokeStates.get(batchData.id) === "completed") return;
            this._remoteStrokeStates.set(batchData.id, "streaming");
        }

        if (batchData.tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.lineWidth = batchData.size;
        } else {
            ctx.globalCompositeOperation = "source-over";
            ctx.strokeStyle = batchData.color;
            ctx.fillStyle = batchData.color;
            ctx.lineWidth = batchData.size;
        }
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        if (points.length === 1) {
            ctx.beginPath();
            ctx.arc(points[0].x, points[0].y, batchData.size / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x, points[i].y);
            }
            ctx.stroke();
        }

        ctx.globalCompositeOperation = "source-over";
    }

    // ================================================================
    //  REMOTE STROKE (draw another player's stroke on our canvas)
    // ================================================================

    drawRemoteStroke(strokeData) {
        const ctx = this.ctx;
        const points = strokeData.points;

        if (!Array.isArray(points) || points.length < 1) return;

        // All current clients receive every real-time batch before this
        // completion message. Do not redraw the full path, which would make
        // the overlapping batches look darker and may leave visual seams.
        if (strokeData.id) {
            const state = this._remoteStrokeStates.get(strokeData.id);
            if (state === "completed") return;
            if (state === "streaming") {
                this._remoteStrokeStates.set(strokeData.id, "completed");
                this._saveState();
                return;
            }
        }

        if (strokeData.tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.lineWidth = strokeData.size;
        } else {
            ctx.globalCompositeOperation = "source-over";
            ctx.strokeStyle = strokeData.color;
            ctx.fillStyle = strokeData.color;
            ctx.lineWidth = strokeData.size;
        }
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // Single dot
        if (points.length === 1) {
            ctx.beginPath();
            ctx.arc(points[0].x, points[0].y, strokeData.size / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = "source-over";
            if (strokeData.id) this._remoteStrokeStates.set(strokeData.id, "completed");
            this._saveState();
            return;
        }

        // Smooth curve
        for (let i = 0; i < points.length - 2; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const p2 = points[i + 2];
            const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
            const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

            ctx.beginPath();
            ctx.moveTo(mid1.x, mid1.y);
            ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
            ctx.stroke();
        }

        // Final segment
        if (points.length >= 2) {
            const last = points[points.length - 1];
            const prev = points[points.length - 2];
            const mid = { x: (prev.x + last.x) / 2, y: (prev.y + last.y) / 2 };
            ctx.beginPath();
            ctx.moveTo(mid.x, mid.y);
            ctx.quadraticCurveTo(last.x, last.y, last.x, last.y);
            ctx.stroke();
        }

        ctx.globalCompositeOperation = "source-over";

        // Save undo state after remote stroke
        this._saveState();
        if (strokeData.id) this._remoteStrokeStates.set(strokeData.id, "completed");
    }

    // ================================================================
    //  UNDO / REDO
    // ================================================================

    _saveState() {
        // Wipe redo on new action
        this.redoStack.length = 0;

        const snapshot = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.undoStack.push(snapshot);

        // Cap undo stack
        if (this.undoStack.length > CONFIG.CANVAS.MAX_UNDO + 1) {
            this.undoStack.shift();
        }
    }

    undo(notify = true) {
        if (this.undoStack.length < 2) return false; // keep initial blank

        // Move current to redo
        this.redoStack.push(this.undoStack.pop());

        // Restore previous
        const prev = this.undoStack[this.undoStack.length - 1];
        this.ctx.putImageData(prev, 0, 0);
        if (notify) this._emitCanvasAction({ type: "undo" });
        return true;
    }

    redo(notify = true) {
        if (this.redoStack.length === 0) return false;

        const next = this.redoStack.pop();
        this.undoStack.push(next);
        this.ctx.putImageData(next, 0, 0);
        if (notify) this._emitCanvasAction({ type: "redo" });
        return true;
    }

    canUndo() {
        return this.undoStack.length >= 2;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    // ================================================================
    //  CLEAR
    // ================================================================

    clearCanvas({ color = CONFIG.CANVAS_BG, notify = true } = {}) {
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.fillStyle = color;
        this.ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
        this._saveState();
        if (notify) this._emitCanvasAction({ type: "clear", color });
    }

    // ================================================================
    //  FULL RESET (new game)
    // ================================================================

    resetCanvas() {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        this._remoteStrokeStates.clear();
        this.clearCanvas({ notify: false });
    }

    // ================================================================
    //  RESIZE (handle window/DPI change)
    // ================================================================

    handleResize() {
        // Save current image
        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

        this._initCanvas();

        // Restore (may clip or pad)
        this.ctx.putImageData(imgData, 0, 0);
        this._saveState();
    }
}

// ---- Singleton (created by app.js) ----
let drawingCanvas = null;
