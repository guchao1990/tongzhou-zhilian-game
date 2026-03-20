/**
 * 玩家类
 */
const { CardGroup, CardUtils } = require('./CardUtils');

class Player {
  constructor({ id, nickname, isAI = false }) {
    this.id = id;
    this.nickname = nickname;
    this.isAI = isAI;
    this.chips = 0;          // 当前筹码
    this.cards = [];         // 手牌
    this.status = 'waiting';  // waiting | playing | folded | allIn | out
    this.currentBet = 0;     // 本轮已下注
    this.totalBet = 0;      // 本局已下注总额
    this.isDealer = false;   // 是否是庄家
    this.lastAction = null;  // 最后一次操作
  }

  // 买入筹码
  buyIn(amount) {
    this.chips += amount;
    return this.chips;
  }

  // 下注
  bet(amount) {
    if (amount > this.chips) {
      amount = this.chips; // 全下
    }
    this.chips -= amount;
    this.currentBet += amount;
    this.totalBet += amount;
    return amount;
  }

  // 设置手牌
  setCards(cards) {
    this.cards = cards;
    this.status = 'playing';
  }

  // 看牌
  lookCards() {
    if (this.cards.length === 3) {
      return this.cards.map(c => c.toJSON());
    }
    return null;
  }

  // 获取手牌信息（加密显示）
  getCards() {
    if (this.cards.length === 0) return [];
    if (this.isAI) {
      // AI的手牌只显示背面（后续由前端处理）
      return this.cards.map((c, i) => ({
        index: i,
        hidden: true
      }));
    }
    return this.cards.map(c => c.toJSON());
  }

  // 获取手牌明文
  revealCards() {
    return this.cards.map(c => c.toJSON());
  }

  // 获取牌型
  getHandType() {
    if (this.cards.length !== 3) return null;
    const group = new CardGroup(this.cards);
    return group.getHandType();
  }

  // 弃牌
  fold() {
    this.status = 'folded';
    this.cards = [];
    this.lastAction = 'FOLD';
  }

  // 比牌输赢（扣筹码）
  loseCompare(bet) {
    this.chips -= bet;
    if (this.chips <= 0) {
      this.status = 'out';
    }
    return this.chips;
  }

  // 赢筹码
  winChips(amount) {
    this.chips += amount;
    return this.chips;
  }

  // 重置本轮状态
  resetRound() {
    this.currentBet = 0;
    this.lastAction = null;
  }

  // 重置本局状态
  resetGame() {
    this.cards = [];
    this.status = 'waiting';
    this.currentBet = 0;
    this.totalBet = 0;
    this.lastAction = null;
  }

  // 获取玩家信息
  getInfo() {
    return {
      id: this.id,
      nickname: this.nickname,
      isAI: this.isAI,
      chips: this.chips,
      status: this.status,
      isDealer: this.isDealer,
      hasCards: this.cards.length > 0,
      lastAction: this.lastAction
    };
  }
}

module.exports = Player;
