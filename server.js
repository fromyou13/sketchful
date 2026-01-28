const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQDKhqco-cW24v9ZcNt3ZDaDLW7b0lIOdY6-Yh5YGY6DRqB4fTWvBfSG-ZGPw1o2RIdsZsVHguntlhV/pub?output=csv";
let words = [];
let usedWords = []; // 이미 사용한 단어 저장

async function loadWordsFromSheet() {
  try {
    const response = await axios.get(SHEET_URL);
    words = response.data.split(/\r?\n/).map((w) => w.trim()).filter((w) => w.length > 0);
    console.log("단어 로드 완료:", words.length, "개");
  } catch (e) {
    console.log("시트 로드 실패, 기본 단어 사용");
    words = ["사과", "바나나", "기차", "치킨", "컴퓨터"];
  }
}
loadWordsFromSheet();

let currentAnswer = "";
let painterId = null;
let players = {};
let playerOrder = [];
let currentIndex = 0;
let isGameOver = false;

function startNewRound() {
  if (playerOrder.length === 0 || isGameOver) return;

  // 단어가 모두 소진되었는지 확인
  if (words.length === 0) {
    endGame();
    return;
  }

  if (currentIndex >= playerOrder.length) currentIndex = 0;
  
  painterId = playerOrder[currentIndex];
  
  // 무작위 단어 선택 후 배열에서 제거 (중복 방지)
  const randomIndex = Math.floor(Math.random() * words.length);
  currentAnswer = words.splice(randomIndex, 1)[0];
  usedWords.push(currentAnswer);

  io.emit("new_round", { painterId: painterId });
  io.to(painterId).emit("get_answer", currentAnswer);
  io.emit("update_players", players);
}

function endGame() {
  isGameOver = true;
  // 점수 순으로 정렬하여 우승자 선정
  const sortedPlayers = Object.values(players).sort((a, b) => b.score - a.score);
  const winner = sortedPlayers[0];
  io.emit("game_over", { winner: winner, allPlayers: sortedPlayers });
}

io.on("connection", (socket) => {
  socket.on("set_nickname", (nickname) => {
    players[socket.id] = { name: nickname || "익명", score: 0 };
    playerOrder.push(socket.id);

    if (playerOrder.length === 1 && !isGameOver) {
      currentIndex = 0;
      startNewRound();
    } else {
      socket.emit("update_players", players);
      if (painterId) socket.emit("new_round", { painterId: painterId });
    }
  });

  socket.on("start_drawing", (data) => {
    if (socket.id === painterId) socket.broadcast.emit("start_drawing", data);
  });

  socket.on("drawing", (data) => {
    if (socket.id === painterId) socket.broadcast.emit("drawing", data);
  });

  socket.on("stop_drawing", () => {
    socket.broadcast.emit("stop_drawing");
  });

  // 전체 삭제 이벤트 중계
  socket.on("clear_canvas", () => {
    if (socket.id === painterId) io.emit("clear_canvas");
  });

  socket.on("send_message", (msg) => {
    if (!players[socket.id] || isGameOver) return;
    
    if (msg.trim() === currentAnswer && socket.id !== painterId) {
      players[socket.id].score += 10;
      io.emit("receive_message", { user: "System", text: `🎉 정답: [${currentAnswer}] (${players[socket.id].name}님 +10점)` });
      
      currentIndex = (currentIndex + 1) % playerOrder.length;
      setTimeout(() => startNewRound(), 1500); // 잠시 대기 후 다음 라운드
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
      if (socket.id === painterId) {
        startNewRound();
      }
    } else {
      currentIndex = 0;
      painterId = null;
      // 플레이어가 없으면 게임 상태 초기화 (단어 재로드 등 필요시)
      isGameOver = false;
    }
    io.emit("update_players", players);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
