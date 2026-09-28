<script lang="ts">
  /**
   * Four DISCRETE segments, not a continuous bar — the quantity is four people,
   * not a percentage.
   *
   * Never renders 0/4: an empty bucket is deleted rather than shown, so at
   * least one segment is always filled. Never renders 4/4 either: a bucket
   * reaching four opens a ready check and stops being a board row.
   *
   * Fill state is never carried by colour alone. The segments are shapes and
   * the `N/4` count is always beside them in text.
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
