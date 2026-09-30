<script lang="ts">
  /**
   * DISCRETE segments, not a bar: the quantity is four people, not a
   * percentage. Never 0/4 (an empty bucket is deleted) and never 4/4 (four
   * opens a ready check). The `N/4` count is always beside them in text.
   */
  let { count, size = 4 }: { count: number; size?: number } = $props();
</script>

<span class="inline-flex gap-[var(--space-1)]" aria-hidden="true">
  {#each Array(size) as _, i (i)}
    <span
      class="h-[10px] w-[18px] rounded-[1px]"
      style="background: {i < count ? 'var(--primary)' : 'var(--border)'}"
    ></span>
  {/each}
</span>
