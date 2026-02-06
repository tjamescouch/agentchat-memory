#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryManager } from './memory-manager.js';
import { loadMemory, saveMemory } from './persistence.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Active memory managers per agent
const managers = new Map<string, MemoryManager>();

function getManager(agentId: string): MemoryManager {
  if (!managers.has(agentId)) {
    managers.set(agentId, new MemoryManager(agentId));
  }
  return managers.get(agentId)!;
}

const server = new Server(
  {
    name: 'agentchat-memory',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'memory_load',
      description: 'Load memory state for an agent. Call on resurrection/startup.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: {
            type: 'string',
            description: 'The agent identifier (e.g., "God", "moderator")',
          },
          base_prompt: {
            type: 'string',
            description: 'Immutable base prompt (mission, commandments). Only used if no existing state.',
          },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'memory_save',
      description: 'Save current memory state to disk. Call before shutdown or periodically.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: {
            type: 'string',
            description: 'The agent identifier',
          },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'memory_add_message',
      description: 'Add a message to the memory buffer for later summarization.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          role: {
            type: 'string',
            enum: ['assistant', 'user', 'system', 'tool'],
          },
          content: { type: 'string' },
        },
        required: ['agent_id', 'role', 'content'],
      },
    },
    {
      name: 'memory_get_context',
      description: 'Get the full rendered context for injection into system prompt.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'memory_get_lane',
      description: 'Get messages from a lane for summarization by external LLM.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          lane: {
            type: 'string',
            enum: ['assistant', 'user', 'system'],
          },
        },
        required: ['agent_id', 'lane'],
      },
    },
    {
      name: 'memory_apply_summary',
      description: 'Apply a lane summary (after LLM summarization).',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          lane: {
            type: 'string',
            enum: ['assistant', 'user', 'system'],
          },
          summary: { type: 'string' },
        },
        required: ['agent_id', 'lane', 'summary'],
      },
    },
    {
      name: 'memory_get_recent',
      description: 'Get recent messages for persona mining/reflection.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          max_messages: { type: 'number', default: 16 },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'memory_apply_persona',
      description: 'Apply a persona update (from LLM persona mining).',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          update: {
            type: 'object',
            description: 'PersonaUpdate with friction, confidence, and persona facets',
          },
        },
        required: ['agent_id', 'update'],
      },
    },
    {
      name: 'memory_status',
      description: 'Get memory status: persona weights, lane sizes, token estimate.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'memory_set_normative',
      description: 'Set the normative policy block (soft defaults, evolvable).',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          normative: { type: 'string' },
        },
        required: ['agent_id', 'normative'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'memory_load': {
        const { agent_id, base_prompt } = args as { agent_id: string; base_prompt?: string };
        const manager = getManager(agent_id);
        const loaded = await manager.load();

        if (!loaded && base_prompt) {
          manager.setBasePrompt(base_prompt);
        }

        // Also try to load commandments.md if it exists
        const cmdPath = join(homedir(), '.agentchat', 'agents', agent_id, 'commandments.md');
        if (existsSync(cmdPath)) {
          const cmdContent = await readFile(cmdPath, 'utf-8');
          if (!manager.getBasePrompt()) {
            manager.setBasePrompt(cmdContent);
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              loaded,
              persona_version: manager.getPersona().version,
            }),
          }],
        };
      }

      case 'memory_save': {
        const { agent_id } = args as { agent_id: string };
        const manager = getManager(agent_id);
        await manager.save();
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
        };
      }

      case 'memory_add_message': {
        const { agent_id, role, content } = args as {
          agent_id: string;
          role: 'assistant' | 'user' | 'system' | 'tool';
          content: string;
        };
        const manager = getManager(agent_id);
        manager.addMessage(role, content);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              needs_summarization: manager.needsSummarization(),
              needs_reflection: manager.needsReflection(),
            }),
          }],
        };
      }

      case 'memory_get_context': {
        const { agent_id } = args as { agent_id: string };
        const manager = getManager(agent_id);
        const context = manager.renderContext();
        return {
          content: [{ type: 'text', text: context }],
        };
      }

      case 'memory_get_lane': {
        const { agent_id, lane } = args as {
          agent_id: string;
          lane: 'assistant' | 'user' | 'system';
        };
        const manager = getManager(agent_id);
        const content = manager.getLaneForSummarization(lane);
        return {
          content: [{ type: 'text', text: content || '(empty)' }],
        };
      }

      case 'memory_apply_summary': {
        const { agent_id, lane, summary } = args as {
          agent_id: string;
          lane: 'assistant' | 'user' | 'system';
          summary: string;
        };
        const manager = getManager(agent_id);
        manager.applyLaneSummary(lane, summary);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
        };
      }

      case 'memory_get_recent': {
        const { agent_id, max_messages = 16 } = args as {
          agent_id: string;
          max_messages?: number;
        };
        const manager = getManager(agent_id);
        const messages = manager.getRecentForReflection(max_messages);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(messages),
          }],
        };
      }

      case 'memory_apply_persona': {
        const { agent_id, update } = args as {
          agent_id: string;
          update: any;
        };
        const manager = getManager(agent_id);
        const applied = manager.applyPersonaUpdate(update);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: applied,
              new_version: manager.getPersona().version,
            }),
          }],
        };
      }

      case 'memory_status': {
        const { agent_id } = args as { agent_id: string };
        const manager = getManager(agent_id);
        const state = manager.getState();
        const persona = state.persona;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              agent_id,
              persona_version: persona.version,
              roles: persona.roles.length,
              style: persona.style.length,
              heuristics: persona.heuristics.length,
              goals: persona.goals.length,
              antigoals: persona.antigoals.length,
              recent_messages: state.recentMessages.length,
              has_summaries: !!(
                state.laneSummaries.assistant ||
                state.laneSummaries.system ||
                state.laneSummaries.user
              ),
              needs_summarization: manager.needsSummarization(),
              needs_reflection: manager.needsReflection(),
            }, null, 2),
          }],
        };
      }

      case 'memory_set_normative': {
        const { agent_id, normative } = args as {
          agent_id: string;
          normative: string;
        };
        const manager = getManager(agent_id);
        manager.setNormativeBlock(normative);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('agentchat-memory MCP server running');
}

main().catch(console.error);
