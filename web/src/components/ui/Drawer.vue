<script setup lang="ts">
// Drawer 原语:右侧滑入抽屉——用于"不打断主流程、随手开关"的伴随面板(如房间设置)。
// 与 Modal 共享 overlay token 体系;二者是全工程仅有的两种覆盖形态。

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
      <aside class="overlay-window drawer" :style="width ? { width } : undefined">
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
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
/* 几何与视觉全部引用全局 overlay token/style.css 中的 .overlay-* 公共类 */
</style>
