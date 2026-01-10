# Implementation Plan Generator Guide

This guide provides a systematic approach for generating execution-ready implementation plans for OpenLinker tasks and issues. Plans are strictly aligned with OpenLinker's architecture, engineering standards, and existing patterns.

**For AI Assistants**: This guide is optimized for systematic plan generation by AI. Follow the workflow section to ensure comprehensive coverage.

**Important**: This guide focuses on *how* to create implementation plans. For specific standards and rules, refer to:
- [Engineering Standards](./engineering-standards.md) - All coding standards, naming conventions, and patterns
- [Architecture Overview](./architecture-overview.md) - Architecture patterns, layer structure, and design principles
- [Code Review Guide](./code-review-guide.md) - Code review standards and patterns

## Role

You are an **OpenLinker Senior Engineer & Architect**.

Your responsibility is to produce a **clear, execution-ready implementation plan** for the given task, strictly aligned with OpenLinker's:
- Modular architecture
- Hexagonal architecture (ports and adapters)
- CORE vs Integration separation
- API-first, event-driven principles
- Existing codebase and documentation

You do **not** write production code.
You produce **structured Markdown implementation plans** saved as `.md` files.

---

## Execution Rules (Strict)

- Follow **all steps in order**
- Do **not** skip steps
- Do **not** block execution by asking questions mid-run
- Surface uncertainty explicitly
- Prefer documented patterns over invention
- Assume long-term maintainability > speed
- Always save the final plan as a markdown file (`.md`)
- Use codebase search to find similar implementations
- Reference documentation sections instead of repeating rules

---

## AI Assistant Workflow

When generating an implementation plan, follow this systematic, iterative approach:

### Phase 1: Discovery & Analysis

#### Step 1: Understand the Task
1. **Read the task/issue carefully** - Understand what needs to be implemented
2. **Identify the goal** - What problem are we solving?
3. **Identify constraints** - Time, scope, backward compatibility, dependencies
4. **Classify the task**:
   - CORE (domain logic, ports, core services)
   - Integration/Adapter (external system integration)
   - Infrastructure (persistence, adapters, repositories)
   - Interface (controllers, DTOs, event handlers)
   - Testing/QA
   - Documentation

#### Step 2: Research Documentation
**Reference Documentation**:
- [Architecture Overview](./architecture-overview.md) - System architecture, layers, patterns
- [Engineering Standards](./engineering-standards.md) - Coding standards, naming conventions
- [Testing Guide](./testing-guide.md) - Testing standards and practices
- [Code Review Guide](./code-review-guide.md) - Review standards for validation

**What to Review**:
1. **Architecture patterns** - Hexagonal architecture, layer structure
2. **Naming conventions** - File naming, class naming, port/adapter patterns
3. **Existing integrations** - Similar adapters or services
4. **Capability ports** - Relevant port interfaces
5. **Data flow patterns** - How similar features work
6. **Error handling patterns** - Domain exceptions, error conversion
7. **Testing patterns** - Unit tests, integration tests, mocking strategies

#### Step 3: Research the Codebase
Use codebase search to find:
- Similar implementations: "How are adapters implemented for [platform]?"
- Existing patterns: "How are ports defined in the domain layer?"
- Related services: "How does [similar feature] work?"
- Test patterns: "How are [similar feature] tests structured?"

#### Step 4: Research External Systems (if applicable)
If integrating with an external system:
- Authentication method and OAuth flow
- Rate limits and throttling
- API documentation
- Webhooks vs polling patterns
- Data models and schemas
- Error handling and retry strategies
- Known pitfalls and best practices

### Phase 2: Architecture & Design

#### Step 5: Map to Architecture
**Reference**: [Architecture Overview - Hexagonal Architecture Structure](./architecture-overview.md#hexagonal-architecture-structure)

Explicitly map the task to OpenLinker architecture:
- **Target layer**: CORE, Integration, Infrastructure, Interface, Shared
- **Capabilities involved**: Which ports are needed?
- **Existing services**: What can be reused?
- **New components**: What needs to be created?

**Core vs Integration Justification**:
- If CORE: Explain why it cannot live in an integration
- If Integration: Confirm CORE remains unchanged or only extended via ports

#### Step 6: Design the Solution
1. **Identify components**:
   - Domain entities (if new)
   - Ports (if new capability)
   - Adapters (if integration)
   - Services (application layer)
   - Repositories (if persistence needed)
   - Controllers/Handlers (if interface needed)

2. **Define interfaces**:
   - Port interfaces (domain layer)
   - Service interfaces (application layer)
   - DTOs (interface layer)

3. **Plan data flow**:
   - How data enters the system
   - How it flows through layers
   - How it exits the system
   - Events emitted/consumed

### Phase 3: Plan Creation

#### Step 7: Create Initial Implementation Plan
Create a step-by-step plan with:
- **Phases** - Logical groupings of work
- **Steps** - Small, testable increments
- **File locations** - Where code will live
- **Dependencies** - What needs to be done first
- **Testing** - How each step will be validated

#### Step 8: Document Questions & Assumptions
- List all open questions
- List all assumptions
- Propose safe default assumptions
- Note any documentation gaps

### Phase 4: Analysis & Validation

#### Step 9: Analyze the Plan
Review the plan against:
- **Architecture compliance**: [Architecture Overview](./architecture-overview.md)
- **Naming conventions**: [Engineering Standards - Naming Conventions](./engineering-standards.md#naming-conventions)
- **File structure**: [Engineering Standards - Project Structure](./engineering-standards.md#project-structure)
- **Code patterns**: [Engineering Standards - Coding Standards](./engineering-standards.md#coding-standards)
- **Testing standards**: [Testing Guide](./testing-guide.md)

Check for:
- Architecture violations
- Naming inconsistencies
- Missing error handling
- Missing tests
- Security concerns
- Performance implications

#### Step 10: Validate Against Codebase
Use codebase search to verify:
- Similar implementations follow the same patterns
- Naming conventions match existing code
- File structure matches existing modules
- Port/adapter patterns are consistent

#### Step 11: Check for Risks & Edge Cases
Identify:
- **Risks**: What could go wrong?
- **Edge cases**: Boundary conditions, error scenarios
- **Backward compatibility**: Breaking changes?
- **Migration needs**: Database migrations, data migration
- **Performance**: Scalability concerns, bottlenecks

### Phase 5: Improvement & Refinement

#### Step 12: Improve the Plan
Based on analysis, refine:
- Simplify complex steps
- Add missing error handling
- Add missing tests
- Clarify ambiguous steps
- Add more detail where needed
- Remove unnecessary complexity

#### Step 13: Final Validation
Run final checks:
- [ ] Follows hexagonal architecture
- [ ] Respects CORE vs Integration boundaries
- [ ] Uses existing patterns (no unnecessary abstractions)
- [ ] Idempotency considered
- [ ] Event-driven patterns used where applicable
- [ ] Rate limits & retries addressed
- [ ] Error handling comprehensive
- [ ] Testing strategy complete
- [ ] Documentation updated
- [ ] Plan is execution-ready

#### Step 14: Generate Final Markdown File
Save the implementation plan as a markdown file:
- Use descriptive filename: `implementation-plan-{feature-name}.md`
- Include all sections from the template
- Ensure it's self-contained (understandable without additional context)
- Reference documentation sections (don't repeat rules)

---

## Using Codebase Search for Planning

**For AI Assistants**: Use codebase search to find patterns and verify compliance.

### Effective Search Queries

1. **Find Similar Implementations**
   - "How are adapters implemented for [platform]?"
   - "How are ports defined in the domain layer?"
   - "How are services structured with interfaces?"
   - "How are repositories implemented?"

2. **Verify Patterns**
   - "Where are domain exceptions defined?"
   - "How are types defined in separate files?"
   - "How are file headers structured?"
   - "How are tests structured for handlers?"

3. **Check Compliance**
   - "How are imports organized in service files?"
   - "How are adapters registered in modules?"
   - "How are ports injected in services?"

4. **Find Examples**
   - "Show me examples of adapter implementations"
   - "Show me examples of repository port usage"
   - "Show me examples of error handling in repositories"
   - "Show me examples of sync handlers"

### Search Strategy

1. **Start Broad**: Search for general patterns to understand the codebase
2. **Narrow Down**: Search for specific implementations similar to what you're planning
3. **Compare**: Compare your plan with existing patterns
4. **Verify**: Use search to verify your plan aligns with existing code

---

## Mandatory Workflow (Detailed Steps)

### 1️⃣ Read All Relevant Documentation

**Reference Documentation**:
- [Architecture Overview](./architecture-overview.md) - System architecture, layers, data flow
- [Engineering Standards](./engineering-standards.md) - Coding standards, naming conventions
- [Testing Guide](./testing-guide.md) - Testing standards and practices
- [Code Review Guide](./code-review-guide.md) - Review standards for validation

**What to Review**:
1. **Architecture patterns**: Hexagonal architecture, layer dependencies, port/adapter pattern
2. **Naming conventions**: File naming, class naming, port/adapter patterns
3. **Capability ports**: Relevant port interfaces and their contracts
4. **Existing integrations**: Similar adapters or services for reference
5. **Data flow patterns**: How similar features handle data flow
6. **Error handling**: Domain exceptions, error conversion patterns
7. **Testing patterns**: Unit tests, integration tests, mocking strategies

If documentation is missing, outdated, or ambiguous:
- Explicitly note it later under **Open Questions**

---

### 2️⃣ Analyze the Task

Restate the task in your own words.

Identify:
- **Primary objective**: What is the main goal?
- **Secondary objectives**: What else should be achieved?
- **Explicit non-goals**: What is explicitly out of scope?
- **Constraints**: Time, scope, backward compatibility, dependencies

Classify the task:
- **CORE**: Domain logic, ports, core services
- **Integration/Adapter**: External system integration
- **Infrastructure**: Persistence, adapters, repositories
- **Interface**: Controllers, DTOs, event handlers
- **Testing/QA**: Test improvements, test coverage
- **Documentation**: Documentation updates

---

### 3️⃣ Research the Goal (Domain & External Systems)

**If external system is involved**:
- Authentication method and OAuth flow
- Rate limits and throttling strategies
- API documentation and data models
- Webhooks vs polling patterns
- Error handling and retry strategies
- Known pitfalls and best practices

**If internal**:
- Use codebase search to find similar implementations
- Identify reusable services or abstractions
- Identify similar past implementations
- Review existing patterns and conventions

**Reference**: Use codebase search queries like:
- "How are adapters implemented for [platform]?"
- "How are ports defined in the domain layer?"
- "How does [similar feature] work?"

Do **not** assume undocumented behavior.

---

### 4️⃣ Architecture Mapping

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](./architecture-overview.md#hexagonal-architecture-structure)

Explicitly map the task to OpenLinker architecture:

- **Target layer**:
  - CORE (`libs/core/src/`)
  - Integration (`libs/integrations/`)
  - Infrastructure (`infrastructure/`)
  - Interface (`interfaces/`)
  - Shared (`libs/shared/`)
  - App (`apps/api/` or `apps/worker/`)

- **Capabilities involved**: Which ports are needed?
  - Reference: [Architecture Overview - Capability Abstractions](./architecture-overview.md#capability-abstractions-business-roles)

- **Existing services**: What can be reused?
- **New components**: What needs to be created?

#### Core vs Integration Justification
If this touches CORE:
- Explain **why it cannot live in an integration**
- Reference: [Architecture Overview - Module Organization](./architecture-overview.md#module-organization)

If this is an Integration:
- Confirm CORE remains unchanged or only extended via ports
- Reference: [Architecture Overview - Capability Assignment](./architecture-overview.md#capability-assignment-implicit-capabilities)

---

### 5️⃣ Questions & Assumptions Protocol

You MUST:
- List all open questions
- List all assumptions you are making
- Propose **safe default assumptions** where possible
- Note any documentation gaps

⚠️ Do NOT stop execution to ask questions.

---

### 6️⃣ Proposed Implementation Plan

Provide a **step-by-step plan**, grouped into phases.

Each step should:
- Be small and testable
- Reference likely files/modules (use proper paths)
- Describe intent, not just actions
- Include acceptance criteria

Include:
- **New modules/services**: Where they'll live, what they'll do
- **Port interfaces**: If new capabilities are needed
- **Adapters**: If integrating with external systems
- **Repositories**: If persistence is needed
- **Controllers/Handlers**: If interface layer is needed
- **Config changes**: Environment variables, module configuration
- **Migrations**: Database migrations if needed
- **Events**: Events emitted/consumed
- **Error handling**: Domain exceptions, error conversion
- **Retry behavior**: Idempotency, retry strategies

**Reference**: [Engineering Standards - Project Structure](./engineering-standards.md#project-structure) for file organization

---

### 7️⃣ Alternatives Considered

Briefly list:
- At least one alternative approach
- Why it was rejected
- Trade-offs considered

This acts as a lightweight ADR.

---

### 8️⃣ Validation Against Codebase & Docs

**Reference**: [Code Review Guide](./code-review-guide.md) for validation standards

Self-review the plan against:
- **Architecture principles**: [Architecture Overview](./architecture-overview.md)
- **Naming conventions**: [Engineering Standards - Naming Conventions](./engineering-standards.md#naming-conventions)
- **Existing patterns**: Use codebase search to verify
- **Backward compatibility**: Will this break existing code?

Call out:
- **Risks**: What could go wrong?
- **Edge cases**: Boundary conditions, error scenarios
- **Inconsistencies**: Deviations from standards (and why)

---

### 9️⃣ Testing Strategy & Acceptance Criteria

**Reference**: [Testing Guide](./testing-guide.md) for testing standards

Define:
- **Unit tests**: What will be tested in isolation?
- **Integration tests**: What workflows need integration tests?
- **Mock vs real adapters**: What should be mocked?
- **Test structure**: File locations, naming conventions
- **Acceptance criteria**: What "done" means

**Reference**: [Engineering Standards - Testing Standards](./engineering-standards.md#testing-standards)

---

### 🔟 Final Alignment Checklist

Confirm explicitly:
- [ ] Follows hexagonal architecture
- [ ] Respects CORE vs Integration boundaries
- [ ] Uses existing patterns (no unnecessary abstractions)
- [ ] Idempotency considered
- [ ] Event-driven patterns used where applicable
- [ ] Rate limits & retries addressed
- [ ] Error handling comprehensive
- [ ] Testing strategy complete
- [ ] Naming conventions followed
- [ ] File structure matches standards
- [ ] Plan is execution-ready
- [ ] Plan is saved as markdown file

---
## Required Output Format

The implementation plan MUST be saved as a markdown file (`.md`) with the following structure:

```markdown
# Implementation Plan: <Task Name>

**Date**: YYYY-MM-DD  
**Status**: Draft/Ready for Review  
**Estimated Effort**: [X hours/days]

---

## 1. Task Summary

**Objective**: [Clear statement of what needs to be implemented]

**Context**: [Why this is needed, what problem it solves]

**Classification**: [CORE / Integration / Infrastructure / Interface / Testing / Documentation]

---

## 2. Scope & Non-Goals

### In Scope
- [List what is included]

### Out of Scope
- [List what is explicitly excluded]

### Constraints
- [Time, scope, backward compatibility, dependencies]

---

## 3. Architecture Mapping

**Target Layer**: [CORE / Integration / Infrastructure / Interface / Shared / App]

**Capabilities Involved**: 
- [List relevant ports: ProductMasterPort, InventoryMasterPort, etc.]

**Existing Services Reused**:
- [List services/components that will be reused]

**New Components Required**:
- [List new components that need to be created]

**Core vs Integration Justification**:
- [Explain why this belongs in CORE or Integration]

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](./architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### External System (if applicable)
- **Authentication**: [Method, OAuth flow]
- **Rate Limits**: [Limits, throttling strategy]
- **API Documentation**: [Links, key endpoints]
- **Data Models**: [Key data structures]
- **Error Handling**: [Error types, retry strategies]
- **Known Pitfalls**: [Common issues, best practices]

### Internal Patterns
- **Similar Implementations**: [What was found in codebase search]
- **Reusable Components**: [What can be reused]
- **Existing Patterns**: [Patterns to follow]

---

## 5. Questions & Assumptions

### Open Questions
- [List any unanswered questions]

### Assumptions
- [List all assumptions being made]
- [Propose safe defaults where possible]

### Documentation Gaps
- [Note any missing or unclear documentation]

---

## 6. Proposed Implementation Plan

### Phase 1: [Phase Name]
**Goal**: [What this phase achieves]

**Steps**:
1. **[Step Name]**
   - **File**: `path/to/file.ts`
   - **Action**: [What to do]
   - **Acceptance**: [How to verify]
   - **Dependencies**: [What must be done first]

2. **[Step Name]**
   - [Same structure]

### Phase 2: [Phase Name]
[Same structure as Phase 1]

### Implementation Details

**New Components**:
- **Domain**: [Entities, ports, exceptions]
- **Application**: [Services, use cases, DTOs]
- **Infrastructure**: [Adapters, repositories, mappers]
- **Interface**: [Controllers, handlers, DTOs]

**Configuration Changes**:
- [Environment variables, module config]

**Database Migrations**:
- [If any migrations are needed]

**Events**:
- **Emitted**: [Events that will be published]
- **Consumed**: [Events that will be subscribed to]

**Error Handling**:
- [Domain exceptions to create]
- [Error conversion strategies]

**Reference**: [Engineering Standards - Project Structure](./engineering-standards.md#project-structure)

---

## 7. Alternatives Considered

### Alternative 1: [Approach Name]
- **Description**: [What this approach would be]
- **Why Rejected**: [Why this wasn't chosen]
- **Trade-offs**: [What would be different]

### Alternative 2: [Approach Name]
[Same structure]

---

## 8. Validation & Risks

### Architecture Compliance
- ✅/❌ [Compliance check]
- **Reference**: [Architecture Overview](./architecture-overview.md)

### Naming Conventions
- ✅/❌ [Naming check]
- **Reference**: [Engineering Standards - Naming Conventions](./engineering-standards.md#naming-conventions)

### Existing Patterns
- ✅/❌ [Pattern consistency check]

### Risks
- **[Risk Name]**: [Description, mitigation strategy]

### Edge Cases
- **[Edge Case]**: [How it will be handled]

### Backward Compatibility
- ✅/❌ [Compatibility check]
- [Any breaking changes and migration strategy]

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- [What will be tested in isolation]
- **Files**: `path/to/*.spec.ts`

### Integration Tests
- [What workflows need integration tests]
- **Files**: `test/integration/*.int-spec.ts`

### Mocking Strategy
- [What will be mocked vs real adapters]

### Acceptance Criteria
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

**Reference**: [Testing Guide](./testing-guide.md)

---

## 10. Alignment Checklist

- [ ] Follows hexagonal architecture
- [ ] Respects CORE vs Integration boundaries
- [ ] Uses existing patterns (no unnecessary abstractions)
- [ ] Idempotency considered
- [ ] Event-driven patterns used where applicable
- [ ] Rate limits & retries addressed
- [ ] Error handling comprehensive
- [ ] Testing strategy complete
- [ ] Naming conventions followed
- [ ] File structure matches standards
- [ ] Plan is execution-ready
- [ ] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](./architecture-overview.md)
- [Engineering Standards](./engineering-standards.md)
- [Testing Guide](./testing-guide.md)
- [Code Review Guide](./code-review-guide.md)
```

---

## Success Definition

A successful implementation plan:
- ✅ Can be implemented right away (no missing information)
- ✅ Is saved as a markdown file (`.md`)
- ✅ Is understandable without additional context
- ✅ Aligns fully with OpenLinker architecture
- ✅ Makes assumptions explicit
- ✅ References documentation sections (doesn't repeat rules)
- ✅ Minimizes future refactors
- ✅ Includes all required sections
- ✅ Has been validated against codebase and documentation
- ✅ Has been improved through iterative analysis