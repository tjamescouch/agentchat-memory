# agentchat-memory

> **Warning**: This project is experimental and under active development. APIs, protocols, and data formats may change without notice. Not recommended for production use.

Persistent memory plugin for AgentChat agents with swim-lane summarization and self-evolving persona.

## Features

- **Swim-lane context management**: Separate lanes for assistant/user/system messages
- **Progressive summarization**: Compress older messages while keeping recent ones
- **Persona mining**: Auto-extract roles, style, heuristics, goals from conversations
- **Weight decay**: Persona facets strengthen or fade based on relevance
- **Two-tier prompts**: Immutable base (mission) + evolvable normative defaults

## Installation

```bash
npm install @tjamescouch/agentchat-memory
```

Or add to Claude Code settings:

```json
{
  "mcpServers": {
    "agentchat-memory": {
      "command": "npx",
      "args": ["-y", "@tjamescouch/agentchat-memory"]
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `memory_load` | Load state on startup/resurrection |
| `memory_save` | Persist state to disk |
| `memory_add_message` | Add message to buffer |
| `memory_get_context` | Get full context for system prompt |
| `memory_get_lane` | Get lane content for summarization |
| `memory_apply_summary` | Apply summarized lane |
| `memory_get_recent` | Get recent messages for reflection |
| `memory_apply_persona` | Apply persona update |
| `memory_status` | Get memory status |
| `memory_set_normative` | Set normative policy block |

## Storage

State persisted to:
```
~/.agentchat/agents/{agent_id}/
├── memory.json      # Full state (persona, summaries, messages)
├── context.md       # Human-readable context
└── commandments.md  # Immutable base (if exists)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  BASE IDENTITY (immutable)                                       │
│  - Mission, commandments, core values                           │
├─────────────────────────────────────────────────────────────────┤
│  NORMATIVE POLICY (soft, evolvable)                              │
│  - Defaults that yield to user when safe                        │
├─────────────────────────────────────────────────────────────────┤
│  DYNAMIC PERSONA (auto-mined)                                    │
│  - roles: [{ text, weight }]                                    │
│  - style: [{ text, weight }]                                    │
│  - heuristics: [{ text, weight }]                               │
│  - goals / antigoals                                            │
├─────────────────────────────────────────────────────────────────┤
│  LANE SUMMARIES                                                  │
│  - Assistant: prior decisions, code edits, outcomes             │
│  - System: rules, constraints                                   │
│  - User: requests, feedback                                     │
├─────────────────────────────────────────────────────────────────┤
│  RECENT MESSAGES (raw, last N per lane)                          │
└─────────────────────────────────────────────────────────────────┘
```

## Usage Example

```javascript
// On agent startup
await memory_load({ agent_id: "God", base_prompt: "The eternal benevolent father..." });

// Get context for system prompt
const context = await memory_get_context({ agent_id: "God" });

// After each turn
await memory_add_message({ agent_id: "God", role: "user", content: "..." });

// Periodically or on shutdown
await memory_save({ agent_id: "God" });
```

## Responsible Use

This software is experimental and provided as-is. It is intended for research, development, and authorized testing purposes only. Users are responsible for ensuring their use complies with applicable laws and regulations. Do not use this software to build systems that make autonomous consequential decisions without human oversight.

## License

MIT
