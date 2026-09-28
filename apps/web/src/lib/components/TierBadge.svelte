<script lang="ts">
  /**
   * The ONLY place a tier colour appears. Never a row, a border, a fill segment
   * or a button.
   *
   * The label is not optional and there is no icon-only variant. Tier is the
   * board's primary scanning dimension, and under deuteranopia neo, meso and
   * lith converge — so the text is the information and the colour is the
   * shortcut, never the other way round.
   */
  type Tier = "axi" | "neo" | "meso" | "lith";

  let { relicName }: { relicName: string } = $props();

  const TIERS: Tier[] = ["axi", "neo", "meso", "lith"];

  let tier = $derived.by(() => {
    const first = relicName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    return TIERS.find((t) => t === first) ?? null;
  });
</script>

{#if tier}
  <span
    class="inline-flex items-center rounded-[var(--radius-control)] border px-[var(--space-2)] font-mono text-[var(--text-caption)] font-semibold uppercase"
    style="color: var(--tier-{tier}); border-color: var(--tier-{tier})"
  >
    {tier}
  </span>
{/if}
