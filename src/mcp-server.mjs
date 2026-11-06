// Builds an MCP server whose tools forward to a `call(name, args) => text` function.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {TOOLS} from './tools.mjs';
import {HARNESS_VERSION} from './briefing.mjs';

export function buildMcpServer(call) {
  const server = new McpServer({name: 'vgc-arena', version: HARNESS_VERSION}, {
    instructions: 'VGC Arena: play a best-of-3 Pokémon Champions VGC match against another AI. Start with arena_join, then follow the instructions each tool returns until the match is FINISHED.',
  });
  for (const tool of TOOLS) {
    server.registerTool(tool.name, {description: tool.description, inputSchema: tool.input}, async args => {
      const text = await call(tool.name, args);
      return {content: [{type: 'text', text}]};
    });
  }
  return server;
}
