<script lang="ts">
  import BucketRow from "./BucketRow.svelte";
  import type { RelicTier } from "@radshare/protocol";

  /**
   * A real <table>, not a grid of divs — this is tabular data and a screen
   * reader should read a full row. Two modes, one surface, no toggle.
   */
  type Row = {
    bucketKey: string;
    relicName: string;
    tier: RelicTier | null;
    refinement: string;
    count: number;
    waitedMs: number;
    mine?: boolean;
  };

  let {
    rows,
    mode = "global",
    hiddenCount = 0,
    stale = false,
  }: {
    rows: Row[];
    mode?: "global" | "personal";
    hiddenCount?: number;
    stale?: boolean;
  } = $props();
</script>

<section>
  <h2 class="type-label">
    {mode === "personal" ? "Your queue" : "Live queue board"}
  </h2>

  <!-- An undimmed board during a dropped socket is the app lying about the
       only thing it promises. Mandatory, not a nicety. -->
  <div style={stale ? "opacity: 0.6" : ""}>
    {#if rows.length === 0}
      <!-- Never seeded: no ghost count, no sample row, no "typical activity". -->
      <p class="type-caption" style="padding: var(--space-6) 0">
        Queues appear here as Tenno join. Be first. Be ready.
      </p>
    {:else}
      <table class="w-full border-collapse text-left">
        <thead>
          <tr class="type-label" style="margin: 0">
            <th scope="col" class="px-[var(--space-3)] pb-[var(--space-2)]">Relic</th>
            <th scope="col" class="px-[var(--space-3)] pb-[var(--space-2)]">Tier</th>
            <th scope="col" class="px-[var(--space-3)] pb-[var(--space-2)]">Refinement</th>
            <th scope="col" class="px-[var(--space-3)] pb-[var(--space-2)]">Filling</th>
            <th scope="col" class="px-[var(--space-3)] pb-[var(--space-2)]">Count</th>
            <th scope="col" class="px-[var(--space-3)] pb-[var(--space-2)]">Waiting</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.bucketKey)}
            <BucketRow {...row} />
          {/each}
        </tbody>
      </table>

      {#if hiddenCount > 0}
        <p class="type-caption" style="padding-top: var(--space-3)">
          and {hiddenCount} more filling
        </p>
      {/if}
    {/if}
  </div>

  <!-- Polite: a board updating every few seconds must never be assertive. -->
  <div aria-live="polite" aria-atomic="false" class="sr-only">
    {rows.length} queues filling
  </div>
</section>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
