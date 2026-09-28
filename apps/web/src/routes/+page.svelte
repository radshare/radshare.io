<script lang="ts">
  import Board from "$lib/components/Board.svelte";

  /**
   * The board route, server-rendered so the cached payload is in first paint.
   *
   * There is NO data source wired yet, and the empty state is therefore the
   * honest thing to render. It is deliberately not seeded: no ghost counts, no
   * sample rows, no "typical activity" figure. An LFG board that lies once is
   * never trusted again, and this one's whole claim is that its numbers are
   * real right now.
   */
</script>

<svelte:head>
  <title>radshare — Warframe relic squad queue</title>
  <meta
    name="description"
    content="Pick your relics, join the queue, get matched with three others holding the same one."
  />
</svelte:head>

<Board rows={[]} />
