import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import { networkInterfaces } from "node:os";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { GameError, Room } from "./game.js";
import type { ClientMessage, ServerMessage, Session } from "../shared/types.js";
interface ActiveSession extends Session {
  socket: WebSocket | null;
  disconnectedAt: number | null;
}
interface SocketMeta {
  token?: string;
  alive: boolean;
  window: number;
  count: number;
}
export function createGameServer(
  options: { staticDir?: string; reconnectMs?: number; idleMs?: number } = {},
) {
  const rooms = new Map<string, Room>();
  const sessions = new Map<string, ActiveSession>();
  const meta = new Map<WebSocket, SocketMeta>();
  const reconnectMs = options.reconnectMs ?? 120_000;
  const idleMs = options.idleMs ?? 6 * 60 * 60 * 1000;
  const send = (ws: WebSocket, message: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  function broadcast(room: Room) {
    for (const session of sessions.values())
      if (session.roomCode === room.code && session.socket)
        send(session.socket, {
          type: "state",
          room: room.view(session.playerId),
        });
  }
  function removeSession(session: ActiveSession) {
    sessions.delete(session.token);
    if (session.socket) {
      const m = meta.get(session.socket);
      if (m) delete m.token;
    }
    const room = rooms.get(session.roomCode);
    if (!room) return;
    room.remove(session.playerId);
    if (!room.players.length) rooms.delete(room.code);
    else broadcast(room);
  }
  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  }
  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (url.pathname === "/api/health") {
      json(res, 200, { ok: true, rooms: rooms.size });
      return;
    }
    if (url.pathname === "/api/network") {
      const addresses = [
        ...new Set(
          Object.values(networkInterfaces()).flatMap((list) =>
            (list || [])
              .filter(
                (i) =>
                  i.family === "IPv4" &&
                  !i.internal &&
                  !i.address.startsWith("169.254."),
              )
              .map((i) => i.address),
          ),
        ),
      ];
      json(res, 200, { addresses });
      return;
    }
    if (!options.staticDir) {
      json(res, 404, { error: "请从前端地址进入游戏（默认端口 5173）" });
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const root = resolve(options.staticDir);
    const path = resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!path.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const mime: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".png": "image/png",
    };
    try {
      const content = await readFile(path);
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
  const server = createServer((req, res) => {
    void handleHttp(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    // Same-host origin checks prevent unrelated web pages from controlling a local game.
    let validOrigin = true;
    try {
      if (req.headers.origin)
        validOrigin = new URL(req.headers.origin).host === req.headers.host;
    } catch {
      validOrigin = false;
    }
    if (req.url !== "/ws" || !validOrigin || meta.size >= 300) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  wss.on("connection", (ws) => {
    meta.set(ws, { alive: true, window: Date.now(), count: 0 });
    ws.on("pong", () => {
      const m = meta.get(ws);
      if (m) m.alive = true;
    });
    ws.on("error", () => {});
    ws.on("message", (raw) => {
      const m = meta.get(ws)!;
      let requestId = "";
      try {
        if (Date.now() - m.window > 5000) {
          m.window = Date.now();
          m.count = 0;
        }
        if (++m.count > 60)
          throw new GameError("操作太快，请稍后再试", "RATE_LIMIT");
        let data: ClientMessage;
        try {
          data = JSON.parse(raw.toString());
        } catch {
          throw new GameError("消息不是有效 JSON");
        }
        if (
          !data ||
          typeof data !== "object" ||
          typeof data.requestId !== "string" ||
          data.requestId.length > 80
        )
          throw new GameError("无效的请求");
        requestId = data.requestId;
        if (data.type === "ping") {
          send(ws, { type: "ack", requestId, ok: true });
          return;
        }
        if (data.type === "resume") {
          if (m.token) throw new GameError("你已经在房间里了");
          if (typeof data.token !== "string")
            throw new GameError("无效的重连凭证");
          const session = sessions.get(data.token);
          if (!session || !rooms.has(session.roomCode))
            throw new GameError(
              "房间或重连凭证已过期，请重新加入",
              "SESSION_EXPIRED",
            );
          if (session.socket && session.socket !== ws) {
            const old = session.socket;
            const oldMeta = meta.get(old);
            if (oldMeta) delete oldMeta.token;
            send(old, {
              type: "notice",
              code: "SESSION_REPLACED",
              message: "这个座位已在另一个标签页连接",
            });
            old.close(4001, "Session replaced");
          }
          session.socket = ws;
          session.disconnectedAt = null;
          m.token = session.token;
          const room = rooms.get(session.roomCode)!;
          room.connected(session.playerId, true);
          send(ws, {
            type: "ack",
            requestId,
            ok: true,
            session: {
              token: session.token,
              roomCode: room.code,
              playerId: session.playerId,
            },
          });
          broadcast(room);
          return;
        }
        if (data.type === "create" || data.type === "join") {
          if (m.token) throw new GameError("请先离开当前房间");
          if (typeof data.name !== "string") throw new GameError("请填写昵称");
          const name = data.name.trim();
          if (!name || [...name].length > 12 || /[\x00-\x1f\x7f]/.test(name))
            throw new GameError("昵称需要 1–12 个字且不能包含控制字符");
          let room: Room;
          if (data.type === "create") {
            if (rooms.size >= 100) throw new GameError("房间数量已达上限");
            let code: string;
            do {
              code = String(randomInt(100000, 1000000));
            } while (rooms.has(code));
            room = new Room(code);
            rooms.set(code, room);
          } else {
            if (typeof data.code !== "string" || !/^\d{6}$/.test(data.code))
              throw new GameError("请输入 6 位房间号");
            const found = rooms.get(data.code);
            if (!found) throw new GameError("找不到这个房间，请检查房间号");
            room = found;
          }
          const player = room.add(name);
          const session: ActiveSession = {
            token: randomBytes(32).toString("hex"),
            playerId: player.id,
            roomCode: room.code,
            socket: ws,
            disconnectedAt: null,
          };
          sessions.set(session.token, session);
          m.token = session.token;
          send(ws, {
            type: "ack",
            requestId,
            ok: true,
            session: {
              token: session.token,
              roomCode: room.code,
              playerId: player.id,
            },
          });
          broadcast(room);
          return;
        }
        const session = m.token ? sessions.get(m.token) : undefined;
        if (!session || session.socket !== ws)
          throw new GameError("请先创建或加入房间", "NOT_JOINED");
        const room = rooms.get(session.roomCode)!;
        switch (data.type) {
          case "ready":
            if (typeof data.ready !== "boolean")
              throw new GameError("准备状态无效");
            room.ready(session.playerId, data.ready);
            break;
          case "bid":
            if (typeof data.bid !== "boolean")
              throw new GameError("叫抢参数无效");
            room.bid(session.playerId, data.bid);
            break;
          case "play":
            if (
              !Array.isArray(data.cardIds) ||
              !data.cardIds.every((i) => typeof i === "string")
            )
              throw new GameError("出牌参数无效");
            room.play(session.playerId, data.cardIds);
            break;
          case "pass":
            room.pass(session.playerId);
            break;
          case "rematch":
            room.rematch(session.playerId);
            break;
          case "leave":
            removeSession(session);
            send(ws, { type: "ack", requestId, ok: true });
            return;
          default:
            throw new GameError("不支持的操作");
        }
        send(ws, { type: "ack", requestId, ok: true });
        broadcast(room);
      } catch (e) {
        if (!(e instanceof GameError)) console.error("Request failed:", e);
        send(ws, {
          type: "ack",
          requestId,
          ok: false,
          error:
            e instanceof GameError ? e.message : "服务器暂时无法处理这个操作",
          code: e instanceof GameError ? e.code : "INTERNAL",
        });
      }
    });
    ws.on("close", () => {
      const m = meta.get(ws);
      meta.delete(ws);
      const session = m?.token ? sessions.get(m.token) : undefined;
      if (session?.socket === ws) {
        session.socket = null;
        session.disconnectedAt = Date.now();
        const room = rooms.get(session.roomCode);
        if (room) {
          room.connected(session.playerId, false);
          broadcast(room);
        }
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const [ws, m] of meta) {
      if (!m.alive) ws.terminate();
      else {
        m.alive = false;
        ws.ping();
      }
    }
  }, 15000);
  const cleanup = setInterval(
    () => {
      const now = Date.now();
      for (const session of sessions.values())
        if (
          session.disconnectedAt !== null &&
          now - session.disconnectedAt > reconnectMs
        )
          removeSession(session);
      for (const room of rooms.values()) {
        if (now - room.updatedAt < idleMs) continue;
        for (const s of sessions.values())
          if (s.roomCode === room.code) {
            if (s.socket) {
              send(s.socket, {
                type: "notice",
                code: "SESSION_EXPIRED",
                message: "房间长时间没有操作，已关闭",
              });
              const m = meta.get(s.socket);
              if (m) delete m.token;
            }
            sessions.delete(s.token);
          }
        rooms.delete(room.code);
      }
    },
    Math.min(5000, Math.max(25, reconnectMs / 2)),
  );
  heartbeat.unref();
  cleanup.unref();
  async function close() {
    clearInterval(heartbeat);
    clearInterval(cleanup);
    for (const ws of meta.keys()) ws.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
  }
  return { server, rooms, sessions, close };
}
