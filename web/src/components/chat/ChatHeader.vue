<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
  live?: boolean;
  statusText?: string;
  statusKind?: string;
}>();
</script>

<template>
  <header class="topbar">
    <div class="title-wrap">
      <span class="title">{{ title }}</span>
      <span v-if="subtitle" class="sub">
        <span class="live-dot" :class="{ on: live }"></span>
        {{ subtitle }}
      </span>
    </div>

    <div class="topbar-right">
      <slot name="prefix" />
      <span v-if="statusText" class="pill orch" :class="statusKind">{{ statusText }}</span>
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  padding: 11px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--panel);
  user-select: none;
  flex-shrink: 0;
}

.title-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.25;
}

.sub {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--faint);
  display: inline-block;
  flex-shrink: 0;
  transition: background 0.2s, box-shadow 0.2s;
}

.live-dot.on {
  background: var(--ok);
  box-shadow: 0 0 0 2px var(--panel), 0 0 6px var(--ok);
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.pill.orch {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--panel-soft);
  color: var(--muted);
  border: 1px solid var(--border-soft);
}

.pill.orch.baton,
.pill.orch.roundrobin {
  background: var(--accent-soft);
  color: var(--accent-deep);
  border-color: var(--accent-border);
}
</style>
