<script setup lang="ts">
import type { Card } from "../../shared/types.js";
import { rankLabel, SUITS } from "../../shared/cards.js";
defineProps<{
  card?: Card;
  small?: boolean;
  selected?: boolean;
  interactive?: boolean;
}>();
defineEmits<{ select: [] }>();
</script>
<template>
  <component
    :is="interactive ? 'button' : 'div'"
    class="playing-card"
    :class="{
      red:
        card &&
        (card.suit === 'heart' || card.suit === 'diamond' || card.rank === 17),
      back: !card,
      small,
      selected,
      joker: card?.suit === 'joker',
    }"
    :aria-label="
      card ? `${SUITS[card.suit]}${rankLabel(card.rank)}` : '未揭晓的底牌'
    "
    :aria-pressed="interactive ? !!selected : undefined"
    :type="interactive ? 'button' : undefined"
    @click="interactive && $emit('select')"
  >
    <template v-if="card"
      ><span class="card-corner"
        ><b>{{ rankLabel(card.rank) }}</b
        ><span>{{ SUITS[card.suit] }}</span></span
      ><span class="card-center">{{ SUITS[card.suit] }}</span
      ><span class="card-bottom">{{ rankLabel(card.rank) }}</span></template
    >
    <span v-else class="back-pattern">♠</span>
  </component>
</template>
