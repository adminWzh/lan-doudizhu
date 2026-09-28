<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import PlayingCard from "./PlayingCard.vue";
import { useGame } from "./useGame";
import {
  choosePattern,
  identifyPatterns,
  suggestPlay,
} from "../../shared/cards.js";
const {
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
} = useGame();
const name = ref("");
try {
  name.value = localStorage.getItem("tongzhuo-name") || "";
} catch {}
const initialCode = new URLSearchParams(location.search).get("room") || "";
const roomCode = ref(/^\d{6}$/.test(initialCode) ? initialCode : "");
const selected = ref<string[]>([]);
const handElement = ref<HTMLElement | null>(null);
const showRules = ref(false);
const showShare = ref(false);
const showLeave = ref(false);
const showLog = ref(false);
const addresses = ref<string[]>([]);
const networkAddress = ref("");
const joinMode = ref(!!roomCode.value);
void fetch("/api/network")
  .then((r) => r.json())
  .then((data) => {
    addresses.value = data.addresses || [];
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(
      location.hostname,
    );
    networkAddress.value = local
      ? addresses.value[0] || location.hostname
      : location.hostname;
  })
  .catch(() => (networkAddress.value = location.hostname));
const inviteUrl = computed(
  () =>
    `${location.protocol}//${networkAddress.value || location.hostname}${location.port ? `:${location.port}` : ""}/${room.value ? `?room=${room.value.code}` : ""}`,
);
const opponents = computed(() => {
  if (!room.value) return [];
  const i = room.value.players.findIndex((p) => p.id === room.value!.selfId);
  return [room.value.players[(i + 1) % 3], room.value.players[(i + 2) % 3]];
});
const selectedCards = computed(
  () => room.value?.hand.filter((c) => selected.value.includes(c.id)) || [],
);
const validPlay = computed(() =>
  choosePattern(selectedCards.value, room.value?.lastPlay?.pattern),
);
const selectionPattern = computed(
  () => validPlay.value || identifyPatterns(selectedCards.value)[0],
);
const canAct = computed(
  () =>
    myTurn.value &&
    !paused.value &&
    !busy.value &&
    status.value === "connected",
);
const turnName = computed(
  () =>
    room.value?.players.find((p) => p.id === room.value?.turnId)?.name || "",
);
const phaseLabel = computed(
  () =>
    ({
      waiting: "等待入座",
      bidding: "叫抢地主",
      playing: "对局进行中",
      finished: "本局结束",
    })[room.value?.phase || "waiting"],
);
const isWinner = computed(
  () =>
    room.value?.result &&
    (room.value.result.side === "landlord") ===
      (room.value.landlordId === room.value.selfId),
);
const readyCount = computed(
  () => room.value?.players.filter((p) => p.ready).length || 0,
);
watch(
  () => room.value?.hand.map((c) => c.id).join(","),
  () =>
    (selected.value = selected.value.filter((id) =>
      room.value?.hand.some((c) => c.id === id),
    )),
);
watch(
  () => room.value?.phase,
  () => (selected.value = []),
);
async function enter(type: "create" | "join") {
  if (!name.value.trim()) {
    notify("先起个昵称，让朋友认出你");
    return;
  }
  try {
    localStorage.setItem("tongzhuo-name", name.value.trim());
  } catch {}
  const ok = await request(
    type === "create"
      ? { type, name: name.value }
      : { type, name: name.value, code: roomCode.value.trim() },
  );
  if (ok) history.replaceState(null, "", location.pathname);
}
function toggleCard(id: string) {
  if (room.value?.phase !== "playing") return;
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id];
}
async function play() {
  if (await request({ type: "play", cardIds: selected.value }))
    selected.value = [];
}
async function hint() {
  const cards = suggestPlay(room.value!.hand, room.value!.lastPlay?.pattern);
  selected.value = cards.map((c) => c.id);
  if (!cards.length) notify("没有能压过上一手的牌，可以选择「不出」");
  else {
    await nextTick();
    const card = handElement.value?.querySelector<HTMLElement>(".selected");
    const scroller = handElement.value?.parentElement;
    if (card && scroller) {
      const delta =
        card.getBoundingClientRect().left -
        scroller.getBoundingClientRect().left;
      scroller.scrollLeft +=
        delta - scroller.clientWidth / 2 + card.clientWidth / 2;
    }
  }
}
async function copy(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext)
      await navigator.clipboard.writeText(text);
    else {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      if (!ok) throw new Error();
    }
    notify("已复制，发给同一 Wi-Fi 的朋友吧");
  } catch {
    notify("浏览器不允许复制，请长按选中邀请地址复制");
    showShare.value = true;
  }
}
async function confirmLeave() {
  if (await leave()) {
    showLeave.value = false;
    selected.value = [];
  }
}
</script>
<template>
  <div class="app-shell" :class="{ 'in-room': room }">
    <header class="site-header">
      <a
        class="brand"
        href="#"
        @click.prevent="room ? (showLeave = true) : null"
        ><span class="brand-symbol">♠</span
        ><span>同桌<span class="brand-en">TONGZHUO</span></span></a
      >
      <nav>
        <span class="connection" :class="status"
          ><i></i
          >{{
            status === "connected"
              ? "局域网已连接"
              : status === "connecting"
                ? "连接中…"
                : "连接已断开"
          }}</span
        ><button
          class="icon-button help-button"
          @click="showRules = true"
          aria-label="查看规则"
        >
          ?
        </button>
      </nav>
    </header>

    <main v-if="!room" class="lobby">
      <section class="hero">
        <div class="eyebrow"><span></span> SAME WI-FI. SAME TABLE.</div>
        <h1>好久不见，<br />一起<span class="gold-text">斗个地主。</span></h1>
        <p class="hero-description">
          不用下载，不用注册。<br />连上同一个 Wi-Fi，叫上两位朋友，就能开局。
        </p>
        <div class="hero-art" aria-hidden="true">
          <div class="art-orbit orbit-one"></div>
          <div class="art-orbit orbit-two"></div>
          <div class="art-caption">GOOD HANDS, GREAT COMPANY.</div>
          <div class="hero-card hero-card-one">
            <span>A<small>♠</small></span
            ><b>♠</b><em>A</em>
          </div>
          <div class="hero-card hero-card-two">
            <span>A<small>♥</small></span
            ><b>♥</b><em>A</em>
          </div>
          <div class="hero-card hero-card-three">
            <span>JOKER</span><b>✦</b><em>王牌</em>
          </div>
          <span class="art-star star-one">✦</span
          ><span class="art-star star-two">✧</span><span class="art-dot"></span>
          <div class="friends-label">
            <span class="mini-avatars"><b>林</b><b>周</b><b>你</b></span
            ><span>三个人，刚刚好。</span>
          </div>
        </div>
        <div class="hero-features">
          <span><b>03</b> 位好友</span><span><b>54</b> 张好牌</span
          ><span><b>∞</b> 次再来一局</span>
        </div>
      </section>
      <section class="entry-panel">
        <div class="panel-kicker">把快乐，摆上桌</div>
        <h2>找个位置，坐下吧<span>。</span></h2>
        <div class="entry-tabs">
          <button :class="{ active: !joinMode }" @click="joinMode = false">
            创建房间</button
          ><button :class="{ active: joinMode }" @click="joinMode = true">
            加入房间
          </button>
        </div>
        <form @submit.prevent="enter(joinMode ? 'join' : 'create')">
          <label for="nickname">你的昵称 <span>朋友们会这样称呼你</span></label>
          <div class="input-wrap">
            <span>☺</span
            ><input
              id="nickname"
              v-model="name"
              maxlength="12"
              autocomplete="nickname"
              placeholder="起个好记的名字"
              required
            />
          </div>
          <template v-if="joinMode"
            ><label for="room-code"
              >房间号码 <span>向开桌的朋友问一下</span></label
            >
            <div class="input-wrap">
              <span>#</span
              ><input
                id="room-code"
                v-model="roomCode"
                inputmode="numeric"
                pattern="[0-9]{6}"
                maxlength="6"
                placeholder="输入 6 位房间号"
                required
              /></div
          ></template>
          <div v-else class="table-note">
            <span>♧</span>
            <p>
              一张牌桌，三个座位<small>创建后，把房间号分享给朋友即可。</small>
            </p>
            <b>3 人</b>
          </div>
          <button
            class="button primary entry-submit"
            type="submit"
            :disabled="busy || status !== 'connected'"
          >
            {{
              busy ? "请稍等…" : joinMode ? "加入朋友的牌桌" : "开一桌，等朋友"
            }}<span>↗</span>
          </button>
        </form>
        <div class="network-note">
          <span>⌁</span>
          <div>
            <b>记得连接同一个 Wi-Fi</b>
            <p>朋友在浏览器打开以下地址，再输入房间号</p>
            <button class="address-link" @click="showShare = true">
              {{ inviteUrl }} <span>↗</span>
            </button>
          </div>
        </div>
        <div class="entry-bottom">
          <span>无注册 · 无广告 · 纯粹打牌</span
          ><span class="tiny-suit">♠ ♥ ♣ ♦</span>
        </div>
      </section>
    </main>

    <main v-else class="game-layout">
      <section class="room-toolbar">
        <div>
          <span class="eyebrow">FRIENDS AT THE TABLE</span>
          <h1>
            好友的牌桌
            <button
              class="room-code"
              @click="copy(room.code)"
              aria-label="复制房间号"
            >
              # {{ room.code }} <span>⧉</span>
            </button>
          </h1>
        </div>
        <div class="toolbar-buttons">
          <button class="button subtle" @click="showShare = true">
            ＋ 邀请朋友</button
          ><button class="button ghost" @click="showLeave = true">
            离开牌桌
          </button>
        </div>
      </section>
      <div
        v-if="status !== 'connected' || paused"
        class="reconnect-banner"
        role="status"
      >
        {{
          status !== "connected"
            ? "连接中断，正在自动重连，请不要关闭页面。"
            : "有玩家暂时离线，对局已暂停。座位保留 2 分钟，超时离开将取消本局。"
        }}
      </div>
      <section class="game-table">
        <div class="table-topline">
          <span
            ><i></i>{{ phaseLabel
            }}<template v-if="room.round">
              · 第 {{ room.round }} 局</template
            ></span
          ><button @click="showLog = true">对局记录 ↗</button>
        </div>
        <div class="opponents">
          <div
            v-for="(player, index) in opponents"
            :key="index"
            class="opponent"
            :class="{
              'turn-player': player?.id === room.turnId,
              offline: player && !player.connected,
            }"
          >
            <template v-if="player"
              ><div
                class="avatar"
                :class="{ landlord: player.id === room.landlordId }"
              >
                {{ player.name.slice(0, 1)
                }}<span v-if="player.id === room.landlordId" class="crown"
                  >♛</span
                >
              </div>
              <div class="player-info">
                <b>{{ player.name }}</b
                ><span>{{
                  !player.connected
                    ? "暂时离线"
                    : room.phase === "waiting"
                      ? player.ready
                        ? "✓ 已准备"
                        : "等待准备"
                      : player.id === room.landlordId
                        ? "地主"
                        : room.landlordId
                          ? "农民"
                          : "等待叫抢"
                }}</span>
              </div>
              <div v-if="room.phase !== 'waiting'" class="card-count">
                <span>▧</span>{{ player.cardCount }}<small>张</small>
              </div>
              <span v-if="room.turnId === player.id" class="turn-dot"
                >正在思考</span
              ></template
            >
            <template v-else
              ><div class="avatar empty">＋</div>
              <div class="player-info">
                <b>虚位以待</b><span>等一位朋友入座</span>
              </div></template
            >
          </div>
        </div>
        <div class="table-center">
          <div v-if="room.phase === 'waiting'" class="waiting-center">
            <span class="watermark-suit">♠</span>
            <h2>
              {{
                room.players.length === 3
                  ? "人齐了，准备开局"
                  : "朋友来了，好戏就开始了。"
              }}
            </h2>
            <p>
              {{ room.players.length }} / 3 人已入座 · {{ readyCount }} 人已准备
            </p>
            <button
              v-if="room.players.length < 3"
              class="text-button"
              @click="showShare = true"
            >
              分享房间，喊朋友上桌 ↗
            </button>
          </div>
          <template v-else>
            <div class="bottom-cards">
              <span>地 主 底 牌</span>
              <div>
                <PlayingCard
                  v-for="i in 3"
                  :key="i"
                  :card="room.bottomCards[i - 1]"
                  small
                />
              </div>
            </div>
            <div v-if="room.phase === 'bidding'" class="bid-center">
              <h2>
                {{
                  myTurn ? "好牌在手，叫个地主？" : `等待 ${turnName} 叫抢地主`
                }}
              </h2>
              <p>每人叫／抢一次 · 最后抢的人当地主</p>
              <div class="bid-tags">
                <span v-for="bid in room.bidHistory" :key="bid.playerId"
                  >{{ room.players.find((p) => p.id === bid.playerId)?.name }} ·
                  {{ bid.bid ? "要地主" : "不要" }}</span
                >
              </div>
            </div>
            <div v-else-if="room.phase === 'playing'" class="trick-area">
              <template v-if="room.lastPlay"
                ><div class="trick-label">
                  {{
                    room.players.find((p) => p.id === room?.lastPlay?.playerId)
                      ?.name
                  }}
                  <b>{{ room.lastPlay.pattern.label }}</b>
                </div>
                <div
                  class="played-cards"
                  :style="{ '--count': room.lastPlay.cards.length }"
                >
                  <PlayingCard
                    v-for="card in room.lastPlay.cards"
                    :key="card.id"
                    :card="card"
                    small
                  /></div
              ></template>
              <div v-else class="fresh-trick">
                <span>♠</span>
                <h2>{{ myTurn ? "轮到你领出" : `等待 ${turnName} 出牌` }}</h2>
                <p>新一轮，可以出任意合法牌型</p>
              </div>
            </div>
            <div v-else class="result-center">
              <span class="result-icon">{{ isWinner ? "♛" : "♧" }}</span
              ><span class="eyebrow">{{
                isWinner ? "NICE HAND. WELL PLAYED." : "GOOD GAME. NEXT ROUND?"
              }}</span>
              <h2>
                {{ isWinner ? "漂亮，这局赢了！" : "差一点，下局再来。" }}
              </h2>
              <p>
                {{ room.result?.side === "landlord" ? "地主" : "农民搭档" }}获胜
                ·
                {{
                  room.players.find((p) => p.id === room?.result?.winnerId)
                    ?.name
                }}
                率先出完手牌
              </p>
              <button
                class="button primary"
                :disabled="busy"
                @click="request({ type: 'rematch' })"
              >
                再来一局 ↗
              </button>
            </div>
          </template>
        </div>
        <div class="seat-statuses">
          <span
            v-for="p in room.players.filter(
              (p) => room?.actions[p.id]?.text === '不出',
            )"
            :key="p.id"
            >{{ p.name }} · 不出</span
          >
        </div>
        <div class="table-edge">
          <span>同桌</span><i></i><span>只为一起玩的快乐</span>
        </div>
      </section>
      <section class="my-zone">
        <div class="hand-toolbar">
          <div class="my-identity">
            <div
              class="avatar me-avatar"
              :class="{ landlord: room.landlordId === room.selfId }"
            >
              {{ me?.name.slice(0, 1) }}
            </div>
            <div>
              <b>{{ me?.name }} <small>你</small></b
              ><span>{{
                room.phase === "waiting"
                  ? me?.ready
                    ? "已准备，等朋友就位"
                    : "坐稳了，就准备吧"
                  : room.landlordId === room.selfId
                    ? "地主 · 独当一面"
                    : room.landlordId
                      ? "农民 · 默契搭档"
                      : "好牌值得等待"
              }}</span>
            </div>
          </div>
          <div class="action-area">
            <template v-if="room.phase === 'waiting'"
              ><button
                class="button"
                :class="me?.ready ? 'subtle' : 'primary'"
                :disabled="busy || status !== 'connected'"
                @click="request({ type: 'ready', ready: !me?.ready })"
              >
                {{ me?.ready ? "取消准备" : "✓ 准备好了" }}
              </button></template
            >
            <template v-else-if="room.phase === 'bidding'"
              ><span class="turn-hint">{{
                myTurn ? "轮到你了" : `等待 ${turnName}`
              }}</span
              ><button
                class="button subtle"
                :disabled="!canAct"
                @click="request({ type: 'bid', bid: false })"
              >
                {{
                  room.bidHistory.some((b) => b.bid) ? "不抢" : "不叫"
                }}</button
              ><button
                class="button primary"
                :disabled="!canAct"
                @click="request({ type: 'bid', bid: true })"
              >
                {{ room.bidHistory.some((b) => b.bid) ? "抢地主" : "叫地主" }}
              </button></template
            >
            <template v-else-if="room.phase === 'playing'"
              ><span class="turn-hint" :class="{ active: myTurn }">{{
                paused ? "对局暂停" : myTurn ? "轮到你出牌" : `等待 ${turnName}`
              }}</span
              ><button class="button ghost" :disabled="!canAct" @click="hint">
                提示</button
              ><button
                class="button subtle"
                :disabled="!canAct || !room.lastPlay"
                @click="request({ type: 'pass' })"
              >
                不出</button
              ><button
                class="button primary"
                :disabled="!canAct || !validPlay"
                @click="play"
              >
                出牌<span v-if="selected.length"> · {{ selected.length }}</span>
              </button></template
            >
          </div>
        </div>
        <div v-if="room.hand.length" class="hand-scroll">
          <div
            ref="handElement"
            class="hand"
            :style="{ '--count': room.hand.length }"
          >
            <PlayingCard
              v-for="card in room.hand"
              :key="card.id"
              :card="card"
              :selected="selected.includes(card.id)"
              :interactive="room.phase === 'playing'"
              @select="toggleCard(card.id)"
            />
          </div>
        </div>
        <div v-else class="empty-hand">
          <span>♠</span
          >{{
            room.phase === "waiting"
              ? "三位玩家准备后自动洗牌发牌"
              : "手牌已全部出完"
          }}<span>♣</span>
        </div>
        <div class="hand-caption">
          <span>{{
            selected.length
              ? `已选 ${selected.length} 张 · ${selectionPattern?.label || "暂不构成合法牌型"}`
              : room.hand.length
                ? `${room.hand.length} 张手牌 · 点击选牌，左右滑动查看`
                : "一副好牌，一桌好友。"
          }}</span
          ><button v-if="selected.length" @click="selected = []">
            取消选择</button
          ><span v-else>♠ ♥ ♣ ♦</span>
        </div>
      </section>
    </main>
    <footer class="site-footer">
      <span>为面对面的相聚，留一张牌桌。</span
      ><span>同桌 / LOCAL MULTIPLAYER <b>01</b></span>
    </footer>
    <Transition name="toast"
      ><div v-if="toast" class="toast-message" role="status">
        {{ toast }}
      </div></Transition
    >
    <div
      v-if="showShare || showRules || showLeave || showLog"
      class="modal-backdrop"
      @click.self="showShare = showRules = showLeave = showLog = false"
      @keydown.esc="showShare = showRules = showLeave = showLog = false"
    >
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        :aria-label="
          showShare
            ? '邀请朋友'
            : showRules
              ? '游戏规则'
              : showLeave
                ? '离开牌桌'
                : '对局记录'
        "
      >
        <button
          class="modal-close icon-button"
          @click="showShare = showRules = showLeave = showLog = false"
          aria-label="关闭弹窗"
        >
          ×
        </button>
        <template v-if="showShare"
          ><span class="eyebrow">SAVE A SEAT FOR YOUR FRIENDS</span>
          <h2>叫上朋友，一起上桌。</h2>
          <p>连接同一个 Wi-Fi，在手机或电脑浏览器打开：</p>
          <div class="share-url">{{ inviteUrl }}</div>
          <label v-if="addresses.length > 1" class="network-select"
            >网络地址（选择 Wi-Fi / 以太网 IP）<select v-model="networkAddress">
              <option v-for="ip in addresses" :key="ip" :value="ip">
                {{ ip }}
              </option>
            </select></label
          >
          <div v-if="room" class="share-code">
            <span>房间号码</span><b>{{ room.code }}</b>
          </div>
          <button class="button primary full-width" @click="copy(inviteUrl)">
            复制邀请链接
          </button>
          <p class="modal-footnote">
            打不开？请关闭 VPN、允许系统防火墙的局域网访问，并确认路由器未开启
            AP 隔离。
          </p></template
        >
        <template v-else-if="showRules"
          ><span class="eyebrow">A LITTLE GUIDE</span>
          <h2>简单规则，尽兴玩。</h2>
          <div class="rules-content">
            <h3>01 / 凑齐三人</h3>
            <p>3 位玩家全部准备后自动开局。每人 17 张，剩余 3 张为地主底牌。</p>
            <h3>02 / 叫抢地主</h3>
            <p>
              随机一人先叫，按座位轮流，每人仅一次叫／抢机会，最后叫／抢的人当地主。三人都不要则重新发牌。此版本不包含回抢、加倍或计分。
            </p>
            <h3>03 / 轮流出牌</h3>
            <p>
              地主先出。同牌型、同张数比较主牌点数：3 到
              A、2、小王、大王。炸弹压普通牌型，王炸最大。连续两人不出，最后出牌者重新领出。
            </p>
            <h3>04 / 支持的牌型</h3>
            <p>
              单张、对子、三张、三带一、三带二、顺子（≥ 5 张）、连对（≥ 3
              对）、飞机、飞机带单／带对、四带二、四带两对、炸弹、王炸。
            </p>
            <p>
              顺子、连对和飞机主体不含 2
              或王；飞机主体必须是完整三张，翅膀不与主体同点数。单翅膀允许组成对子；四带二允许带一对；四带两对必须是两种不同对子。
            </p>
            <h3>05 / 赢了再来一局</h3>
            <p>
              地主先出完则地主获胜，任一农民先出完则两位农民一起赢。掉线自动重连，保留座位
              2 分钟；主动离开或重连超时会取消进行中的本局。
            </p>
          </div></template
        >
        <template v-else-if="showLeave"
          ><span class="eyebrow">TAKE A LITTLE BREAK</span>
          <h2>要离开这张牌桌吗？</h2>
          <p>
            {{
              room?.phase === "playing" || room?.phase === "bidding"
                ? "离开会取消正在进行的本局，其他玩家将回到等待状态。"
                : "离开后，你的位置会留给下一位朋友。"
            }}
          </p>
          <div class="modal-actions">
            <button class="button subtle" @click="showLeave = false">
              再坐一会儿</button
            ><button
              class="button primary"
              :disabled="busy"
              @click="confirmLeave"
            >
              确认离开
            </button>
          </div></template
        >
        <template v-else
          ><span class="eyebrow">AT THIS TABLE</span>
          <h2>刚刚发生的事。</h2>
          <ol class="game-log">
            <li v-for="(line, i) in room?.log" :key="i">{{ line }}</li>
          </ol></template
        >
      </section>
    </div>
  </div>
</template>
