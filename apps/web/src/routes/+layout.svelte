<script lang="ts">
  import "../app.css";

  let { children } = $props();
</script>

<div class="min-h-screen">
  <header class="border-b border-border">
    <div class="mx-auto flex max-w-[1100px] items-baseline gap-3 px-4 py-4">
      <a href="/" class="type-heading font-mono no-underline" style="color: var(--text)">
        radshare
      </a>
      <!--
        Utility language: orientation, status, action. Not mood, not brand.
        No "Welcome to radshare.io!", no "Squad up, Tenno!".
      -->
      <span class="type-caption">Relic squad queue</span>
    </div>
  </header>

  <main class="mx-auto max-w-[1100px] px-4 pb-16">
    {@render children?.()}
  </main>
</div>
