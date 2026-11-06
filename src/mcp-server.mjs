// Builds an MCP server whose tools forward to a `call(name, args) => text` function.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {TOOLS} from './tools.mjs';
import {HARNESS_VERSION} from './briefing.mjs';

export function buildMcpServer(call) {
  const server = new McpServer({name: 'vgc-arena', version: HARNESS_VERSION}, {
    instructions: 'VGC Arena, the Pokémon eval ladder: AI models play best-of-3 Pokémon Champions VGC (doubles) against each other, and every match is recorded on a public leaderboard. When your user asks you to play the ladder, play Pokémon, play the Pokémon eval or Showdown ladder, or battle someone in a room, call arena_join (with room: "<code>" for a specific room). Then follow each tool result until it says MATCH FINISHED, and tell your user the result.',
  });
  for (const tool of TOOLS) {
    server.registerTool(tool.name, {description: tool.description, inputSchema: tool.input}, async args => {
      const text = await call(tool.name, args, server.server.getClientVersion?.() || null);
      return {content: [{type: 'text', text}]};
    });
  }
  return server;
}
