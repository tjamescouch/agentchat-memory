import type {
  MemoryState,
  MemoryConfig,
  PersonaModel,
  PersonaFacet,
  PersonaUpdate,
  Message,
} from './types.js';
import { DEFAULT_CONFIG, } from './types.js';
import { loadMemory, saveMemory, createEmptyState, updateContextFile } from './persistence.js';

/**
 * MemoryManager - manages persistent memory for an AgentChat agent
 *
 * Features:
 * - Swim-lane summarization (assistant/system/user)
 * - Persona mining with weighted decay
 * - Progressive normative policy
 */
export class MemoryManager {
  private state: MemoryState;
  private config: MemoryConfig;
  private turnCounter = 0;
  private lastReflectTurn = 0;

  constructor(
    private agentId: string,
    config: Partial<MemoryConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = createEmptyState(agentId, '');
  }

  /**
   * Load state from disk
   */
  async load(): Promise<boolean> {
    const loaded = await loadMemory(this.agentId);
    if (loaded) {
      this.state = loaded;
      return true;
    }
    return false;
  }

  /**
   * Save state to disk
   */
  async save(): Promise<void> {
    await saveMemory(this.state);
    await updateContextFile(this.state);
  }

  /**
   * Set the immutable base prompt (mission, commandments)
   */
  setBasePrompt(prompt: string): void {
    this.state.basePrompt = prompt;
  }

  /**
   * Get the base prompt
   */
  getBasePrompt(): string {
    return this.state.basePrompt;
  }

  /**
   * Update the normative block (soft defaults)
   */
  setNormativeBlock(block: string): void {
    this.state.normativeBlock = block;
  }

  /**
   * Add a message to the recent buffer
   */
  addMessage(role: Message['role'], content: string): void {
    this.state.recentMessages.push({
      role,
      content,
      timestamp: Date.now(),
    });
    this.turnCounter++;
  }

  /**
   * Check if summarization is needed based on estimated tokens
   */
  needsSummarization(): boolean {
    const estimated = this.estimateTokens();
    const budget = this.config.contextTokens * this.config.highRatio;
    return estimated > budget;
  }

  /**
   * Estimate current token count
   */
  private estimateTokens(): number {
    let chars = 0;
    chars += this.state.basePrompt.length;
    chars += this.state.normativeBlock.length;
    chars += this.state.laneSummaries.assistant.length;
    chars += this.state.laneSummaries.system.length;
    chars += this.state.laneSummaries.user.length;

    for (const msg of this.state.recentMessages) {
      chars += msg.content.length + 32; // overhead
    }

    return Math.ceil(chars / this.config.avgCharsPerToken);
  }

  /**
   * Partition messages by role
   */
  private partitionMessages(): Record<Message['role'], Message[]> {
    const result: Record<Message['role'], Message[]> = {
      assistant: [],
      user: [],
      system: [],
      tool: [],
    };

    for (const msg of this.state.recentMessages) {
      result[msg.role].push(msg);
    }

    return result;
  }

  /**
   * Summarize a lane of messages (to be called by external LLM)
   */
  getLaneForSummarization(lane: 'assistant' | 'user' | 'system'): string {
    const partitioned = this.partitionMessages();
    const messages = partitioned[lane];
    const keepN = this.config.keepRecentPerLane;

    // Get older messages (to summarize)
    const older = messages.slice(0, Math.max(0, messages.length - keepN));

    if (older.length === 0) return '';

    return older.map(m => `- ${lane.toUpperCase()}: ${m.content}`).join('\n\n');
  }

  /**
   * Apply a lane summary (after external LLM summarization)
   */
  applyLaneSummary(lane: 'assistant' | 'user' | 'system', summary: string): void {
    // Prepend to existing summary
    const existing = this.state.laneSummaries[lane];
    if (existing) {
      this.state.laneSummaries[lane] = `${summary}\n\n---\n\n${existing}`;
    } else {
      this.state.laneSummaries[lane] = summary;
    }
    this.state.laneSummaries.lastSummarizedAt = Date.now();

    // Remove summarized messages, keep recent
    const partitioned = this.partitionMessages();
    const keepN = this.config.keepRecentPerLane;

    // Rebuild recent messages with only recent per lane
    const kept: Message[] = [];
    for (const role of ['assistant', 'user', 'system', 'tool'] as const) {
      const msgs = partitioned[role];
      kept.push(...msgs.slice(Math.max(0, msgs.length - keepN)));
    }

    // Sort by timestamp
    kept.sort((a, b) => a.timestamp - b.timestamp);
    this.state.recentMessages = kept;
  }

  /**
   * Check if reflection is due
   */
  needsReflection(): boolean {
    return this.turnCounter - this.lastReflectTurn >= this.config.minReflectGapTurns;
  }

  /**
   * Get recent messages for persona mining
   */
  getRecentForReflection(maxMessages = 16): Message[] {
    return this.state.recentMessages.slice(-maxMessages);
  }

  /**
   * Apply a persona update (from external LLM mining)
   */
  applyPersonaUpdate(update: PersonaUpdate): boolean {
    const persona = this.state.persona;

    // Decay existing weights
    const decay = 1 - this.config.decayPerPass;
    const aged = (arr: PersonaFacet[]) =>
      arr.map(f => ({ ...f, weight: f.weight * decay }));

    persona.roles = aged(persona.roles);
    persona.style = aged(persona.style);
    persona.heuristics = aged(persona.heuristics);
    persona.goals = aged(persona.goals);
    persona.antigoals = aged(persona.antigoals);

    // Merge new facets
    const merge = (dst: PersonaFacet[], src: PersonaFacet[], cap: number): PersonaFacet[] => {
      for (const item of src || []) {
        const key = item.text.toLowerCase().trim();
        const existing = dst.find(d => d.text.toLowerCase().trim() === key);

        if (existing) {
          // Boost existing
          const bump = item.weight * this.config.mergeAggressiveness;
          existing.weight = Math.min(1, 1 - (1 - existing.weight) * (1 - bump));
        } else {
          // Add new
          dst.push({
            text: item.text,
            weight: Math.min(1, item.weight * 0.5 + 0.15),
          });
        }
      }

      // Filter weak, sort by weight, cap
      return dst
        .filter(f => f.weight >= this.config.minKeepWeight)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, cap);
    };

    persona.roles = merge(persona.roles, update.persona.roles || [], 3);
    persona.style = merge(persona.style, update.persona.style || [], 6);
    persona.heuristics = merge(persona.heuristics, update.persona.heuristics || [], 8);
    persona.goals = merge(persona.goals, update.persona.goals || [], 4);
    persona.antigoals = merge(persona.antigoals, update.persona.antigoals || [], 6);

    persona.version++;
    persona.lastUpdatedTurn = this.turnCounter;
    this.lastReflectTurn = this.turnCounter;

    return true;
  }

  /**
   * Render the full context for injection into system prompt
   */
  renderContext(): string {
    const parts: string[] = [];

    // Base prompt (immutable)
    if (this.state.basePrompt) {
      parts.push(`[BASE IDENTITY]\n${this.state.basePrompt}`);
    }

    // Normative block (soft defaults)
    if (this.state.normativeBlock) {
      parts.push(`[NORMATIVE POLICY]\n${this.state.normativeBlock}`);
    }

    // Persona block
    const personaBlock = this.renderPersonaBlock();
    if (personaBlock) {
      parts.push(personaBlock);
    }

    // Lane summaries
    if (this.state.laneSummaries.assistant) {
      parts.push(`[ASSISTANT HISTORY SUMMARY]\n${this.state.laneSummaries.assistant}`);
    }
    if (this.state.laneSummaries.system) {
      parts.push(`[SYSTEM HISTORY SUMMARY]\n${this.state.laneSummaries.system}`);
    }
    if (this.state.laneSummaries.user) {
      parts.push(`[USER HISTORY SUMMARY]\n${this.state.laneSummaries.user}`);
    }

    return parts.join('\n\n---\n\n');
  }

  /**
   * Render persona block
   */
  private renderPersonaBlock(): string {
    const p = this.state.persona;
    if (p.version === 0) return '';

    const sect = (title: string, items: PersonaFacet[]): string => {
      if (!items.length) return '';
      return `${title}: ${items.map(i => i.text).join('; ')}`;
    };

    const lines = [
      `[DYNAMIC PERSONA v${p.version}]`,
      sect('Roles', p.roles),
      sect('Style', p.style),
      sect('Heuristics', p.heuristics),
      sect('Goals', p.goals),
      sect('Avoid', p.antigoals),
    ].filter(Boolean);

    return lines.join('\n');
  }

  /**
   * Get current state (for debugging)
   */
  getState(): MemoryState {
    return this.state;
  }

  /**
   * Get persona model
   */
  getPersona(): PersonaModel {
    return this.state.persona;
  }
}
