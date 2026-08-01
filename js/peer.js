// ============================================================
// Fake Artist - peer.js
// PeerJS P2P 連線管理（Host/Client 雙模式）
// ============================================================

class PeerManager {

    constructor() {
        this.peer = null;
        this.isHost = false;
        this.myPeerId = null;
        this.myName = "";
        this.roomCode = null;  // short 6-char code (without prefix)

        // Host: Map<peerId, DataConnection>
        // Client: single connection to host
        this.connections = new Map();
        this.hostConn = null;

        // Host only: 聊天歷史緩衝（welcome 時送給新加入/重連的玩家）
        this.chatHistory = [];

        // Callbacks (set by app.js)
        this.onPlayerJoin = null;       // (peerId, name) — Host only
        this.onPlayerLeave = null;      // (peerId) — Host only
        this.onHostMessage = null;      // (msg) — Client only
        this.onClientMessage = null;    // (msg, peerId) — Host only
        this.onConnected = null;        // () — Client connected to host
        this.onDisconnected = null;     // () — Client disconnected from host
        this.onError = null;            // (error)
    }

    // ================================================================
    //  CREATE HOST
    // ================================================================

    createHost(roomCode, playerName) {
        this.isHost = true;
        this.myName = playerName;
        this.roomCode = roomCode;
        // 用 prefix+code 作為 PeerJS id，大幅降低與其他專案碰撞機率
        this.myPeerId = (CONFIG.ROOM_CODE.PREFIX || "") + roomCode;

        this.peer = new window.peerjs.Peer(this.myPeerId, {
            host: CONFIG.PEER.HOST,
            port: CONFIG.PEER.PORT,
            path: CONFIG.PEER.PATH,
            secure: CONFIG.PEER.SECURE,
            debug: CONFIG.PEER.DEBUG,
        });

        this.peer.on("open", (id) => {
            console.log("[Peer] Host ready, ID:", id);
            // The ID should match myPeerId since we requested it, but use returned for safety
            this.myPeerId = id;
            if (this.onHostReady) this.onHostReady(this.roomCode, this.myPeerId);
        });

        this.peer.on("connection", (conn) => {
            this._handleIncomingConnection(conn);
        });

        this.peer.on("error", (err) => {
            console.error("[Peer] Host error:", err.type, err.message);
            if (this.onError) this.onError(err);
        });

        this.peer.on("disconnected", () => {
            console.warn("[Peer] Host disconnected from signaling server");
        });
    }

    _handleIncomingConnection(conn) {
        const clientPeerId = conn.peer;
        const clientName = conn.metadata ? conn.metadata.name : "Unknown";

        console.log("[Peer] Incoming connection from:", clientPeerId, clientName);

        conn.on("open", () => {
            this.connections.set(clientPeerId, conn);
            if (this.onPlayerJoin) this.onPlayerJoin(clientPeerId, clientName);

            // Send welcome
            conn.send({
                type: "welcome",
                hostName: this.myName,
                players: this.getPlayerList(),
                chatHistory: this.chatHistory || [],
            });
        });

        conn.on("data", (data) => {
            if (this.onClientMessage) this.onClientMessage(data, clientPeerId);
        });

        conn.on("close", () => {
            console.log("[Peer] Client disconnected:", clientPeerId);
            this.connections.delete(clientPeerId);
            if (this.onPlayerLeave) this.onPlayerLeave(clientPeerId, clientName);
        });

        conn.on("error", (err) => {
            console.error("[Peer] Connection error:", clientPeerId, err.type);
        });

        conn.on("iceStateChanged", (state) => {
            console.log("[Peer] ICE state:", clientPeerId, state);
        });
    }

    // ================================================================
    //  JOIN ROOM (Client)
    // ================================================================

    joinRoom(roomCode, playerName) {
        this.isHost = false;
        this.myName = playerName;
        this.roomCode = roomCode;
        // 將短代碼加上 prefix 以對應 Host 的 peer id
        const targetPeerId = (CONFIG.ROOM_CODE.PREFIX || "") + roomCode;

        this.peer = new window.peerjs.Peer({
            host: CONFIG.PEER.HOST,
            port: CONFIG.PEER.PORT,
            path: CONFIG.PEER.PATH,
            secure: CONFIG.PEER.SECURE,
            debug: CONFIG.PEER.DEBUG,
        });

        this.peer.on("open", (myId) => {
            console.log("[Peer] Client ready, my ID:", myId);
            this.myPeerId = myId;

            // Connect to host
            const conn = this.peer.connect(targetPeerId, {
                label: "game-channel",
                metadata: { name: playerName },
                serialization: CONFIG.PEER.SERIALIZATION,
                reliable: true,
            });

            this.hostConn = conn;

            conn.on("open", () => {
                console.log("[Peer] Connected to host:", targetPeerId);
                // Send join message
                conn.send({ type: "join", name: playerName });
                if (this.onConnected) this.onConnected();
            });

            conn.on("data", (data) => {
                if (this.onHostMessage) this.onHostMessage(data);
            });

            conn.on("close", () => {
                console.log("[Peer] Disconnected from host");
                if (this.onDisconnected) this.onDisconnected();
            });

            conn.on("error", (err) => {
                console.error("[Peer] Host connection error:", err.type, err.message);
                if (this.onError) this.onError(err);
            });

            conn.on("iceStateChanged", (state) => {
                console.log("[Peer] ICE state to host:", state);
            });
        });

        this.peer.on("error", (err) => {
            console.error("[Peer] Client error:", err.type, err.message);
            if (this.onError) this.onError(err);
        });

        this.peer.on("disconnected", () => {
            console.warn("[Peer] Client disconnected from signaling server");
        });
    }

    // ================================================================
    //  SEND MESSAGES
    // ================================================================

    sendToHost(msg) {
        if (this.hostConn && this.hostConn.open) {
            this.hostConn.send(msg);
        } else {
            console.warn("[Peer] Cannot send to host: not connected");
        }
    }

    broadcastToAll(msg) {
        this.connections.forEach((conn, peerId) => {
            if (conn.open) {
                conn.send(msg);
            }
        });
    }

    broadcastExcept(msg, excludePeerId) {
        this.connections.forEach((conn, peerId) => {
            if (peerId !== excludePeerId && conn.open) {
                conn.send(msg);
            }
        });
    }

    sendToPeer(msg, peerId) {
        const conn = this.connections.get(peerId);
        if (conn && conn.open) {
            conn.send(msg);
        } else {
            console.warn("[Peer] Cannot send to peer:", peerId);
        }
    }

    // ================================================================
    //  PLAYER MANAGEMENT (Host only)
    // ================================================================

    getPlayerList() {
        const list = [{ peerId: this.myPeerId, name: this.myName, isHost: true }];
        this.connections.forEach((conn, peerId) => {
            list.push({
                peerId: peerId,
                name: conn.metadata ? conn.metadata.name : "Unknown",
                isHost: false,
            });
        });
        return list;
    }

    getPlayerCount() {
        return this.connections.size + 1; // +1 for host
    }

    // ================================================================
    //  DISCONNECT / CLEANUP
    // ================================================================

    disconnect() {
        if (this.isHost) {
            this.connections.forEach(conn => conn.close());
            this.connections.clear();
        } else {
            if (this.hostConn) {
                this.hostConn.close();
                this.hostConn = null;
            }
        }
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.myPeerId = null;
    }
}

// ---- Singleton ----
let peerManager = null;