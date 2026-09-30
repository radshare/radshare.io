<script lang="ts">
  import FillSegments from "./FillSegments.svelte";
  import TierBadge from "./TierBadge.svelte";
  import type { RelicTier } from "@radshare/protocol";

  /**
   * One (relic, refinement) line. 44px doubles as the minimum touch target, so
   * there is no phone-specific row metric. A screen reader should read
   * "Axi G9, Radiant, 3 of 4, waiting 12 minutes" from this.
   */
  let {
    relicName,
    tier,
    refinement,
    count,
    waitedMs,
    mine = false,
  }: {
    relicName: string;
    tier: RelicTier | null;
    refinement: string;
    count: number;
    waitedMs: number;
    mine?: boolean;
  } = $props();

  function waited(ms: number): string {
    const m = Math.floor(ms / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
</script>

<tr
  class="h-[var(--row-height)] border-b border-border"
  style={mine ? "background: var(--surface-raised)" : ""}
>
  <td class="type-data px-[var(--space-3)]">{relicName}</td>
  <td class="px-[var(--space-3)]"><TierBadge {tier} /></td>
  <td class="type-caption px-[var(--space-3)] capitalize">{refinement}</td>
  <td class="px-[var(--space-3)]"><FillSegments {count} /></td>
  <td class="type-data px-[var(--space-3)] whitespace-nowrap">{count}/4</td>
  <td class="type-data px-[var(--space-3)]" style="color: var(--text-secondary)">
    {waited(waitedMs)}
  </td>
</tr>
