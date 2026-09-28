import { randomInt, randomUUID } from "node:crypto";
import { choosePattern, createDeck, sortCards } from "../shared/cards.js";
import type {
  Card,
  Phase,
  Play,
  RoomView,
  SeatAction,
} from "../shared/types.js";
export class GameError extends Error {
  constructor(
    message: string,
    public code = "INVALID_ACTION",
  ) {
    super(message);
  }
}
interface Player {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  hand: Card[];
}
export class Room {
  players: Player[] = [];
  phase: Phase = "waiting";
  bottom: Card[] = [];
  landlordId: string | null = null;
  turnId: string | null = null;
  lastPlay: Play | null = null;
  actions: Record<string, SeatAction> = {};
  bidHistory: { playerId: string; bid: boolean }[] = [];
  candidate: string | null = null;
  result: RoomView["result"] = null;
  log: string[] = [];
  round = 0;
  revision = 0;
  passes = 0;
  updatedAt = Date.now();
  constructor(public code: string) {}
  get hostId() {
    return this.players[0]?.id || "";
  }
  touch() {
    this.revision++;
    this.updatedAt = Date.now();
  }
  record(text: string) {
    this.log = [...this.log.slice(-15), text];
  }
  player(id: string) {
    const p = this.players.find((p) => p.id === id);
    if (!p) throw new GameError("你不在这个房间里");
    return p;
  }
  add(name: string) {
    if (this.players.length >= 3) throw new GameError("房间已满，最多 3 人");
    if (this.phase !== "waiting") throw new GameError("本局已经开始");
    const player: Player = {
      id: randomUUID(),
      name,
      ready: false,
      connected: true,
      hand: [],
    };
    this.players.push(player);
    this.record(`${name} 来到了牌桌`);
    this.touch();
    return player;
  }
  connected(id: string, connected: boolean) {
    const p = this.player(id);
    if (p.connected === connected) return;
    p.connected = connected;
    if (!connected && this.phase === "waiting") p.ready = false;
    this.record(`${p.name} ${connected ? "已重新连接" : "暂时离线，等待重连"}`);
    this.touch();
  }
  remove(id: string) {
    const p = this.player(id);
    if (this.phase === "bidding" || this.phase === "playing") {
      this.reset();
      this.record(`${p.name} 离开，本局已取消，其他玩家请重新准备`);
    } else this.record(`${p.name} 离开了房间`);
    this.players = this.players.filter((p) => p.id !== id);
    delete this.actions[id];
    this.touch();
  }
  reset() {
    this.phase = "waiting";
    this.bottom = [];
    this.landlordId = null;
    this.turnId = null;
    this.lastPlay = null;
    this.actions = {};
    this.bidHistory = [];
    this.candidate = null;
    this.result = null;
    this.passes = 0;
    this.players.forEach((p) => {
      p.hand = [];
      p.ready = false;
    });
  }
  ready(id: string, ready: boolean) {
    if (this.phase !== "waiting") throw new GameError("当前不能更改准备状态");
    this.player(id).ready = ready;
    this.touch();
    if (
      this.players.length === 3 &&
      this.players.every((p) => p.ready && p.connected)
    )
      this.deal();
  }
  deal() {
    const deck = createDeck();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    this.players.forEach((p, i) => {
      p.hand = sortCards(deck.slice(i * 17, i * 17 + 17));
    });
    this.bottom = deck.slice(51);
    this.phase = "bidding";
    this.landlordId = null;
    this.turnId = this.players[randomInt(3)].id;
    this.bidHistory = [];
    this.candidate = null;
    this.actions = {};
    this.lastPlay = null;
    this.passes = 0;
    this.result = null;
    this.round++;
    this.record(
      `第 ${this.round} 局已发牌，${this.player(this.turnId).name} 先叫地主`,
    );
    this.touch();
  }
  next(id: string) {
    return this.players[(this.players.findIndex((p) => p.id === id) + 1) % 3]
      .id;
  }
  requireTurn(id: string, phase: Phase) {
    if (this.phase !== phase) throw new GameError("当前阶段不能这样操作");
    if (this.turnId !== id) throw new GameError("还没有轮到你");
    if (this.players.some((p) => !p.connected))
      throw new GameError("有人离线，牌局暂停，等待重连");
  }
  bid(id: string, bid: boolean) {
    this.requireTurn(id, "bidding");
    const text = bid
      ? this.candidate
        ? "抢地主"
        : "叫地主"
      : this.candidate
        ? "不抢"
        : "不叫";
    this.bidHistory.push({ playerId: id, bid });
    this.actions[id] = { text, cards: [] };
    this.record(`${this.player(id).name}：${text}`);
    if (bid) this.candidate = id;
    if (this.bidHistory.length === 3) {
      if (!this.candidate) {
        this.record("无人叫地主，重新洗牌");
        this.deal();
        return;
      }
      this.landlordId = this.candidate;
      this.turnId = this.candidate;
      const landlord = this.player(this.candidate);
      landlord.hand = sortCards([...landlord.hand, ...this.bottom]);
      this.phase = "playing";
      this.actions = {};
      this.record(`${landlord.name} 成为地主，获得 3 张底牌并先出牌`);
    } else this.turnId = this.next(id);
    this.touch();
  }
  play(id: string, ids: string[]) {
    this.requireTurn(id, "playing");
    if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
      throw new GameError("请选择有效且不重复的牌");
    const player = this.player(id);
    const cards = ids.map((cardId) => player.hand.find((c) => c.id === cardId));
    if (cards.some((c) => !c)) throw new GameError("不能打出不属于自己的牌");
    const validCards = sortCards(cards as Card[]);
    const pattern = choosePattern(validCards, this.lastPlay?.pattern);
    if (!pattern)
      throw new GameError(
        this.lastPlay
          ? "牌型不匹配或没有大过上一手"
          : "这些牌不能组成支持的牌型",
      );
    player.hand = player.hand.filter((c) => !ids.includes(c.id));
    this.lastPlay = { playerId: id, cards: validCards, pattern };
    this.passes = 0;
    this.actions[id] = { text: pattern.label, cards: validCards };
    this.record(
      `${player.name} 出了${pattern.label}（${validCards.length} 张）`,
    );
    if (player.hand.length === 0) {
      this.phase = "finished";
      this.turnId = null;
      this.result = {
        winnerId: id,
        side: id === this.landlordId ? "landlord" : "farmers",
      };
      this.record(`${this.result.side === "landlord" ? "地主" : "农民"}获胜！`);
    } else {
      this.turnId = this.next(id);
      delete this.actions[this.turnId];
    }
    this.touch();
  }
  pass(id: string) {
    this.requireTurn(id, "playing");
    if (!this.lastPlay) throw new GameError("新一轮必须出牌，不能不出");
    this.actions[id] = { text: "不出", cards: [] };
    this.record(`${this.player(id).name}：不出`);
    this.passes++;
    if (this.passes === 2) {
      this.turnId = this.lastPlay.playerId;
      this.lastPlay = null;
      this.passes = 0;
      this.actions = {};
      this.record(`${this.player(this.turnId).name} 重新领出`);
    } else {
      this.turnId = this.next(id);
      delete this.actions[this.turnId];
    }
    this.touch();
  }
  rematch(id: string) {
    this.player(id);
    if (this.phase !== "finished") throw new GameError("本局尚未结束");
    this.reset();
    this.record("新一局已就绪，所有人请重新准备");
    this.touch();
  }
  view(selfId: string): RoomView {
    return {
      code: this.code,
      revision: this.revision,
      phase: this.phase,
      selfId,
      hostId: this.hostId,
      players: this.players.map(({ hand, ...p }) => ({
        ...p,
        cardCount: hand.length,
      })),
      hand: [...this.player(selfId).hand],
      bottomCards: this.landlordId ? [...this.bottom] : [],
      landlordId: this.landlordId,
      turnId: this.turnId,
      lastPlay: this.lastPlay,
      actions: this.actions,
      bidHistory: this.bidHistory,
      result: this.result,
      log: this.log,
      round: this.round,
    };
  }
}
