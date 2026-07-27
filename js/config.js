// ============================================================
// Fake Artist - config.js
// Windows XP mspaint 風格多人繪圖推理遊戲
// ============================================================

const CONFIG = {

    // ---- Canvas ----
    CANVAS: {
        WIDTH: 800,
        HEIGHT: 600,
        MAX_UNDO: 30,
    },

    // ---- Brush ----
    BRUSH: {
        DEFAULT_SIZE: 3,
        MIN_SIZE: 1,
        MAX_SIZE: 20,
    },

    // ---- Eraser ----
    ERASER: {
        DEFAULT_SIZE: 20,
        MIN_SIZE: 5,
        MAX_SIZE: 50,
    },

    // ---- Stroke sync ----
    SYNC: {
        BATCH_INTERVAL_MS: 80,   // 每 80ms 發送一次曲線片段
    },

    // ---- PeerJS ----
    PEER: {
        HOST: "0.peerjs.com",
        PORT: 443,
        PATH: "/",
        SECURE: true,
        DEBUG: 0,                // 0=off, 1=errors, 2=warnings, 3=all
        SERIALIZATION: "json",
    },

    // ---- Game ----
    GAME: {
        MIN_PLAYERS: 3,
        MAX_PLAYERS: 10,
        DRAW_ROUNDS: 2,          // 每人畫兩輪（更接近桌遊原版）— 固定 2 輪，不可調整
    },

    // ---- 題庫 ----
    // 題目資料已移至 js/wordbank.js，方便獨立擴充。
    // 這裡只是把外部定義的 WORD_BANK 陣列掛入 CONFIG 供其他模組使用。
    WORD_BANK: window.WORD_BANK || [],

    // ---- Room Code (auto-generated pair codes) ----
    ROOM_CODE: {
        LENGTH: 6,
        // 排除易混淆字元 (0/O, 1/I/L) ，只使用明確的英數字
        CHARSET: "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
        COLLISION_RETRIES: 5,
        PREFIX: "fake-artist-",  // peerjs id 前綴以避免與其他人碰撞
    },

    // ---- XP mspaint 28 色色盤 ----
    // 參考 Windows XP 小畫家預設顏色矩陣 (4 rows × 7 cols = 28)
    COLOR_PALETTE: [
        // Row 1
        "#000000", "#424242", "#808080", "#C0C0C0", "#FFFFFF", "#FF0000", "#FF8080",
        // Row 2
        "#800000", "#800080", "#808000", "#008000", "#008080", "#000080", "#8080FF",
        // Row 3
        "#FF00FF", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#FF80C0", "#C080FF",
        // Row 4
        "#FF8040", "#FFFF80", "#80FF80", "#80FFFF", "#8080C0", "#FFC080", "#C0C0FF",
    ],

    COLORS_PER_ROW: 7,

    // ---- 預設前景/背景色 ----
    DEFAULT_FG: "#000000",
    DEFAULT_BG: "#FFFFFF",
};

// Freeze to prevent accidental mutation
Object.freeze(CONFIG);
Object.freeze(CONFIG.CANVAS);
Object.freeze(CONFIG.BRUSH);
Object.freeze(CONFIG.ERASER);
Object.freeze(CONFIG.SYNC);
Object.freeze(CONFIG.PEER);
Object.freeze(CONFIG.GAME);
Object.freeze(CONFIG.WORD_BANK);
Object.freeze(CONFIG.COLOR_PALETTE);
Object.freeze(CONFIG.ROOM_CODE);