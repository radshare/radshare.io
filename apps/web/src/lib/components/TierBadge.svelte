<script lang="ts">
  import type { RelicTier } from "@radshare/protocol";

  /**
   * The ONLY place a tier colour appears. Never a row, a border, a fill
   * segment or a button.
   *
   * The label is not optional and there is no icon-only variant. Tier is the
   * board's primary scanning dimension, and under deuteranopia neo, meso and
   * lith converge — so the text is the information and the colour is the
   * shortcut, never the other way round.
   *
   * The tier is read from the vendored relic data rather than parsed out of a
   * display name. Requiem and Vanguard relics have no palette entry, so they
   * render in secondary text with their label intact rather than borrowing a
   * colour that means something else.
   */
  let { tier }: { tier: RelicTier | null } = $props();

  const PALETTE: Partial<Record<RelicTier, string>> = {
    axi: "var(--tier-axi)",
    neo: "var(--tier-neo)",
    meso: "var(--tier-meso)",
    lith: "var(--tier-lith)",
  };

  let colour = $derived(tier ? (PALETTE[tier] ?? "var(--text-secondary)") : null);
</script>

{#if tier && colour}
  <span
    class="inline-flex items-center rounded-[var(--radius-control)] border px-[var(--space-2)] font-mono text-[var(--text-caption)] font-semibold uppercase"
    style="color: {colour}; border-color: {colour}"
  >
    {tier}
  </span>
{/if}
