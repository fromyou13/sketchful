const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 60000,
    cors: { origin: "*" }
});

app.use(express.static(__dirname + '/public'));

// ----------------------------------------------------------------
// [구글 시트 & 단어장 설정]
const SHEET_URL = "여기에_구글_시트_CSV_주소_입력"; 
let words = [];       // 전체 단어 원본
let unusedWords = []; // 아직 안 쓴 단어 주머니

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
            .map(w => w.trim())
            .filter(w => w.length > 0);
        
        // 시트 내용이 변경되었을 때만 단어장 갱신
        if (JSON.stringify(words) !== JSON.stringify(newWords)) {
            words = newWords;
            unusedWords = [...words];
            shuffle(unusedWords);
            console.log(`[시스템] 단어장 갱신: ${words.length}개 로드`);
        }
    } catch (e) {
        console.log("시트 로드 실패");
        if (words.length === 0) words = ["사과", "바나나", "기차"]; 
    }
}

loadWordsFromSheet();
// 기존 반영 주기를 유지합니다 (필요시 수정 가능)
setInterval(loadWordsFromSheet, 10 * 60 * 1000); 
// ----------------------------------------------------------------

let currentAnswer = "";
let painterId = null;
let players = {}; 

function startNewRound() {
    const playerIds = Object.keys(players);
    if (playerIds.length === 0) { painterId = null; return; }

    // [핵심] 단어 주머니가 비었다면 다시 채우고 섞기
    if (unusedWords.length === 0) {
        unusedWords = [...words];
        shuffle(unusedWords);
        io.emit('receive_message', { user: 'System', text: '🔄 모든 문제를 풀어서 단어장을 새로 섞었습니다!' });
    }

    // 섞인 주머니에서 단어 하나를 꺼냅니다 (중복 방지)
    currentAnswer = unusedWords.pop(); 
    painterId = playerIds[Math.floor(Math.random() * playerIds.length)];

    io.emit('new_round', { painterId: painterId });
    io.to(painterId).emit('get_answer', currentAnswer);
    io.emit('update_players', players);
}

io.on('connection', (socket) => {
    socket.on('set_nickname', (nickname) => {
        players[socket.id] = { name: nickname.substring(0, 10) || "익명", score: 0 };
        if (Object.keys(players).length === 1) startNewRound();
        else socket.emit('new_round', { painterId: painterId });
        io.emit('update_players', players);
    });

    socket.on('drawing', (data) => {
        if (socket.id === painterId) socket.broadcast.emit('drawing', data);
    });

    socket.on('stop_drawing', () => {
        socket.broadcast.emit('stop_drawing');
    });

    socket.on('send_message', (msg) => {
        if (!players[socket.id]) return;
        const trimmedMsg = msg.trim();
        
        if (trimmedMsg === currentAnswer && socket.id !== painterId) {
            players[socket.id].score += 10;
            io.emit('receive_message', { user: 'System', text: `🎉 정답: [${currentAnswer}] (${players[socket.id].name}님 +10점)` });
            startNewRound();
        } else {
            io.emit('receive_message', { user: players[socket.id].name, text: trimmedMsg.substring(0, 50) });
        }
    });

    socket.on('disconnect', () => {
        if(players[socket.id]) {
            delete players[socket.id];
            io.emit('update_players', players);
            if (socket.id === painterId) startNewRound();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running`));
