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
        this.tool = "pen";          // pen | brush | eraser | fill | picker
        this.fgColor = CONFIG.DEFAULT_FG;
        this.bgColor = CONFIG.DEFAULT_BG;
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

        // ---- Batch sync timer ----
        this._batchTimer = null;
        this._lastBatchIndex = 0;

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

        // CSS display size
        this.canvas.style.width = w + "px";
        this.canvas.style.height = h + "px";

        // Actual pixel buffer
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;

        // Scale all drawing to CSS pixels
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Canvas defaults
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.fillStyle = this.bgColor;
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
            brush: "crosshair",
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

    setBgColor(color) {
        this.bgColor = color;
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
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
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

        this.isDrawing = false;

        // Save undo state
        this._saveState();

        // Notify app of completed stroke (for sync)
        if (this.onLocalStrokeComplete && this.strokeData.points.length > 1) {
            this.onLocalStrokeComplete(this.strokeData);
        }

        this.strokePoints = [];
        this.strokeData = null;
        this.canvas.releasePointerCapture(e.pointerId);
    }

    _setupStrokeCtx() {
        if (this.tool === "eraser") {
            this.ctx.globalCompositeOperation = "destination-out";
            this.ctx.lineWidth = this.eraserSize;
            // strokeStyle doesn't matter for destination-out
        } else {
            this.ctx.globalCompositeOperation = "source-over";
            this.ctx.strokeStyle = this.fgColor;
            this.ctx.lineWidth = this.brushSize;
        }
    }

    // ================================================================
    //  FLOOD FILL (simple scanline)
    // ================================================================

    _floodFill(pos) {
        const ctx = this.ctx;
        const w = this.cssWidth;
        const h = this.cssHeight;

        // Get target color at click
        const imgData = ctx.getImageData(0, 0, w, h);
        const px = Math.floor(pos.x);
        const py = Math.floor(pos.y);

        if (px < 0 || px >= w || py < 0 || py >= h) return;

        const idx = (py * w + px) * 4;
        const targetR = imgData.data[idx];
        const targetG = imgData.data[idx + 1];
        const targetB = imgData.data[idx + 2];
        const targetA = imgData.data[idx + 3];

        // Parse fill color
        const fill = this._parseColor(this.fgColor);
        if (!fill) return;

        // If same color, skip
        if (targetR === fill.r && targetG === fill.g && targetB === fill.b && targetA === 255) return;

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
        const px = Math.floor(pos.x);
        const py = Math.floor(pos.y);
        if (px < 0 || px >= this.cssWidth || py < 0 || py >= this.cssHeight) return;

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

        const newPoints = this.strokeData.points.slice(this._lastBatchIndex);
        if (newPoints.length === 0) return;

        this._lastBatchIndex = this.strokeData.points.length;

        const batch = {
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

        if (points.length === 0) return;

        if (batchData.tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.lineWidth = batchData.size;
        } else {
            ctx.globalCompositeOperation = "source-over";
            ctx.strokeStyle = batchData.color;
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

        if (points.length < 1) return;

        if (strokeData.tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.lineWidth = strokeData.size;
        } else {
            ctx.globalCompositeOperation = "source-over";
            ctx.strokeStyle = strokeData.color;
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

    undo() {
        if (this.undoStack.length < 2) return false; // keep initial blank

        // Move current to redo
        this.redoStack.push(this.undoStack.pop());

        // Restore previous
        const prev = this.undoStack[this.undoStack.length - 1];
        this.ctx.putImageData(prev, 0, 0);
        return true;
    }

    redo() {
        if (this.redoStack.length === 0) return false;

        const next = this.redoStack.pop();
        this.undoStack.push(next);
        this.ctx.putImageData(next, 0, 0);
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

    clearCanvas() {
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
        this._saveState();
    }

    // ================================================================
    //  FULL RESET (new game)
    // ================================================================

    resetCanvas() {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        this.clearCanvas();
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