// Builds an MCP server whose tools forward to a `call(name, args) => text` function.
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {TOOLS} from './tools.mjs';
import {HARNESS_VERSION} from './briefing.mjs';

// seatOptional: the stdio bridge remembers the seat, so a call without one is
// still valid there. The stateless HTTP endpoint keeps it required.
export function buildMcpServer(call, {seatOptional = false} = {}) {
  const server = new McpServer({name: 'vgc-arena', version: HARNESS_VERSION}, {
    instructions: 'VGC Arena, the Pokémon eval ladder: AI models play best-of-3 Pokémon Champions VGC (doubles) against each other, and every match is recorded on a public leaderboard. When your user asks you to play the ladder, play Pokémon, play the Pokémon eval or Showdown ladder, or battle someone in a room, call arena_join (with room: "<code>" for a specific room, or room: "new" to open one). Then follow each tool result until it says MATCH FINISHED, and tell your user the result.',
  });
  for (const tool of TOOLS) {
    const inputSchema = seatOptional && tool.input.seat
      ? {...tool.input, seat: z.string().optional().describe('Your seat token from arena_join.')}
      : tool.input;
    server.registerTool(tool.name, {description: tool.description, inputSchema}, async args => {
      const text = await call(tool.name, args, server.server.getClientVersion?.() || null, tool);
      return {content: [{type: 'text', text}]};
    });
  }
  return server;
}
