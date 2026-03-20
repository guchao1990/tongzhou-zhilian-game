/**
 * 扑克牌工具类
 * 炸金花游戏核心算法
 */

const SUITS = ['♠', '♥', '♦', '♣']; // 黑红方梅
const SUIT_NAMES = ['spade', 'heart', 'diamond', 'club'];
const POINTS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const POINT_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

// ============ 牌型定义 ============
const HAND_TYPES = {
  LEOPARD: '豹子',      // 三张相同点数 AAA
  SPADE_SEQUENCE: '顺金', // 同花色三张相连
  GOLDEN_FLOWER: '金花', // 同花色但不相连
  SEQUENCE: '顺子',     // 三张相连但不同花色
  PAIR: '对子',        // 两张相同
  SINGLE: '单张'        // 散牌
};

// 牌型大小分（用于比牌）
const HAND_TYPE_SCORE = {
  [HAND_TYPES.LEOPARD]: 10000,
  [HAND_TYPES.SPADE_SEQUENCE]: 9000,
  [HAND_TYPES.GOLDEN_FLOWER]: 8000,
  [HAND_TYPES.SEQUENCE]: 7000,
  [HAND_TYPES.PAIR]: 6000,
  [HAND_TYPES.SINGLE]: 0
};

// ============ 扑克牌类 ============
class Card {
  constructor(suit, point) {
    this.suit = suit;       // '♠' '♥' '♦' '♣'
    this.point = point;     // '2'-'10','J','Q','K','A'
    this.value = POINT_VALUES[point];
  }

  toString() {
    return this.suit + this.point;
  }

  toJSON() {
    return {
      suit: this.suit,
      point: this.point,
      value: this.value
    };
  }
}

// ============ 牌组类 ============
class CardGroup {
  constructor(cards = []) {
    this.cards = cards; // Card[]
  }

  add(card) {
    this.cards.push(card);
  }

  sort() {
    this.cards.sort((a, b) => b.value - a.value);
  }

  // 获取牌型
  getHandType() {
    if (this.cards.length !== 3) return null;
    this.sort();

    const [c1, c2, c3] = this.cards;
    const isSameSuit = c1.suit === c2.suit && c2.suit === c3.suit;
    const isSequence = (c1.value - c2.value === 1) && (c2.value - c3.value === 1);
    const isSamePoint = c1.value === c2.value && c2.value === c3.value;

    // 豹子：三张相同
    if (isSamePoint) {
      return { type: HAND_TYPES.LEOPARD, score: HAND_TYPE_SCORE[HAND_TYPES.LEOPARD] + c1.value };
    }

    // 顺金：同花色三张相连
    if (isSameSuit && isSequence) {
      // QKA是最大顺金
      if (c1.value === 14 && c2.value === 13 && c3.value === 12) {
        return { type: HAND_TYPES.SPADE_SEQUENCE, score: HAND_TYPE_SCORE[HAND_TYPES.SPADE_SEQUENCE] + 100 }; // QKA特殊处理
      }
      return { type: HAND_TYPES.SPADE_SEQUENCE, score: HAND_TYPE_SCORE[HAND_TYPES.SPADE_SEQUENCE] + c1.value };
    }

    // 金花：同花色但不相连
    if (isSameSuit && !isSequence) {
      return { type: HAND_TYPES.GOLDEN_FLOWER, score: HAND_TYPE_SCORE[HAND_TYPES.GOLDEN_FLOWER] + c1.value };
    }

    // 顺子：三张相连但不同花色
    if (!isSameSuit && isSequence) {
      // QKA是最大顺子
      if (c1.value === 14 && c2.value === 13 && c3.value === 12) {
        return { type: HAND_TYPES.SEQUENCE, score: HAND_TYPE_SCORE[HAND_TYPES.SEQUENCE] + 100 };
      }
      return { type: HAND_TYPES.SEQUENCE, score: HAND_TYPE_SCORE[HAND_TYPES.SEQUENCE] + c1.value };
    }

    // 对子
    if (isSamePoint) {
      // 找出对子和单张
      let pairValue, singleValue;
      if (c1.value === c2.value) {
        pairValue = c1.value;
        singleValue = c3.value;
      } else if (c2.value === c3.value) {
        pairValue = c2.value;
        singleValue = c1.value;
      } else {
        pairValue = c1.value;
        singleValue = c2.value;
      }
      return { type: HAND_TYPES.PAIR, score: HAND_TYPE_SCORE[HAND_TYPES.PAIR] + pairValue * 10 + singleValue };
    }

    // 单张
    return { type: HAND_TYPES.SINGLE, score: HAND_TYPE_SCORE[HAND_TYPES.SINGLE] + c1.value * 100 + c2.value * 10 + c3.value };
  }

  // 比牌（返回正数表示this赢）
  compareTo(other) {
    const thisHand = this.getHandType();
    const otherHand = other.getHandType();

    if (thisHand.score > otherHand.score) return 1;
    if (thisHand.score < otherHand.score) return -1;
    return 0;
  }
}

// ============ 牌组工具 ============
const CardUtils = {
  // 创建一副牌
  createDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const point of POINTS) {
        deck.push(new Card(suit, point));
      }
    }
    return deck;
  },

  // 洗牌
  shuffle(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  },

  // 发牌（从牌堆顶部）
  dealCards(deck, count) {
    return deck.splice(0, count);
  },

  // 比较两手牌
  compare(cards1, cards2) {
    const group1 = new CardGroup(cards1);
    const group2 = new CardGroup(cards2);
    return group1.compareTo(group2);
  },

  // 获取牌型名称
  getHandTypeName(cards) {
    const group = new CardGroup(cards);
    return group.getHandType().type;
  },

  // 获取牌型分数
  getHandScore(cards) {
    const group = new CardGroup(cards);
    return group.getHandType().score;
  },

  // 生成随机3张手牌（用于测试/发牌）
  generateRandomHand(deck) {
    const hand = this.dealCards(deck, 3);
    return hand;
  },

  // 创建特定牌（测试用）
  createCard(suit, point) {
    return new Card(suit, point);
  },

  HAND_TYPES,
  SUITS,
  POINTS,
  POINT_VALUES
};

module.exports = {
  Card,
  CardGroup,
  CardUtils,
  HAND_TYPES,
  HAND_TYPE_SCORE
};
