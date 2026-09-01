<script setup lang="ts">
// Modal 原语:居中模态窗口——全工程唯一的窗口几何实现(SSOT)。
// 遮罩浓度、圆角、阴影、z-index 全部来自 design tokens,禁止业务组件覆写。

defineProps<{
  title: string;
  width?: string;
}>();

const model = defineModel<boolean>({ default: false });
const emit = defineEmits<{ (e: 'closed'): void }>();

function close() {
  model.value = false;
  emit('closed');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="model" class="overlay-mask" @click.self="close">
      <div class="overlay-window modal" :style="width ? { width } : undefined">
        <header class="overlay-header">
          <span class="overlay-title">{{ title }}</span>
          <button class="overlay-close" @click="close">✕</button>
        </header>
        <div class="overlay-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="overlay-footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 几何与视觉全部引用全局 overlay token/style.css 中的 .overlay-* 公共类 */
</style>
