const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

// [구글 시트 연동 및 단어 중복 방지 설정]
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQDKhqco-cW24v9ZcNt3ZDaDLW7b0lIOdY6-Yh5YGY6DRqB4fTWvBfSG-ZGPw1o2RIdsZsVHguntlhV/pub?output=csv";
let words = [];       // 전체 단어 원본 저장소
let unusedWords = []; // 아직 사용하지 않은 단어 주머니

// 배열을 무작위로 섞어주는 함수 (Fisher-Yates Shuffle)
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

async function loadWordsFromSheet() {
  try {
    const response = await axios.get(SHEET_URL);
    const newWords = response.data
      .split(/[\r\n,]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);
    
    // 시트 내용이 변경되었을 때만 단어장 업데이트 및 섞기
    if (JSON.stringify(words) !== JSON.stringify(newWords)) {
      words = newWords;
      unusedWords = [...words];
      shuffle(unusedWords);
      console.log(`[시스템] 단어장 로드 완료: ${words.length}개`);
    }
  } catch (e) { 
    console.log("시트 로드 실패"); 
    if (words.length === 0) words = ["사과", "바나나", "기차", "치킨", "컴퓨터"];
  }
}

loadWordsFromSheet();
// 시트 반영은 수동으로 하신다고 하여 기존 주기를 유지하거나 필요시 호출만 합니다.
setInterval(loadWordsFromSheet, 10 * 60 * 1000); 

let currentAnswer = "";
let painterId = null;
let players = {};
let playerOrder = [];
let currentIndex = 0;

function startNewRound() {
  if (playerOrder.length === 0) return;
  
  // [로직 추가] 단어 주머니가 비었다면 새로 채우고 섞기
  if (unusedWords.length === 0) {
    unusedWords = [...words];
    shuffle(unusedWords);
    io.emit("receive_message", { user: "System", text: "🔄 단어장을 모두 소모하여 새로 섞었습니다!" });
  }

  if (currentIndex >= playerOrder.length) currentIndex = 0;
  
  painterId = playerOrder[currentIndex];
  
  // [수정] 무작위 추출 대신 섞인 주머니에서 하나씩 꺼내기 (중복 방지 핵심)
  currentAnswer = unusedWords.pop(); 

  io.emit("new_round", { painterId: painterId });
  io.to(painterId).emit("get_answer", currentAnswer);
  io.emit("update_players", players);
}

io.on("connection", (socket) => {
  socket.on("set_nickname", (nickname) => {
    players[socket.id] = { name: (nickname ? nickname.substring(0, 10) : "익명"), score: 0 };
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

  socket.on("send_message", (msg) => {
    if (!players[socket.id]) return;
    const trimmedMsg = msg.trim();

    if (trimmedMsg === currentAnswer && socket.id !== painterId) {
      players[socket.id].score += 10;
      io.emit("receive_message", { user: "System", text: `🎉 정답: [${currentAnswer}] (${players[socket.id].name}님 +10점)` });
      
      // 정답 시 다음 순서로
      currentIndex = (currentIndex + 1) % playerOrder.length;
      startNewRound();
    } else {
      // 메시지 도배 방지 (최대 50자)
      io.emit("receive_message", { user: players[socket.id].name, text: trimmedMsg.substring(0, 50) });
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
