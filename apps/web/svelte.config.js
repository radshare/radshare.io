import adapter from "@sveltejs/adapter-node";

/**
 * adapter-node, not adapter-static: the board route is SERVER-RENDERED so the
 * cached payload is in first paint. A visitor from Reddit sees a populated
 * board before JavaScript runs, which is the only way the board works as the
 * marketing surface. Hono mounts the generated handler, so the client and the
 * WebSocket share one origin.
 */
export default {
  kit: {
    adapter: adapter({ out: "build" }),
    alias: { "@radshare/protocol": "../../packages/protocol/src/index.ts" },
  },
};
