export type Suit = "spade" | "heart" | "club" | "diamond" | "joker";
export interface Card {
  id: string;
  rank: number;
  suit: Suit;
}
export type PatternType =
  | "single"
  | "pair"
  | "triple"
  | "triple-single"
  | "triple-pair"
  | "straight"
  | "pair-straight"
  | "airplane"
  | "airplane-single"
  | "airplane-pair"
  | "four-single"
  | "four-pair"
  | "bomb"
  | "rocket";
export interface Pattern {
  type: PatternType;
  rank: number;
  size: number;
  chain: number;
  label: string;
}
export interface Play {
  playerId: string;
  cards: Card[];
  pattern: Pattern;
}
export type Phase = "waiting" | "bidding" | "playing" | "finished";
export interface PlayerView {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  cardCount: number;
}
export interface SeatAction {
  text: string;
  cards: Card[];
}
export interface RoomView {
  code: string;
  revision: number;
  phase: Phase;
  selfId: string;
  hostId: string;
  players: PlayerView[];
  hand: Card[];
  bottomCards: Card[];
  landlordId: string | null;
  turnId: string | null;
  lastPlay: Play | null;
  actions: Record<string, SeatAction>;
  bidHistory: { playerId: string; bid: boolean }[];
  result: { winnerId: string; side: "landlord" | "farmers" } | null;
  log: string[];
  round: number;
}
export interface Session {
  token: string;
  roomCode: string;
  playerId: string;
}
export type ClientMessage =
  | { type: "create"; requestId: string; name: string }
  | { type: "join"; requestId: string; name: string; code: string }
  | { type: "resume"; requestId: string; token: string }
  | { type: "ready"; requestId: string; ready: boolean }
  | { type: "bid"; requestId: string; bid: boolean }
  | { type: "play"; requestId: string; cardIds: string[] }
  | { type: "pass" | "leave" | "rematch" | "ping"; requestId: string };
export type ServerMessage =
  | { type: "state"; room: RoomView }
  | {
      type: "ack";
      requestId: string;
      ok: boolean;
      error?: string;
      code?: string;
      session?: Session;
    }
  | { type: "notice"; message: string; code?: string };
