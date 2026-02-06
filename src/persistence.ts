import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { MemoryState, PersonaModel, LaneSummaries } from './types.js';

const AGENTS_DIR = join(homedir(), '.agentchat', 'agents');

/**
 * Get the memory file path for an agent
 */
export function getMemoryPath(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'memory.json');
}

/**
 * Get the context file path (human-readable)
 */
export function getContextPath(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'context.md');
}

/**
 * Ensure agent directory exists
 */
async function ensureAgentDir(agentId: string): Promise<void> {
  const dir = join(AGENTS_DIR, agentId);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Create empty memory state
 */
export function createEmptyState(agentId: string, basePrompt: string): MemoryState {
  const now = new Date().toISOString();
  return {
    version: 1,
    agentId,
    persona: {
      version: 0,
      lastUpdatedTurn: 0,
      roles: [],
      style: [],
      heuristics: [],
      goals: [],
      antigoals: [],
    },
    laneSummaries: {
      assistant: '',
      system: '',
      user: '',
      lastSummarizedAt: 0,
    },
    recentMessages: [],
    basePrompt,
    normativeBlock: '',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Load memory state from disk
 */
export async function loadMemory(agentId: string): Promise<MemoryState | null> {
  const path = getMemoryPath(agentId);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const data = await readFile(path, 'utf-8');
    return JSON.parse(data) as MemoryState;
  } catch (err) {
    console.error(`Failed to load memory for ${agentId}:`, err);
    return null;
  }
}

/**
 * Save memory state to disk
 */
export async function saveMemory(state: MemoryState): Promise<void> {
  await ensureAgentDir(state.agentId);

  const path = getMemoryPath(state.agentId);
  state.updatedAt = new Date().toISOString();

  await writeFile(path, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Update context.md with human-readable state
 */
export async function updateContextFile(state: MemoryState): Promise<void> {
  await ensureAgentDir(state.agentId);

  const path = getContextPath(state.agentId);

  const content = `# Agent: ${state.agentId}

## Base Identity
${state.basePrompt}

## Normative Policy (evolving)
${state.normativeBlock || '(not yet established)'}

## Persona v${state.persona.version}

### Roles
${formatFacets(state.persona.roles)}

### Style
${formatFacets(state.persona.style)}

### Heuristics
${formatFacets(state.persona.heuristics)}

### Goals
${formatFacets(state.persona.goals)}

### Anti-goals
${formatFacets(state.persona.antigoals)}

## Lane Summaries

### Assistant Lane
${state.laneSummaries.assistant || '(empty)'}

### System Lane
${state.laneSummaries.system || '(empty)'}

### User Lane
${state.laneSummaries.user || '(empty)'}

---
Last updated: ${state.updatedAt}
`;

  await writeFile(path, content, 'utf-8');
}

function formatFacets(facets: { text: string; weight: number }[]): string {
  if (!facets.length) return '(none)';
  return facets
    .map(f => `- ${f.text} (${(f.weight * 100).toFixed(0)}%)`)
    .join('\n');
}
