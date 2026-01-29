const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQDKhqco-cW24v9ZcNt3ZDaDLW7b0lIOdY6-Yh5YGY6DRqB4fTWvBfSG-ZGPw1o2RIdsZsVHguntlhV/pub?output=csv";
let words = ["사과", "바나나", "기차", "치킨", "컴퓨터"];

async function loadWordsFromSheet() {
  try {
    const response = await axios.get(SHEET_URL);
    words = response.data.split(/\r?\n/).map((w) => w.trim()).filter((w) => w.length > 0);
  } catch (e) { console.log("시트 로드 실패"); }
}
loadWordsFromSheet();

let currentAnswer = "";
let painterId = null;
let players = {};
let playerOrder = [];
let currentIndex = 0;

function startNewRound() {
  if (playerOrder.length === 0) return;
  if (currentIndex >= playerOrder.length) currentIndex = 0;
  
  painterId = playerOrder[currentIndex];
  currentAnswer = words[Math.floor(Math.random() * words.length)];

  io.emit("new_round", { painterId: painterId });
  io.to(painterId).emit("get_answer", currentAnswer);
  io.emit("update_players", players);
}

io.on("connection", (socket) => {
  socket.on("set_nickname", (nickname) => {
    players[socket.id] = { name: nickname || "익명", score: 0 };
    playerOrder.push(socket.id);
    if (playerOrder.length === 1) {
      currentIndex = 0;
      startNewRound();
    } else {
      socket.emit("new_round", { painterId: painterId });
    }
    io.emit("update_players", players);
  });

  // 그리기 데이터 중계
  socket.on("drawing", (data) => {
    if (socket.id === painterId) socket.broadcast.emit("drawing", data);
  });

  socket.on("clear_canvas", () => {
    if (socket.id === painterId) socket.broadcast.emit("clear_canvas");
  });

  socket.on("send_message", (msg) => {
    if (!players[socket.id]) return;
    if (msg.trim() === currentAnswer && socket.id !== painterId) {
      players[socket.id].score += 10;
      io.emit("receive_message", { user: "System", text: `🎉 정답: [${currentAnswer}] (${players[socket.id].name}님 +10점)` });
      currentIndex = (currentIndex + 1) % playerOrder.length;
      startNewRound();
    } else {
      io.emit("receive_message", { user: players[socket.id].name, text: msg });
    }
  });

  socket.on("disconnect", () => {
    const idx = playerOrder.indexOf(socket.id);
    playerOrder = playerOrder.filter(id => id !== socket.id);
    delete players[socket.id];
    if (playerOrder.length > 0) {
      if (idx < currentIndex) currentIndex--;
      if (socket.id === painterId || currentIndex >= playerOrder.length) startNewRound();
    } else {
      currentIndex = 0;
      painterId = null;
    }
    io.emit("update_players", players);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
