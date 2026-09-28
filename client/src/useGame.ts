import { ref, computed, onBeforeUnmount } from "vue";
import type {
  ClientMessage,
  RoomView,
  ServerMessage,
  Session,
} from "../../shared/types.js";
type Command = ClientMessage extends infer T
  ? T extends { requestId: string }
    ? Omit<T, "requestId">
    : never
  : never;
const KEY = "tongzhuo-session-v1";
export function useGame() {
  const room = ref<RoomView | null>(null);
  const status = ref<"connecting" | "connected" | "disconnected">("connecting");
  const toast = ref("");
  const busy = ref(false);
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let attempts = 0;
  let seq = 0;
  let token = "";
  // Per-tab credentials: three tabs can test three independent players, refresh still resumes.
  try {
    token = sessionStorage.getItem(KEY) || "";
  } catch {
    /* private browsing */
  }
  const pending = new Map<
    string,
    { resolve: (v: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  function notify(text: string) {
    toast.value = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ""), 4500);
  }
  function saveSession(session?: Session) {
    token = session?.token || "";
    try {
      if (token) sessionStorage.setItem(KEY, token);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage disabled */
    }
  }
  function settle(requestId: string, ok: boolean) {
    const entry = pending.get(requestId);
    if (entry) {
      clearTimeout(entry.timer);
      entry.resolve(ok);
      pending.delete(requestId);
    }
    busy.value = pending.size > 0;
  }
  function request(command: Command): Promise<boolean> {
    if (socket?.readyState !== WebSocket.OPEN) {
      notify("正在连接服务器，请稍等");
      return Promise.resolve(false);
    }
    const requestId = `${Date.now()}-${++seq}`;
    busy.value = true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        settle(requestId, false);
        notify("请求超时，正在重新同步");
        socket?.close();
      }, 8000);
      pending.set(requestId, { resolve, timer });
      socket!.send(JSON.stringify({ ...command, requestId }));
    });
  }
  function connect() {
    if (stopped) return;
    status.value = "connecting";
    socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
    );
    socket.onopen = () => {
      status.value = "connected";
      attempts = 0;
      if (token) void request({ type: "resume", token });
    };
    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "state") room.value = message.room;
      if (message.type === "ack") {
        if (message.session) saveSession(message.session);
        if (!message.ok) {
          notify(message.error || "操作失败");
          if (message.code === "SESSION_EXPIRED") {
            saveSession();
            room.value = null;
          }
        }
        settle(message.requestId, message.ok);
      }
      if (message.type === "notice") {
        notify(message.message);
        if (message.code === "SESSION_REPLACED") {
          stopped = true;
          saveSession();
          room.value = null;
        }
        if (message.code === "SESSION_EXPIRED") {
          saveSession();
          room.value = null;
        }
      }
    };
    socket.onclose = () => {
      status.value = "disconnected";
      for (const id of pending.keys()) settle(id, false);
      if (!stopped)
        retry = setTimeout(connect, Math.min(500 * 2 ** attempts++, 5000));
    };
    socket.onerror = () => socket?.close();
  }
  async function leave() {
    if (await request({ type: "leave" })) {
      saveSession();
      room.value = null;
      return true;
    }
    return false;
  }
  const me = computed(() =>
    room.value?.players.find((p) => p.id === room.value?.selfId),
  );
  const myTurn = computed(
    () => room.value?.turnId === room.value?.selfId && !!room.value,
  );
  const paused = computed(
    () => !!room.value && room.value.players.some((p) => !p.connected),
  );
  connect();
  onBeforeUnmount(() => {
    stopped = true;
    clearTimeout(retry);
    clearTimeout(toastTimer);
    for (const id of pending.keys()) settle(id, false);
    socket?.close();
  });
  return {
    room,
    status,
    toast,
    busy,
    me,
    myTurn,
    paused,
    request,
    leave,
    notify,
  };
}
