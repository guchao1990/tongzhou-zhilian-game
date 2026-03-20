/**
 * 炸金花游戏服务器 - 主入口
 * 架构师：同舟智联架构师
 * 后端工程师：同舟智联后端工程师
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const GameRoom = require('./game/GameRoom');
const Player = require('./game/Player');
const AIController = require('./game/AIController');

// ============ 配置 ============
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 8443;

const app = express();
app.use(express.json());

// CORS（开发环境）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// ============ 房间管理 ============
const rooms = new Map(); // roomId -> GameRoom
const playerSockets = new Map(); // socketId -> { player, roomId }

// 创建房间
function createRoom(options = {}) {
  const roomId = generateRoomId();
  const room = new GameRoom({
    roomId,
    maxPlayers: options.maxPlayers || 6,
    type: options.type || 'single', // 'single' | 'ai' | 'online'
    difficulty: options.difficulty || 'normal',
    ante: options.ante || 50,    // 底注
    buyIn: options.buyIn || 1000  // 买入
  });
  rooms.set(roomId, room);
  console.log(`[Room] 创建房间: ${roomId}, 类型: ${room.type}`);
  return room;
}

// 生成房间ID
function generateRoomId() {
  return 'R' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
}

// 获取房间
function getRoom(roomId) {
  return rooms.get(roomId);
}

// 移除房间
function removeRoom(roomId) {
  rooms.delete(roomId);
  console.log(`[Room] 销毁房间: ${roomId}`);
}

// ============ AI控制器 ============
const aiController = new AIController();

// ============ Socket.IO ============
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

io.on('connection', (socket) => {
  console.log(`[Socket] 连接: ${socket.id}`);

  // 创建单人/AI房间
  socket.on('CREATE_ROOM', (options, callback) => {
    try {
      const room = createRoom({
        maxPlayers: options.maxPlayers || 4,
        type: options.withAI ? 'ai' : 'single',
        difficulty: options.difficulty || 'normal',
        ante: options.ante || 50,
        buyIn: options.buyIn || 1000
      });

      const player = new Player({
        id: socket.id,
        nickname: options.nickname || '玩家',
        isAI: false
      });

      room.addPlayer(player);
      playerSockets.set(socket.id, { player, roomId: room.roomId });

      socket.join(room.roomId);
      socket.emit('ROOM_JOINED', room.getState(player.id));
      callback({ success: true, roomId: room.roomId });

      // 如果是AI房间，自动填充AI玩家
      if (room.type === 'ai') {
        fillRoomWithAI(room);
      }

    } catch (err) {
      console.error('[Socket] CREATE_ROOM error:', err);
      callback({ success: false, error: err.message });
    }
  });

  // 加入房间
  socket.on('JOIN_ROOM', ({ roomId, nickname }, callback) => {
    const room = getRoom(roomId);
    if (!room) {
      callback({ success: false, error: '房间不存在' });
      return;
    }
    if (room.status !== 'waiting') {
      callback({ success: false, error: '游戏已开始' });
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      callback({ success: false, error: '房间已满' });
      return;
    }

    const player = new Player({
      id: socket.id,
      nickname: nickname || '玩家',
      isAI: false
    });

    room.addPlayer(player);
    playerSockets.set(socket.id, { player, roomId });

    socket.join(roomId);
    io.to(roomId).emit('PLAYER_JOINED', room.getPlayerInfo());
    callback({ success: true, roomId, state: room.getState(player.id) });

    console.log(`[Room] 玩家 ${nickname} 加入房间 ${roomId}`);
  });

  // 离开房间
  socket.on('LEAVE_ROOM', () => {
    handleLeave(socket);
  });

  // 游戏操作
  socket.on('GAME_ACTION', ({ action, amount }, callback) => {
    const data = playerSockets.get(socket.id);
    if (!data) {
      callback?.({ success: false, error: '未在房间中' });
      return;
    }

    const { player, roomId } = data;
    const room = getRoom(roomId);
    if (!room) {
      callback?.({ success: false, error: '房间不存在' });
      return;
    }

    const result = room.handleAction(player.id, action, amount);

    if (result.success) {
      // 广播操作
      io.to(roomId).emit('PLAYER_ACTION', {
        playerId: player.id,
        playerName: player.nickname,
        action,
        amount,
        newState: room.getState(player.id)
      });

      // 如果需要触发AI
      if (action !== 'FOLD' && room.needAITurn()) {
        setTimeout(() => triggerAIAction(room), 800);
      }
    }

    callback?.(result);

    // 检查游戏是否结束
    if (room.isRoundOver()) {
      handleRoundEnd(room);
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log(`[Socket] 断开: ${socket.id}`);
    handleLeave(socket);
  });
});

// 处理玩家离开
function handleLeave(socket) {
  const data = playerSockets.get(socket.id);
  if (!data) return;

  const { player, roomId } = data;
  const room = getRoom(roomId);

  if (room) {
    room.removePlayer(player.id);
    io.to(roomId).emit('PLAYER_LEFT', { playerId: player.id, playerName: player.nickname });

    // 如果是AI模式，补充AI
    if (room.type === 'ai' && room.status === 'waiting') {
      fillRoomWithAI(room);
    }

    // 房间空了，销毁
    if (room.players.length === 0) {
      removeRoom(roomId);
    }
  }

  playerSockets.delete(socket.id);
  socket.leave(roomId);
}

// AI回合
function triggerAIAction(room) {
  if (room.status !== 'playing') return;

  const aiPlayer = room.getCurrentAIPlayer();
  if (!aiPlayer) return;

  const action = aiController.decide(aiPlayer, room, room.difficulty);

  const result = room.handleAction(aiPlayer.id, action.type, action.amount);

  io.to(room.roomId).emit('PLAYER_ACTION', {
    playerId: aiPlayer.id,
    playerName: aiPlayer.nickname,
    action: action.type,
    amount: action.amount,
    isAI: true
  });

  if (result.success && room.needAITurn()) {
    setTimeout(() => triggerAIAction(room), 800);
  }

  if (room.isRoundOver()) {
    handleRoundEnd(room);
  }
}

// 回合结束
function handleRoundEnd(room) {
  const result = room.settleRound();

  io.to(room.roomId).emit('ROUND_END', result);

  // 判断是否有人输光出局，或者只剩一人
  const activePlayers = room.getActivePlayers();
  if (activePlayers.length <= 1 || room.round >= room.maxRounds) {
    // 游戏结束
    const finalResult = room.settleGame();
    io.to(room.roomId).emit('GAME_OVER', finalResult);
    room.status = 'ended';
  } else {
    // 下一轮
    setTimeout(() => {
      room.nextRound();
      io.to(room.roomId).emit('NEW_ROUND', { round: room.round });
      if (room.needAITurn()) {
        setTimeout(() => triggerAIAction(room), 500);
      }
    }, 2000);
  }
}

// AI房间自动填充
function fillRoomWithAI(room) {
  const targetCount = Math.min(room.maxPlayers, 4); // 默认4人局
  const currentCount = room.players.length;

  for (let i = currentCount; i < targetCount; i++) {
    const ai = new Player({
      id: 'AI_' + Date.now() + '_' + i,
      nickname: ['小智', '小红', '小刚', '小美'][i % 4],
      isAI: true,
      chips: room.buyIn
    });
    ai.buyIn = room.buyIn;
    room.addPlayer(ai);
  }

  io.to(room.roomId).emit('PLAYER_JOINED', room.getPlayerInfo());

  // 人数够了，自动开始
  if (room.players.length >= 2) {
    setTimeout(() => startGame(room), 1000);
  }
}

// 开始游戏
function startGame(room) {
  if (room.status !== 'waiting') return;

  room.startGame();
  io.to(room.roomId).emit('GAME_START', {
    dealer: room.dealer,
    smallBlind: room.smallBlind,
    players: room.getPlayerInfo()
  });

  // 发牌
  room.dealCards();
  room.players.forEach(p => {
    if (!p.isAI) {
      io.to(p.id).emit('CARDS_DEALT', {
        playerId: p.id,
        cards: p.getCards()
      });
    } else {
      io.to(room.roomId).emit('CARDS_DEALT', {
        playerId: p.id,
        cardCount: 3,
        hidden: true
      });
    }
  });

  // 如果是AI房间，触发AI
  if (room.type === 'ai') {
    setTimeout(() => triggerAIAction(room), 1000);
  }
}

// ============ REST API ============
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, players: playerSockets.size });
});

app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values())
    .filter(r => r.status === 'waiting')
    .map(r => ({
      roomId: r.roomId,
      type: r.type,
      players: r.players.length,
      maxPlayers: r.maxPlayers,
      ante: r.ante,
      buyIn: r.buyIn
    }));
  res.json({ rooms: roomList });
});

app.post('/api/match', (req, res) => {
  // 快速匹配（简化版）
  const { difficulty, ante } = req.body;
  const room = createRoom({ type: 'ai', difficulty, ante: ante || 50, buyIn: 1000 });
  res.json({ success: true, roomId: room.roomId });
});

// ============ 启动 ============
server.listen(WS_PORT, () => {
  console.log(`[Server] 游戏服务器启动: ${WS_PORT}`);
});

app.listen(PORT, () => {
  console.log(`[Server] REST API 启动: ${PORT}`);
});

console.log('=================================');
console.log('   炸金花游戏服务器 v1.0');
console.log('   同舟智联出品');
console.log('=================================');
