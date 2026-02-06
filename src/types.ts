/**
 * Persona facet - a weighted trait
 */
export interface PersonaFacet {
  text: string;
  weight: number; // 0..1
}

/**
 * Full persona model - self-evolving identity
 */
export interface PersonaModel {
  version: number;
  lastUpdatedTurn: number;
  roles: PersonaFacet[];
  style: PersonaFacet[];
  heuristics: PersonaFacet[];
  goals: PersonaFacet[];
  antigoals: PersonaFacet[];
}

/**
 * Lane summaries for context compression
 */
export interface LaneSummaries {
  assistant: string;
  system: string;
  user: string;
  lastSummarizedAt: number;
}

/**
 * Persisted memory state
 */
export interface MemoryState {
  version: number;
  agentId: string;
  persona: PersonaModel;
  laneSummaries: LaneSummaries;
  recentMessages: Message[];
  basePrompt: string;       // Immutable (mission, commandments)
  normativeBlock: string;   // Soft defaults, evolvable
  createdAt: string;
  updatedAt: string;
}

/**
 * Message in the conversation buffer
 */
export interface Message {
  role: 'assistant' | 'user' | 'system' | 'tool';
  content: string;
  timestamp: number;
}

/**
 * Persona update from reflection
 */
export interface PersonaUpdate {
  friction: number;    // 0..1 alignment friction
  confidence: number;  // 0..1 confidence in update
  persona: Partial<PersonaModel>;
}

/**
 * Memory configuration
 */
export interface MemoryConfig {
  // Context budgeting
  contextTokens: number;        // default 8192
  avgCharsPerToken: number;     // default 4
  highRatio: number;            // trigger summarization (default 0.70)
  lowRatio: number;             // target after summarization (default 0.50)

  // Recency
  keepRecentPerLane: number;    // default 4

  // Persona mining
  minReflectGapTurns: number;   // default 3
  decayPerPass: number;         // default 0.03
  minKeepWeight: number;        // default 0.22
  mergeAggressiveness: number;  // default 0.60
}

export const DEFAULT_CONFIG: MemoryConfig = {
  contextTokens: 8192,
  avgCharsPerToken: 4,
  highRatio: 0.70,
  lowRatio: 0.50,
  keepRecentPerLane: 4,
  minReflectGapTurns: 3,
  decayPerPass: 0.03,
  minKeepWeight: 0.22,
  mergeAggressiveness: 0.60,
};
