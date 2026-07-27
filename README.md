# 🎨 Fake Artist

A multiplayer drawing & social deduction party game inspired by the board game *"Fake Artist Goes to New York"* (エセ芸術家ニューヨークへ行く) by Oink Games.

Built with **pure HTML/CSS/JS** + **PeerJS P2P** — no backend server required.  
UI styled after **Windows XP mspaint.exe** (Luna theme).

---

## 🎮 How to Play

1. **Host** creates a room (enters a room ID + their name)
2. **Players** join by entering the same room ID
3. Host sets a **word** (e.g. "大象") and **category** (e.g. "動物")
4. One random player becomes the **Fake Artist** — they only see the category
5. Players take turns drawing one stroke each on a shared canvas
6. After everyone draws (2 rounds), everyone **votes** on who they think the fake artist is
7. If the fake artist is caught → they guess the word. Guessed correctly = fake artist wins!
8. If the wrong person is accused → fake artist wins immediately!

---

## 🚀 Quick Start

Just open `index.html` in a browser! No build tools, no npm install.

```
fake-artist/
├── index.html          # Open this!
├── css/
│   └── style.css       # Windows XP Luna theme
├── js/
│   ├── app.js          # Main orchestrator
│   ├── config.js       # Constants & color palette
│   ├── canvas.js       # Drawing engine
│   ├── peer.js         # PeerJS P2P connection manager
│   ├── game.js         # Game state machine (host only)
│   └── ui.js           # UI helpers
```

---

## 🔧 Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Vanilla HTML/CSS/JS |
| Networking | [PeerJS](https://peerjs.com/) (WebRTC P2P) |
| Canvas | HTML5 Canvas API |
| Styling | Windows XP Luna theme (mspaint.exe) |

---

## 🎨 Features

- ✅ Room creation/joining via PeerJS P2P
- ✅ Real-time stroke syncing (80ms batch intervals)
- ✅ Smooth quadratic bezier curve drawing
- ✅ Eraser tool (true transparency via `destination-out`)
- ✅ Undo system (up to 30 steps)
- ✅ Flood fill & color picker
- ✅ Windows XP mspaint UI (28-color palette, 3D buttons, Luna title bar)
- ✅ Host-managed game flow (word distribution, turn management, voting)
- ✅ Fake artist guess mechanic
- ✅ 2 drawing rounds per game

---

## 📋 Requirements

- Modern browser (Chrome/Firefox/Edge) with WebRTC support
- Internet connection (for PeerJS signaling server at `0.peerjs.com`)
- 3-10 players per room

---

## 🛠️ Future Ideas

- Scoreboard for multiple rounds
- Chat sidebar
- Custom canvas sizes
- Self-hosted PeerJS signaling server
- Pressure-sensitive brush (for stylus/pen input)
- Room password protection