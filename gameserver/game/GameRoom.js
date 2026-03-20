/**
 * 游戏房间类
 * 核心游戏逻辑
 */
const Player = require('./Player');
const { CardUtils, HAND_TYPES } = require('./CardUtils');

class GameRoom {
  constructor({ roomId, maxPlayers = 6, type = 'single', difficulty = 'normal', ante = 50, buyIn = 1000 }) {
    this.roomId = roomId;
    this.maxPlayers = maxPlayers;
    this.type = type; // 'single' | 'ai' | 'online'
    this.difficulty = difficulty; // 'easy' | 'normal' | 'hard'
    this.ante = ante;    // 底注
    this.buyIn = buyIn;  // 买入

    this.players = [];
    this.deck = [];
    this.dealer = null;        // 庄家索引
    this.currentPlayer = null;  // 当前行动玩家索引
    this.round = 0;           // 当前回合（1,2,3）
    this.maxRounds = 3;       // 最大回合数
    this.pot = 0;              // 底池
    this.status = 'waiting';   // waiting | playing | ended

    this.currentBet = 0;       // 当前最高下注
    this.turnTimer = null;     // 回合计时器
    this.turnTimeout = 15000;  // 15秒超时

    this.dealer = 0; // 初始庄家位置
  }

  // 添加玩家
  addPlayer(player) {
    if (this.players.length >= this.maxPlayers) {
      throw new Error('房间已满');
    }
    player.buyIn(this.buyIn);
    this.players.push(player);
    return player;
  }

  // 移除玩家
  removePlayer(playerId) {
    const index = this.players.findIndex(p => p.id === playerId);
    if (index !== -1) {
      this.players.splice(index, 1);
      // 调整庄家
      if (this.players.length > 0) {
        this.dealer = this.dealer % this.players.length;
      }
    }
  }

  // 获取活跃玩家
  getActivePlayers() {
    return this.players.filter(p => p.status !== 'folded' && p.status !== 'out');
  }

  // 获取当前玩家
  getCurrentPlayer() {
    const active = this.getActivePlayers();
    if (active.length === 0) return null;
    return active[this.currentPlayer % active.length];
  }

  // 获取当前AI玩家
  getCurrentAIPlayer() {
    const player = this.getCurrentPlayer();
    if (player && player.isAI) return player;
    return null;
  }

  // 是否需要AI回合
  needAITurn() {
    const player = this.getCurrentPlayer();
    return player && player.isAI;
  }

  // 开始游戏
  startGame() {
    if (this.players.length < 2) {
      throw new Error('至少需要2名玩家');
    }
    this.status = 'playing';
    this.round = 1;
    this.pot = 0;
    this.currentBet = 0;
    this.dealer = this.dealer % this.players.length;

    // 设置庄家
    this.players.forEach((p, i) => {
      p.isDealer = (i === this.dealer);
      p.resetGame();
    });

    // 第一个行动的是庄家下家
    this.currentPlayer = (this.dealer + 1) % this.players.length;

    // 底池初始化（下盲注）
    this.pot = this.ante * this.players.length;
    const smallBlindPos = (this.dealer + 1) % this.players.length;
    const bigBlindPos = (this.dealer + 2) % this.players.length;
    this.players[smallBlindPos].bet(this.ante);
    this.players[bigBlindPos].bet(this.ante * 2);
    this.currentBet = this.ante * 2;

    console.log(`[Game] 游戏开始: 房间 ${this.roomId}, ${this.players.length}人, 底注 ${this.ante}`);
  }

  // 发牌
  dealCards() {
    this.deck = CardUtils.createDeck();
    this.deck = CardUtils.shuffle(this.deck);

    // 每位玩家发3张
    for (let i = 0; i < 3; i++) {
      for (const player of this.players) {
        const card = CardUtils.dealCards(this.deck, 1)[0];
        player.cards.push(card);
      }
    }
    console.log(`[Game] 发牌完成: 房间 ${this.roomId}`);
  }

  // 处理玩家操作
  handleAction(playerId, action, amount = 0) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return { success: false, error: '玩家不存在' };
    if (player.status === 'folded') return { success: false, error: '已弃牌' };
    if (player.status === 'out') return { success: false, error: '已出局' };

    // 验证下注金额
    const toCall = this.currentBet - player.currentBet;

    switch (action) {
      case 'FOLLOW': // 跟注
      case 'CALL':
        const callAmount = toCall;
        if (player.chips < callAmount) {
          // 全下
          player.bet(player.chips);
        } else {
          player.bet(callAmount);
        }
        this.pot += player.currentBet;
        player.lastAction = 'CALL';
        break;

      case 'RAISE': // 加注
        if (amount <= this.currentBet) {
          return { success: false, error: '加注金额必须大于当前下注' };
        }
        const raiseAmount = amount - player.currentBet;
        if (player.chips < raiseAmount) {
          return { success: false, error: '筹码不足' };
        }
        player.bet(raiseAmount);
        this.pot += player.currentBet;
        this.currentBet = amount;
        player.lastAction = 'RAISE';
        break;

      case 'CHECK': // 看牌（不下注）
        if (player.currentBet < this.currentBet) {
          return { success: false, error: '需要跟注才能看牌' };
        }
        player.lastAction = 'CHECK';
        break;

      case 'FOLD': // 弃牌
        player.fold();
        player.lastAction = 'FOLD';
        break;

      case 'ALL_IN': // 全下
        player.bet(player.chips);
        this.pot += player.currentBet;
        if (player.currentBet > this.currentBet) {
          this.currentBet = player.currentBet;
        }
        player.lastAction = 'ALL_IN';
        player.status = 'allIn';
        break;

      default:
        return { success: false, error: '未知操作' };
    }

    // 移动到下一玩家
    this.moveToNextPlayer();

    return { success: true, state: this.getState(playerId) };
  }

  // 移动到下一玩家
  moveToNextPlayer() {
    const active = this.getActivePlayers();
    if (active.length <= 1) return;

    // 找到当前玩家在活跃列表中的位置
    const current = this.getCurrentPlayer();
    const currentIdx = active.findIndex(p => p.id === current.id);
    
    // 移动到下一个
    this.currentPlayer = (currentIdx + 1) % active.length;
  }

  // 检查回合是否结束
  isRoundOver() {
    const active = this.getActivePlayers();
    if (active.length === 1) return true; // 只剩一人

    // 检查是否所有人都已下注相同金额
    const bets = active.map(p => p.currentBet);
    const uniqueBets = [...new Set(bets.filter(b => b > 0))];
    if (uniqueBets.length === 1 && bets.every(b => b === this.currentBet)) {
      // 所有活跃玩家已下相同注
      // 检查是否所有人都已行动
      const allActed = active.every(p => p.lastAction !== null);
      return allActed;
    }

    return false;
  }

  // 回合结算
  settleRound() {
    const active = this.getActivePlayers();

    // 比较手牌
    let winner = active[0];
    let maxScore = winner.getHandType().score;

    for (const player of active) {
      const score = player.getHandType().score;
      if (score > maxScore) {
        maxScore = score;
        winner = player;
      }
    }

    // 赢家拿走底池
    winner.winChips(this.pot);

    return {
      round: this.round,
      winner: winner.id,
      winnerName: winner.nickname,
      handType: winner.getHandType().type,
      pot: this.pot,
      payout: this.pot
    };
  }

  // 局结算
  settleGame() {
    const active = this.getActivePlayers();
    
    // 按剩余筹码排序
    active.sort((a, b) => b.chips - a.chips);

    return {
      players: active.map((p, i) => ({
        rank: i + 1,
        playerId: p.id,
        nickname: p.nickname,
        finalChips: p.chips,
        handType: p.getHandType()?.type
      })),
      winner: active[0].id,
      winnerName: active[0].nickname
    };
  }

  // 下一回合
  nextRound() {
    this.round++;
    this.currentBet = 0;
    this.players.forEach(p => p.resetRound());
    console.log(`[Game] 第${this.round}回合开始: 房间 ${this.roomId}`);
  }

  // 获取房间状态
  getState(playerId) {
    return {
      roomId: this.roomId,
      type: this.type,
      status: this.status,
      round: this.round,
      pot: this.pot,
      currentBet: this.currentBet,
      dealer: this.dealer,
      players: this.players.map(p => ({
        ...p.getInfo(),
        cards: p.isAI ? p.getCards() : (p.id === playerId ? p.lookCards() : null)
      }))
    };
  }

  // 获取玩家信息（简化）
  getPlayerInfo() {
    return this.players.map(p => p.getInfo());
  }
}

module.exports = GameRoom;
