const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

// [구글 시트 연동]
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQDKhqco-cW24v9ZcNt3ZDaDLW7b0lIOdY6-Yh5YGY6DRqB4fTWvBfSG-ZGPw1o2RIdsZsVHguntlhV/pub?output=csv";
let words = ["사과", "바나나", "기차", "치킨", "컴퓨터"];
let unusedWords = []; // [수정] 중복 방지를 위한 단어 대기열

async function loadWordsFromSheet() {
  try {
    const response = await axios.get(SHEET_URL);
    words = response.data.split(/\r?\n/).map((w) => w.trim()).filter((w) => w.length > 0);
    unusedWords = [...words]; // 로드 완료 후 대기열 초기화
    console.log("시트 로드 성공: " + words.length + "개의 단어");
  } catch (e) { 
    console.log("시트 로드 실패, 기본 단어 사용"); 
    unusedWords = [...words];
  }
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

  // [수정] 단어 중복 방지 로직
  if (unusedWords.length === 0) {
    unusedWords = [...words]; // 모든 단어를 다 썼다면 다시 리스트 복사
  }
  const randomIndex = Math.floor(Math.random() * unusedWords.length);
  currentAnswer = unusedWords.splice(randomIndex, 1)[0]; // 뽑은 단어는 리스트에서 제거

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

  // 선 튀기 방지: 그리기 시작점 신호 중계
  socket.on("start_drawing", (data) => {
    if (socket.id === painterId) socket.broadcast.emit("start_drawing", data);
  });

  socket.on("drawing", (data) => {
    if (socket.id === painterId) socket.broadcast.emit("drawing", data);
  });

  socket.on("stop_drawing", () => {
    socket.broadcast.emit("stop_drawing");
  });

  // [추가] 전체 삭제 신호 처리
  socket.on("clear_canvas", () => {
    if (socket.id === painterId) io.emit("clear_canvas");
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
      if (socket.id === painterId || currentIndex >= playerOrder.length) {
        startNewRound();
      }
    } else {
      currentIndex = 0;
      painterId = null;
    }
    io.emit("update_players", players);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
