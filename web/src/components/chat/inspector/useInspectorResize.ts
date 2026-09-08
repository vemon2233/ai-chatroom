import { onUnmounted, ref } from 'vue';

export function useVerticalResize(storageKey: string, defaultHeight = 168, minHeight = 110) {
  function getInitialHeight(): number {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!Number.isNaN(parsed) && parsed >= minHeight) {
          return Math.min(parsed, 550);
        }
      }
    } catch {}
    return defaultHeight;
  }

  const height = ref<number>(getInitialHeight());
  const isDragging = ref(false);
  let startY = 0;
  let startHeight = 0;

  function onMouseMove(e: MouseEvent) {
    if (!isDragging.value) return;
    const delta = e.clientY - startY;
    const maxAllowed = Math.min(550, Math.round(window.innerHeight * 0.6));
    const newHeight = Math.max(minHeight, Math.min(maxAllowed, startHeight + delta));
    height.value = newHeight;
  }

  function onMouseUp() {
    if (!isDragging.value) return;
    isDragging.value = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';

    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    try {
      localStorage.setItem(storageKey, height.value.toString());
    } catch {}
  }

  function onMouseDown(e: MouseEvent) {
    isDragging.value = true;
    startY = e.clientY;
    startHeight = height.value;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function cleanup() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  onUnmounted(() => {
    cleanup();
  });

  return {
    height,
    isDragging,
    onMouseDown,
    cleanup,
  };
}
