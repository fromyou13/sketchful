const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

// ----------------------------------------------------------------
// [구글 시트 연동] - 아까 복사한 CSV 주소를 여기에 꼭 넣으세요!
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQDKhqco-cW24v9ZcNt3ZDaDLW7b0lIOdY6-Yh5YGY6DRqB4fTWvBfSG-ZGPw1o2RIdsZsVHguntlhV/pub?output=csv";
let words = ["사과", "바나나", "기차", "치킨", "컴퓨터"];

async function loadWordsFromSheet() {
  try {
    const response = await axios.get(SHEET_URL);
    words = response.data
      .split(/\r?\n/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);
    console.log(`[시스템] 단어 로드 완료: ${words.length}개`);
  } catch (e) {
    console.log("[에러] 시트 로드 실패, 기본 단어 사용");
  }
}
loadWordsFromSheet();
setInterval(loadWordsFromSheet, 10 * 60 * 1000);
// ----------------------------------------------------------------

let currentAnswer = "";
let painterId = null;
let players = {};

function startNewRound() {
  const playerIds = Object.keys(players);
  if (playerIds.length === 0) {
    painterId = null;
    return;
  }
  painterId = playerIds[Math.floor(Math.random() * playerIds.length)];
  currentAnswer = words[Math.floor(Math.random() * words.length)];

  io.emit("new_round", { painterId: painterId });
  io.to(painterId).emit("get_answer", currentAnswer);
  io.emit("update_players", players);
}

io.on("connection", (socket) => {
  socket.on("set_nickname", (nickname) => {
    players[socket.id] = { name: nickname || "익명", score: 0 };
    if (Object.keys(players).length === 1) startNewRound();
    else socket.emit("new_round", { painterId: painterId });
    io.emit("update_players", players);
  });

  socket.on("drawing", (data) => {
    if (socket.id === painterId) socket.broadcast.emit("drawing", data);
  });

  // [중요] 선 끊기 신호 중계
  socket.on("stop_drawing", () => {
    socket.broadcast.emit("stop_drawing");
  });

  socket.on("send_message", (msg) => {
    if (!players[socket.id]) return;
    if (msg.trim() === currentAnswer && socket.id !== painterId) {
      players[socket.id].score += 10;
      io.emit("receive_message", { user: "System", text: `🎉 정답: [${currentAnswer}] (${players[socket.id].name}님 +10점)` });
      startNewRound();
    } else {
      io.emit("receive_message", { user: players[socket.id].name, text: msg });
    }
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("update_players", players);
    if (socket.id === painterId) startNewRound();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

