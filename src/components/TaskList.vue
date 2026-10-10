<script setup lang="ts">
/**
 * @file 下载任务列表
 * @author sqksss
 * @date 2026-09-26
 */
import { useTaskStream } from '../composables/use-task-stream.ts'
import TaskItem from './TaskItem.vue'

const taskStore = useTaskStream()
</script>

<template>
  <section class="tasks panel" aria-labelledby="tasks-title">
    <header class="tasks__head">
      <h2 id="tasks-title" class="section-title">下载任务</h2>
      <span class="detail muted">
        {{ taskStore.activeCount > 0 ? `${taskStore.activeCount} 个进行中` : '当前没有进行中的任务' }}
      </span>
    </header>

    <p v-if="taskStore.notice" class="tasks__notice detail">{{ taskStore.notice }}</p>

    <p v-if="taskStore.tasks.length === 0" class="tasks__empty detail muted">
      还没有任务。粘贴链接、解析并选择一档，任务会出现在这里，并实时显示进度。
    </p>

    <ul v-else class="tasks__list">
      <TaskItem v-for="task in taskStore.tasks" :key="task.id" :task="task" />
    </ul>
  </section>
</template>

<style scoped>
.tasks {
  padding: 16px;
}

.tasks__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.tasks__notice {
  margin-bottom: 8px;
  color: var(--color-warn);
}

.tasks__empty {
  padding: 8px 0;
}

.tasks__list {
  margin: 0;
  padding: 0;
}
</style>
