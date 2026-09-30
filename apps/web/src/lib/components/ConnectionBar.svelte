<script lang="ts">
  import type { ConnectionState } from "$lib/boardState.ts";

  /** The board must visibly disown its counts the moment the socket is gone. */
  let {
    connection,
    retryAt,
    now = Date.now(),
  }: { connection: ConnectionState; retryAt: number | null; now?: number } = $props();

  let seconds = $derived(retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : null);
</script>

{#if connection !== "live"}
  <div
    role="status"
    class="type-caption flex items-center gap-[var(--space-2)] border-b px-[var(--space-4)] py-[var(--space-2)]"
    style="border-color: var(--danger); color: var(--danger)"
  >
    {#if connection === "connecting"}
      Connecting…
    {:else if connection === "reconnecting"}
      Disconnected — these counts are no longer live.
      {#if seconds !== null}<span class="type-data">Retrying in {seconds}s</span>{/if}
    {:else}
      Disconnected — these counts are no longer live.
    {/if}
  </div>
{/if}
