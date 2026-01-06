const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

const words = ["강아지", "축구", "노트북", "아이스크림", "치킨", "우주인", "고구마", "자동차", "피자", "카메라"];
let currentAnswer = "";
let painterId = null;

function startNewRound() {
  const players = Array.from(io.sockets.sockets.keys());
  if (players.length === 0) {
    painterId = null;
    return;
  }
  painterId = players[Math.floor(Math.random() * players.length)];
  currentAnswer = words[Math.floor(Math.random() * words.length)];

  io.emit("new_round", { painterId: painterId });
  io.to(painterId).emit("get_answer", currentAnswer);
  console.log(`[게임] 새 라운드! 출제자: ${painterId}, 정답: ${currentAnswer}`);
}

io.on("connection", (socket) => {
  if (!painterId) startNewRound();
  else socket.emit("new_round", { painterId: painterId });

  socket.on("drawing", (data) => {
    if (socket.id === painterId) {
      socket.broadcast.emit("drawing", data); // 좌표 + 색상 정보 전달
    }
  });

  socket.on("send_message", (msg) => {
    if (msg === currentAnswer && socket.id !== painterId) {
      io.emit("receive_message", { user: "System", text: `🎉 정답! [${currentAnswer}] (맞힌 사람: ${socket.id.substring(0, 4)})` });
      startNewRound();
    } else {
      io.emit("receive_message", { user: socket.id.substring(0, 4), text: msg });
    }
  });

  socket.on("disconnect", () => {
    if (socket.id === painterId) startNewRound();
  });
});

// server.js 맨 아래 수정
const PORT = process.env.PORT || 3000; // 외부 서버 포트를 우선 사용하도록 함
server.listen(PORT, () => {
  console.log(`서버가 실행 중입니다.`);
});
