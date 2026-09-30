<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Board from "$lib/components/Board.svelte";
  import ConnectionBar from "$lib/components/ConnectionBar.svelte";
  import Lobby from "$lib/components/Lobby.svelte";
  import ReadyCheck from "$lib/components/ReadyCheck.svelte";
  import QueueComposer from "$lib/components/QueueComposer.svelte";
  import { countsAreLive } from "$lib/boardState.ts";
  import { readyFailedCopy, errorCopy } from "@radshare/protocol";
  import { labelFor, refinementLabel, waitingCopy } from "$lib/relics.ts";
  import { socket } from "$lib/socket.svelte.ts";

  let { data } = $props();

  /**
   * One ticking clock for every countdown on the page, rather than a timer per
   * component. A board updating every second must not become a board with
   * thirty independent intervals.
   */
  let now = $state(Date.now());
  let ticker: ReturnType<typeof setInterval>;

  onMount(() => {
    socket.start();
    ticker = setInterval(() => (now = Date.now()), 1000);
  });
  onDestroy(() => {
    clearInterval(ticker);
    socket.stop();
  });

  let client = $derived(socket.state);

  /**
   * Before the socket has said anything, the SERVER-RENDERED board is the
   * truth. After it connects, the live board takes over. There is never a
   * moment with nothing on screen and never a moment showing invented rows.
   */
  let rows = $derived(
    client.board.at > 0 || client.board.rows.length > 0
      ? client.board.rows
      : data.rows.map((r) => ({ bucketKey: r.bucketKey, count: r.count })),
  );
  let hiddenCount = $derived(client.board.at > 0 ? client.board.hiddenCount : data.hiddenCount);

  let displayRows = $derived(
    rows.map((row) => {
      const label = labelFor(row.bucketKey);
      return {
        bucketKey: row.bucketKey,
        relicName: label.name,
        tier: label.tier,
        refinement: refinementLabel(label.refinement),
        count: row.count,
        waitedMs: 0,
        mine: client.board.you.some((y) => y.bucketKey === row.bucketKey),
      };
    }),
  );

  let queued = $derived(client.board.you.length > 0);

  let mine = $derived(client.board.you[0]);
  let mineCopy = $derived(mine ? waitingCopy(mine.count, labelFor(mine.bucketKey).name) : null);
</script>

<svelte:head>
  <title>radshare — Warframe relic squad queue</title>
  <meta
    name="description"
    content="Pick your relics, join the queue, get matched with three others holding the same one."
  />
</svelte:head>

<ConnectionBar connection={client.connection} retryAt={client.retryAt} {now} />

{#if client.error}
  <p class="type-caption" role="alert" style="color: var(--danger); padding-top: var(--space-4)">
    {errorCopy(client.error)}
  </p>
{/if}

{#if client.gateFailure}
  <!-- Never silent for either side. A non-confirmer is out of the queue but
       keeps their selection, so returning is one click. -->
  <div
    role="status"
    style="background: var(--surface-raised); padding: var(--space-4); margin-top: var(--space-4)"
  >
    <p class="type-body">{readyFailedCopy(client.gateFailure)}</p>
    <button
      type="button"
      class="type-caption underline"
      onclick={() => socket.connection?.requeue()}
    >
      Queue again
    </button>
  </div>
{/if}

{#if client.lobby}
  <Lobby lobby={client.lobby} onLeave={() => socket.connection?.leaveLobby()} />
{:else}
  <QueueComposer
    {queued}
    queuedCount={client.board.you.length}
    disabled={client.connection !== "live"}
    onQueue={(selection) => socket.connection?.join(selection)}
    onLeave={() => socket.connection?.leave()}
  />

  {#if mineCopy}
    <p class="type-caption" style="padding-top: var(--space-4)">{mineCopy}</p>
  {/if}

  <Board
    rows={displayRows}
    mode={client.board.mode}
    {hiddenCount}
    stale={!countsAreLive(client.connection)}
  />

  {#if data.updatedAgo !== null && client.board.at === 0}
    <p class="type-caption">updated {data.updatedAgo}s ago</p>
  {/if}
{/if}

{#if client.gate}
  <ReadyCheck gate={client.gate} {now} onConfirm={() => socket.connection?.confirmReady()} />
{/if}
