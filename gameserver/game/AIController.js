/**
 * AI控制器
 * 炸金花 NPC智能决策
 */
const { CardGroup } = require('./CardUtils');

const AI_CONFIG = {
  easy: {
    看牌率: 0.6,
    跟注率: 0.3,
    加注率: 0.15,
    诈唬率: 0.03,
    加注倍数: [1.5, 2],  // 1.5-2倍底池
  },
  normal: {
    看牌率: 0.5,
    跟注率: 0.45,
    加注率: 0.25,
    诈唬率: 0.10,
    加注倍数: [2, 3],
  },
  hard: {
    看牌率: 0.4,
    跟注率: 0.55,
    加注率: 0.40,
    诈唬率: 0.18,
    加注倍数: [2.5, 4],
  }
};

class AIController {
  constructor() {
    this.opponentHistory = new Map(); // 记录对手历史行为
  }

  /**
   * AI决策主入口
   * @param {Player} player - AI玩家
   * @param {GameRoom} room - 游戏房间
   * @param {string} difficulty - 难度
   * @returns {{ type: string, amount: number }}
   */
  decide(player, room, difficulty = 'normal') {
    const config = AI_CONFIG[difficulty];
    if (!config) throw new Error('未知难度: ' + difficulty);

    const handType = player.getHandType();
    const handStrength = this.evaluateHandStrength(player.cards);
    const toCall = room.currentBet - player.currentBet;
    const potSize = room.pot;
    const myChips = player.chips;

    // 随机决策树
    const rand = Math.random();

    // 弃牌（手牌太差）
    if (handStrength < 0.1) {
      // 超弱牌，随机弃牌
      if (rand < 0.8) {
        return { type: 'FOLD', amount: 0 };
      }
    }

    // 弱牌（0.1-0.3）
    if (handStrength < 0.3) {
      // 看牌或弃牌
      if (rand < config.看牌率) {
        return { type: 'CHECK', amount: 0 };
      }
      // 有一定概率跟注（便宜的局）
      if (toCall <= potSize * 0.1 && rand < config.跟注率) {
        return { type: 'CALL', amount: toCall };
      }
      if (rand < 0.2) {
        return { type: 'FOLD', amount: 0 };
      }
      return { type: 'CHECK', amount: 0 };
    }

    // 中等牌（0.3-0.6）
    if (handStrength < 0.6) {
      // 优先跟注
      if (toCall > 0) {
        if (rand < config.跟注率) {
          return { type: toCall > myChips * 0.2 ? 'ALL_IN' : 'CALL', amount: toCall };
        }
        if (rand < 0.3) {
          return { type: 'FOLD', amount: 0 };
        }
      }
      // 可能加注
      if (rand < config.加注率) {
        const raiseAmount = this.calculateRaise(room, config);
        if (raiseAmount <= myChips) {
          return { type: 'RAISE', amount: raiseAmount };
        }
      }
      return { type: 'CHECK', amount: 0 };
    }

    // 强牌（0.6-0.85）
    if (handStrength < 0.85) {
      // 主动加注
      if (rand < config.加注率) {
        const raiseAmount = this.calculateRaise(room, config);
        if (raiseAmount <= myChips) {
          return { type: 'RAISE', amount: raiseAmount };
        }
      }
      // 跟注/加注
      if (toCall > 0) {
        if (rand < 0.8) {
          return { type: toCall > myChips * 0.3 ? 'ALL_IN' : 'CALL', amount: toCall };
        }
      }
      return { type: 'CHECK', amount: 0 };
    }

    // 顶级牌（0.85+）
    // 豹子/顺金/金花 主动进攻
    if (handStrength >= 0.85) {
      // 强力加注
      if (potSize > 0 && rand < config.加注率 * 1.5) {
        const raiseAmount = this.calculateRaise(room, config, 2); // 2倍加注
        if (raiseAmount <= myChips) {
          return { type: 'RAISE', amount: raiseAmount };
        }
      }
      if (toCall > 0) {
        if (toCall < myChips * 0.5) {
          return { type: 'CALL', amount: toCall };
        }
      }
      return { type: 'CHECK', amount: 0 };
    }

    return { type: 'CHECK', amount: 0 };
  }

  /**
   * 评估手牌强度 0-1
   */
  evaluateHandStrength(cards) {
    if (!cards || cards.length !== 3) return 0;
    
    const group = new CardGroup(cards);
    const hand = group.getHandType();
    
    // 基础分
    let score = hand.score;

    // 归一化到0-1
    // 豹子基础分 10014-10026
    // 顺金基础分 9000-9100
    // 金花基础分 8000+
    // 顺子基础分 7000+
    // 对子基础分 6000+
    // 单张基础分 0-7000

    const maxScore = 10100; // AAK的分数
    const normalized = score / maxScore;

    // 特殊牌型加成
    const { type } = hand;
    if (type === '豹子') return 0.95 + Math.random() * 0.05;
    if (type === '顺金') return 0.88 + Math.random() * 0.07;
    if (type === '金花') return 0.75 + Math.random() * 0.13;
    if (type === '顺子') return 0.60 + Math.random() * 0.15;
    if (type === '对子') return 0.40 + Math.random() * 0.20;

    return normalized * 0.6; // 单张最高0.6
  }

  /**
   * 计算加注金额
   */
  calculateRaise(room, config, multiplier = 1) {
    const [min, max] = config.加注倍数;
    const base = room.currentBet > 0 ? room.currentBet : room.ante;
    const raiseAmount = base * (min + Math.random() * (max - min)) * multiplier;
    return Math.floor(raiseAmount / 10) * 10; // 取整到10
  }

  /**
   * 诈唬决策（困难模式）
   */
  shouldBluff(player, room, config) {
    if (config.诈唬率 < 0.1) return false;

    const activePlayers = room.getActivePlayers();
    const toCall = room.currentBet - player.currentBet;

    // 底池够大时诈唬更有效
    const potOdds = toCall / (room.pot + toCall);

    // 弱牌但试图诈唬
    const handStrength = this.evaluateHandStrength(player.cards);
    if (handStrength < 0.3 && Math.random() < config.诈唬率) {
      // 有时在转机或河牌诈唬
      if (room.round >= 2 && toCall < room.pot * 0.3) {
        return true;
      }
    }

    return false;
  }
}

module.exports = AIController;
