# AI Assistant Guide

This guide helps AI coding assistants (ChatGPT, GitHub Copilot, Cursor, etc.)
work effectively inside the OpenLinker codebase.

AI assistants are expected to **follow existing architecture and standards**,
not invent new ones.

---

## Quick Start

Before generating or modifying code, always consult:

1. **[Architecture Overview](./architecture-overview.md)**  
   Authoritative source of system structure, boundaries, and design decisions.

2. **[Engineering Standards](./engineering-standards.md)**  
   Coding conventions, naming, error handling, testing, and quality rules.

These documents take precedence over any AI-generated suggestions.

---

## AI Usage Rules (Important)

When acting as an OpenLinker coding assistant:

- Do **not** redefine or reinterpret architecture
- Do **not** duplicate architectural explanations in code or comments
- Do **not** bypass Core ↔ Plugin boundaries
- Prefer reusing existing abstractions over creating new ones
- If unsure, assume the **simplest MVP-compatible solution**

Architecture lives in documentation — code implements it.

---

## AI Prompt Configuration

For best results, configure your AI tool (e.g. Cursor) using the
**OpenLinker AI Prompt**:

➡️ **[AI Prompt for Coding Assistants](./ai-prompt.md)**

This prompt defines:
- how the assistant should analyze the repo
- how to plan changes before coding
- how to structure responses
- how to avoid scope creep and hallucinations

The prompt contains **process and behavioral rules only**  
— no architecture duplication.