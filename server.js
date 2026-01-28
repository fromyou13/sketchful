const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

// [구글 시트 연동]
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQDKhqco-cW24v9ZcNt3ZDaDLW7b0lIOdY6-Yh5YGY6DRqB4fTWvBfSG-ZGPw1o2RIdsZsVHguntlhV/pub?output=csv";
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

// 게임 상태 변수
let currentAnswer = "";
let painterId = null;
let players = {};
let playerOrder = []; // 접속 순서 저장
let currentIndex = 0; // 현재 출제자 인덱스

function startNewRound() {
  if (playerOrder.length === 0) {
    painterId = null;
    return;
  }

  // 인덱스가 범위를 벗어나면 처음으로 리셋
  if (currentIndex >= playerOrder.length) currentIndex = 0;

  painterId = playerOrder[currentIndex];
  currentAnswer = words[Math.floor(Math.random() * words.length)];

  io.emit("new_round", { painterId: painterId });
  io.to(painterId).emit("get_answer", currentAnswer);
  io.emit("update_players", players);

  // 다음 라운드를 위해 인덱스 미리 증가
  currentIndex = (currentIndex + 1) % playerOrder.length;
}

io.on("connection", (socket) => {
  socket.on("set_nickname", (nickname) => {
    players[socket.id] = { name: nickname || "익명", score: 0 };
    playerOrder.push(socket.id); // 순서 명단에 추가

    if (playerOrder.length === 1) {
      currentIndex = 0;
      startNewRound();
    } else {
      socket.emit("new_round", { painterId: painterId });
    }
    io.emit("update_players", players);
  });

  socket.on("drawing", (data) => {
    if (socket.id === painterId) socket.broadcast.emit("drawing", data);
  });

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
    const wasPainter = socket.id === painterId;

    // 배열에서 제거
    playerOrder = playerOrder.filter((id) => id !== socket.id);
    delete players[socket.id];

    io.emit("update_players", players);

    if (playerOrder.length > 0) {
      if (wasPainter) {
        // 출제자가 나갔으면 현재 인덱스에서 다시 시작
        startNewRound();
      }
    } else {
      currentIndex = 0;
      painterId = null;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

