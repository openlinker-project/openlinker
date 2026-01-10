# Code Review Guide

This guide provides a structured approach for conducting deep code reviews in the OpenLinker codebase. It follows the engineering standards and architecture patterns documented in the project.

**For AI Assistants**: This guide is optimized for systematic code review by AI. Follow the workflow section to ensure comprehensive coverage.

**Important**: This guide focuses on *how* to review code. For specific standards and rules, refer to:
- [Engineering Standards](./engineering-standards.md) - All coding standards, naming conventions, and patterns
- [Architecture Overview](./architecture-overview.md) - Architecture patterns, layer structure, and design principles

## AI Assistant Workflow

When conducting a code review, follow this systematic approach:

### Step 1: Understand Context
1. **Read the changed files** - Understand what was modified
2. **Search for related patterns** - Use codebase search to find similar implementations
3. **Check documentation** - Review relevant sections of engineering-standards.md and architecture-overview.md
4. **Identify affected layers** - Determine which architectural layers are involved

### Step 2: Systematic Review
1. **Architecture compliance** - Verify hexagonal architecture patterns
2. **File structure** - Check naming conventions and file organization
3. **Code quality** - Review types, error handling, logging
4. **Dependencies** - Verify import organization and dependency direction
5. **Tests** - Assess test coverage and quality
6. **Safety** - Check concurrency, idempotency, error handling

### Step 3: Document Findings
1. **Categorize issues** - Blocking, recommendations, optional
2. **Provide examples** - Show both incorrect and correct patterns
3. **Reference standards** - Link to specific documentation sections
4. **Suggest fixes** - Provide concrete code examples

### Step 4: Final Assessment
1. **Merge readiness** - Determine if code can be merged
2. **Priority fixes** - List what must be fixed before merge
3. **Estimated effort** - Provide time estimates for fixes

## Review Structure

A comprehensive code review should cover the following areas:

1. **Summary** - High-level assessment
2. **Alignment With Documentation** - Compliance with architecture and standards
3. **Issues & Risks** - Categorized by severity
4. **Concrete Suggestions** - Actionable fixes
5. **Documentation Gaps** - Missing or unclear documentation
6. **Test Coverage & Quality** - Test completeness and correctness
7. **Integration & Sync Safety** - Concurrency, idempotency, error handling
8. **Final Verdict** - Overall assessment and merge readiness

## Review Checklist

**Reference Documentation**: 
- [Architecture Overview - Hexagonal Architecture Structure](./architecture-overview.md#hexagonal-architecture-structure)
- [Engineering Standards - Project Structure](./engineering-standards.md#project-structure)
- [Engineering Standards - Repository Ports Pattern](./engineering-standards.md#repository-ports-pattern)
- [Engineering Standards - Ports vs. Concrete Implementations](./engineering-standards.md#ports-vs-concrete-implementations)

### Architecture Compliance

**How to Check**: 
- Use codebase search to find similar patterns: "How are ports defined in domain layer?"
- Verify layer boundaries: domain should not import from infrastructure
- Check dependency direction: application → domain, infrastructure → domain
- Reference: [Architecture Overview - Layer Dependencies](./architecture-overview.md#layer-dependencies)

- [ ] Follows hexagonal architecture (domain → application → infrastructure)
  - **Reference**: [Architecture Overview - Hexagonal Architecture Structure](./architecture-overview.md#hexagonal-architecture-structure)
  
- [ ] Domain layer has no framework dependencies
  - **Reference**: [Engineering Standards - Domain Layer Independence](./engineering-standards.md#domain-layer-independence)
  
- [ ] Ports (interfaces) defined in domain layer
  - **Reference**: [Architecture Overview - Hexagonal Architecture Structure](./architecture-overview.md#hexagonal-architecture-structure)
  
- [ ] Adapters implement ports, not concrete classes
  - **Reference**: [Engineering Standards - Ports vs. Concrete Implementations](./engineering-standards.md#ports-vs-concrete-implementations)
  
- [ ] Repository pattern correctly implemented
  - **Reference**: [Engineering Standards - Repository Ports Pattern](./engineering-standards.md#repository-ports-pattern)
  
- [ ] Dependency injection used throughout
  - **Reference**: [Engineering Standards - Dependency Injection](./engineering-standards.md#dependency-injection)
  
- [ ] Services implement interfaces (interface and implementation in separate files)
  - **Reference**: [Engineering Standards - Service Interface Implementation](./engineering-standards.md#service-interface-implementation)
  - **Reference**: [Engineering Standards - Interface and Implementation Separation](./engineering-standards.md#interface-and-implementation-separation)

### Code Quality

**Reference Documentation**:
- [Engineering Standards - File Headers](./engineering-standards.md#file-headers)
- [Engineering Standards - Type Definitions in Separate Files](./engineering-standards.md#type-definitions-in-separate-files)
- [Engineering Standards - Union Types: `as const` Pattern](./engineering-standards.md#union-types-as-const-pattern-default)
- [Engineering Standards - Error Handling](./engineering-standards.md#error-handling)
- [Engineering Standards - Logging](./engineering-standards.md#logging)
- [Engineering Standards - Async/Await](./engineering-standards.md#asyncawait)
- [Engineering Standards - Validation](./engineering-standards.md#validation)
- [Engineering Standards - Type Safety](./engineering-standards.md#type-safety)

**How to Check**:
- Read file headers - should be at top of every `.ts` file
- Search for type definitions - should be in `*.types.ts` files
- Check for `any` types - use grep: `grep -r ":\s*any" src/`
- Verify error handling - check catch blocks and exception types

- [ ] File headers present on all source files
  - **Reference**: [Engineering Standards - File Headers](./engineering-standards.md#file-headers)
  
- [ ] Types defined in separate `*.types.ts` files
  - **Reference**: [Engineering Standards - Type Definitions in Separate Files](./engineering-standards.md#type-definitions-in-separate-files)
  
- [ ] Union types use `as const` pattern (not enums)
  - **Reference**: [Engineering Standards - Union Types: `as const` Pattern](./engineering-standards.md#union-types-as-const-pattern-default)
  
- [ ] No `any` types (use `unknown` if needed)
  - **Reference**: [Engineering Standards - Type Safety](./engineering-standards.md#type-safety)
  
- [ ] Proper error handling with domain exceptions
  - **Reference**: [Engineering Standards - Error Handling](./engineering-standards.md#error-handling)
  
- [ ] Domain exceptions in `domain/exceptions/` directory
  - **Reference**: [Engineering Standards - Error Handling](./engineering-standards.md#error-handling)
  
- [ ] Logging appropriate and structured
  - **Reference**: [Engineering Standards - Logging](./engineering-standards.md#logging)
  
- [ ] Async/await used correctly
  - **Reference**: [Engineering Standards - Async/Await](./engineering-standards.md#asyncawait)
  
- [ ] Input validation at interface layer
  - **Reference**: [Engineering Standards - Validation](./engineering-standards.md#validation)

### Naming Conventions

**Reference Documentation**:
- [Engineering Standards - Naming Conventions](./engineering-standards.md#naming-conventions)

**How to Check**:
- Verify file names match patterns in engineering-standards.md
- Check class names match expected patterns
- Verify port and adapter naming conventions

- [ ] Files follow naming patterns (`.entity.ts`, `.port.ts`, `.service.ts`, etc.)
  - **Reference**: [Engineering Standards - Files and Folders](./engineering-standards.md#files-and-folders)
  
- [ ] Classes follow PascalCase
  - **Reference**: [Engineering Standards - Class Names](./engineering-standards.md#class-names)
  
- [ ] Variables/functions follow camelCase
  - **Reference**: [Engineering Standards - Variables and Functions](./engineering-standards.md#variables-and-functions)
  
- [ ] Constants follow UPPER_SNAKE_CASE
  - **Reference**: [Engineering Standards - Variables and Functions](./engineering-standards.md#variables-and-functions)
  
- [ ] Ports named `{Capability}Port`
  - **Reference**: [Engineering Standards - Ports (Interfaces)](./engineering-standards.md#ports-interfaces)
  
- [ ] Adapters named `{System}{Capability}Adapter`
  - **Reference**: [Engineering Standards - Adapters](./engineering-standards.md#adapters)

### Import Organization

**Reference Documentation**:
- [Engineering Standards - Import Aliases](./engineering-standards.md#import-aliases)

**How to Check**:
- Verify import order: external → cross-boundary → local
- Check for deep relative imports (`../../../`)
- Verify aliases are used for cross-boundary imports

- [ ] External packages first
  - **Reference**: [Engineering Standards - Import Order](./engineering-standards.md#import-order)
  
- [ ] Cross-boundary imports use aliases (`@openlinker/core/*`)
  - **Reference**: [Engineering Standards - Import Aliases - Rules](./engineering-standards.md#rules)
  
- [ ] Local imports use relative paths
  - **Reference**: [Engineering Standards - Import Aliases - Rules](./engineering-standards.md#rules)
  
- [ ] No deep relative imports (`../../../` or deeper)
  - **Reference**: [Engineering Standards - Import Aliases - Rules](./engineering-standards.md#rules)

### Testing

**Reference Documentation**:
- [Testing Guide](./testing-guide.md)
- [Engineering Standards - Testing Standards](./engineering-standards.md#testing-standards)

**How to Check**:
- Verify test files exist: `*.spec.ts` for unit tests, `*.int-spec.ts` for integration tests
- Check test structure matches implementation
- Verify mocks use port interfaces, not concrete classes
- Review test coverage for edge cases and error paths

- [ ] Unit tests for critical logic
  - **Reference**: [Testing Guide - Unit Tests](./testing-guide.md#unit-tests)
  - **Reference**: [Engineering Standards - Test Structure](./engineering-standards.md#test-structure)
  
- [ ] Integration tests for workflows
  - **Reference**: [Testing Guide - Integration Tests](./testing-guide.md#integration-tests)
  
- [ ] Tests mock ports, not concrete implementations
  - **Reference**: [Engineering Standards - Mocking Ports](./engineering-standards.md#mocking-ports)
  
- [ ] Test expectations match implementation
  - **Reference**: [Testing Guide - Best Practices](./testing-guide.md#best-practices)
  
- [ ] Error cases covered
  - **Reference**: [Testing Guide - Best Practices](./testing-guide.md#best-practices)
  
- [ ] Edge cases considered
  - **Reference**: [Testing Guide - Best Practices](./testing-guide.md#best-practices)

### Security & Safety

**Reference Documentation**:
- [Architecture Overview - Identifier Mapping Service](./architecture-overview.md#identifier-mapping-service)
- [Engineering Standards - Validation](./engineering-standards.md#validation)

**How to Check**:
- Search for hardcoded credentials or API keys
- Verify input validation in DTOs
- Check for authorization guards on endpoints
- Verify idempotency patterns in sync operations

- [ ] Credentials stored securely (not in code)
  - **Reference**: [Architecture Overview - Connection Entity](./architecture-overview.md#connection-entity)
  - **Check**: Search for patterns like `password`, `secret`, `key`, `token` in code
  
- [ ] Input validation prevents injection
  - **Reference**: [Engineering Standards - Validation](./engineering-standards.md#validation)
  - **Check**: Verify DTOs have validation decorators
  
- [ ] Authorization checks present
  - **Check**: Verify guards are applied to protected endpoints
  
- [ ] Idempotency keys used where needed
  - **Reference**: [Architecture Overview - Data Flow](./architecture-overview.md#data-flow)
  - **Check**: Verify sync operations and external API calls use idempotency keys
  
- [ ] Cursor safety (only advance after success)
  - **Check**: Review sync/polling logic to verify cursor advancement
  
- [ ] Transaction safety for multi-step operations
  - **Check**: Verify complex operations use transactions

## Issue Severity Levels

### 🔴 Blocking Issues

Must be fixed before merge:
- Architecture violations
- Security vulnerabilities
- Breaking changes to public APIs
- Test failures or incorrect test expectations
- Missing required file headers
- Domain exceptions in wrong layer

### 🟡 Strong Recommendations

Should be fixed but not blocking:
- Missing unit tests for critical paths
- Error handling improvements
- Performance optimizations
- Code duplication
- Missing documentation

### 🟢 Optional Improvements

Nice to have:
- Code style improvements
- Additional test coverage
- Documentation enhancements
- Refactoring opportunities

## Review Template

```markdown
# Code Review: [Feature/Component Name]

**Review Date**: YYYY-MM-DD  
**Reviewer**: AI Assistant  
**Scope**: [List of files reviewed, e.g., "apps/api/src/services/product-sync.service.ts, apps/api/src/services/product-sync.service.spec.ts"]

---

## 1️⃣ Summary

**Approach**: ✅/⚠️/❌ [Correct/Needs Improvement/Incorrect]
- Brief explanation of overall approach quality

**Safety**: ✅/⚠️/❌ [Safe to Merge/Not Safe/Blocked]
- Assessment of code safety (errors, concurrency, idempotency)

**Documentation Conflicts**: ✅/❌ [None/Yes]
- Whether code conflicts with documented standards

**Files Reviewed**: 
- `path/to/file1.ts` (X lines changed)
- `path/to/file2.ts` (Y lines changed)

---

## 2️⃣ Alignment With Documentation

### ✅ Aligned with Documentation
- [Specific compliance item] - e.g., "Service implements interface pattern correctly"
- [Another compliance item] - e.g., "Types defined in separate *.types.ts file"

### ❌ Deviations from Documentation
- [Violation] - e.g., "Service depends on concrete adapter instead of port interface"
  - **File**: `apps/api/src/services/product-sync.service.ts:23`
  - **Reference**: engineering-standards.md "Ports vs. Concrete Implementations"
  - **Impact**: Violates Dependency Inversion Principle, makes testing harder

---

## 3️⃣ Issues & Risks

### 🔴 Blocking Issues

1. **[Issue Title]**
   - **File**: `path/to/file.ts:line`
   - **Problem**: [Detailed description]
   - **Risk**: [What could go wrong]
   - **Fix**: [Concrete solution with code example]
   ```typescript
   // ❌ Current
   [incorrect code]
   
   // ✅ Suggested
   [correct code]
   ```

### 🟡 Strong Recommendations

1. **[Recommendation Title]**
   - **File**: `path/to/file.ts:line`
   - **Issue**: [What could be improved]
   - **Rationale**: [Why this matters]
   - **Suggestion**: [How to improve]

### 🟢 Optional Improvements

1. **[Improvement Title]**
   - **File**: `path/to/file.ts:line`
   - **Suggestion**: [Minor improvement]

---

## 4️⃣ Concrete Suggestions

### Suggestion 1: [Title]
**File**: `path/to/file.ts`

**Current Code**:
```typescript
// Show current implementation
```

**Suggested Fix**:
```typescript
// Show improved implementation
```

**Why**: [Explanation of improvement]

---

## 5️⃣ Documentation Gaps

- [Missing documentation item] - e.g., "File header missing in product-sync.service.ts"
- [Unclear documentation] - e.g., "JSDoc comment doesn't explain complex logic"

---

## 6️⃣ Test Coverage & Quality

**Unit Tests**: ✅/⚠️/❌
- Coverage: [X%] or [Missing/Incomplete]
- Issues: [List test issues]
- Suggestions: [How to improve tests]

**Integration Tests**: ✅/⚠️/❌
- Coverage: [Present/Missing]
- Issues: [List integration test issues]

**Test Quality**:
- ✅/❌ Tests mock ports correctly
- ✅/❌ Test expectations match implementation
- ✅/❌ Error cases covered

---

## 7️⃣ Integration & Sync Safety

**Concurrency**: ✅/⚠️/❌
- [Assessment of concurrent operation safety]

**Idempotency**: ✅/⚠️/❌
- [Assessment of idempotency key usage]

**Error Handling**: ✅/⚠️/❌
- [Assessment of error handling and recovery]

**Transaction Safety**: ✅/⚠️/❌
- [Assessment of transaction usage for multi-step operations]

---

## Final Verdict

**Status**: ✅/⚠️/❌ [APPROVED/BLOCKED/NEEDS WORK]

**Required Fixes** (must fix before merge):
1. [Blocking issue 1]
2. [Blocking issue 2]

**Recommended Fixes** (should fix but not blocking):
1. [Recommendation 1]
2. [Recommendation 2]

**Optional Improvements** (nice to have):
1. [Improvement 1]

**Estimated Fix Time**: [X hours]
- Blocking issues: [Y hours]
- Recommendations: [Z hours]
- Optional: [W hours]
```

## Using Codebase Search for Reviews

**For AI Assistants**: Use codebase search to find patterns and verify compliance.

### Effective Search Queries

1. **Find Similar Implementations**
   - "How are ports defined in the domain layer?"
   - "How are adapters implemented for PrestaShop?"
   - "How are repository ports used in services?"

2. **Verify Patterns**
   - "Where are domain exceptions defined?"
   - "How are services structured with interfaces?"
   - "How are types defined in separate files?"

3. **Check Compliance**
   - "How are imports organized in service files?"
   - "How are file headers structured?"
   - "How are tests structured for handlers?"

4. **Find Examples**
   - "Show me examples of adapter implementations"
   - "Show me examples of repository port usage"
   - "Show me examples of error handling in repositories"

### Search Strategy

1. **Start Broad**: Search for general patterns to understand the codebase
2. **Narrow Down**: Search for specific implementations similar to the code being reviewed
3. **Compare**: Compare the reviewed code with existing patterns
4. **Verify**: Use grep to find specific violations (e.g., `any` types, deep imports)

## Common Issues to Watch For

### Architecture Violations

1. **Domain Layer Dependencies**
   - **Reference**: [Engineering Standards - Domain Layer Independence](./engineering-standards.md#domain-layer-independence)
   - **How to Check**: Search for imports from `@nestjs/*`, `typeorm`, or other frameworks in domain files
   - **Fix**: Move ORM entities to `infrastructure/persistence/entities/`, keep domain pure

2. **Exception Placement**
   - **Reference**: [Engineering Standards - Error Handling](./engineering-standards.md#error-handling)
   - **How to Check**: Search for exception class definitions, verify they're in `domain/exceptions/`
   - **Fix**: Move exceptions to domain layer, import in infrastructure/application layers

3. **Port vs Implementation**
   - **Reference**: [Engineering Standards - Ports vs. Concrete Implementations](./engineering-standards.md#ports-vs-concrete-implementations)
   - **How to Check**: Search for concrete adapter class names in service constructors
   - **Fix**: Inject port interface instead of concrete adapter

### Code Quality

1. **Type Definitions**
   - **Reference**: [Engineering Standards - Type Definitions in Separate Files](./engineering-standards.md#type-definitions-in-separate-files)
   - **How to Check**: Search for `type` or `interface` keywords in service/entity files
   - **Fix**: Extract types to separate `*.types.ts` file

2. **Union Types**
   - **Reference**: [Engineering Standards - Union Types: `as const` Pattern](./engineering-standards.md#union-types-as-const-pattern-default)
   - **How to Check**: Search for `enum` keyword in domain type files
   - **Fix**: Convert enums to `as const` + union type pattern

3. **Error Handling**
   - **Reference**: [Engineering Standards - Error Handling](./engineering-standards.md#error-handling)
   - **How to Check**: Search for `throw new Error` and infrastructure error types in catch blocks
   - **Fix**: Create domain exceptions and convert infrastructure errors in repositories

### Test Issues

1. **Test Expectations**
   - **Reference**: [Testing Guide - Best Practices](./testing-guide.md#best-practices)
   - **How to Check**: Compare test expectations with actual implementation return values
   - **Fix**: Update test expectations to match implementation

2. **Mocking**
   - **Reference**: [Engineering Standards - Mocking Ports](./engineering-standards.md#mocking-ports)
   - **How to Check**: Verify mock types use port interfaces, not concrete classes
   - **Fix**: Change mock type to port interface

### Security & Safety

1. **Credentials**
   - **Reference**: [Architecture Overview - Connection Entity](./architecture-overview.md#connection-entity)
   - **How to Check**: Search for patterns like `password`, `secret`, `apiKey`, `token` in code
   - **Fix**: Use `credentialsRef` to reference secure credential storage

2. **Idempotency**
   - **Reference**: [Architecture Overview - Data Flow](./architecture-overview.md#data-flow)
   - **How to Check**: Verify sync operations and external API calls include idempotency keys
   - **Fix**: Add idempotency key parameter and check before operations

3. **Cursor Safety**
   - **How to Check**: Review sync/polling logic to verify cursor advancement timing
   - **Fix**: Move cursor advancement after successful operation completion

## Review Best Practices

### For AI Assistants

1. **Be Specific**: Reference exact files and line numbers
   - ✅ "In `apps/api/src/services/product-sync.service.ts:45`, the service imports `PrestashopAdapter` directly"
   - ❌ "The service has a dependency issue"

2. **Provide Context**: Explain why something is an issue
   - ✅ "This violates the Dependency Inversion Principle. Services should depend on port interfaces, not concrete implementations. This makes the code harder to test and less flexible."
   - ❌ "This is wrong"

3. **Suggest Fixes**: Include code examples when possible
   - ✅ Show both incorrect and correct code:
     ```typescript
     // ❌ Current (incorrect)
     constructor(private adapter: PrestashopProductAdapter) {}
     
     // ✅ Suggested fix
     constructor(private productMaster: ProductMasterPort) {}
     ```
   - ❌ "Change the dependency"

4. **Reference Standards**: Link to relevant documentation
   - ✅ "This violates the Port vs Implementation pattern documented in engineering-standards.md section 'Ports vs. Concrete Implementations'"
   - ❌ "This doesn't follow standards"

5. **Prioritize**: Focus on blocking issues first
   - Start with 🔴 Blocking Issues
   - Then 🟡 Strong Recommendations
   - Finally 🟢 Optional Improvements

6. **Be Constructive**: Frame feedback as improvements, not criticism
   - ✅ "Consider extracting types to a separate file for better organization and reusability"
   - ❌ "Types shouldn't be here"

7. **Use Codebase Search**: Find similar patterns to verify compliance
   - Search for similar implementations to compare
   - Find examples of correct patterns
   - Verify consistency across the codebase

8. **Provide Actionable Fixes**: Give concrete steps to fix issues
   - ✅ "1. Create `product-sync.types.ts` file, 2. Move type definitions there, 3. Import types in service file"
   - ❌ "Fix the types"

## Quick Reference: Common Patterns to Verify

### Service Interface Pattern
**Reference**: [Engineering Standards - Service Interface Implementation](./engineering-standards.md#service-interface-implementation)
**Check**: Service has separate interface file

### Repository Port Pattern
**Reference**: [Engineering Standards - Repository Ports Pattern](./engineering-standards.md#repository-ports-pattern)
**Check**: Repository uses port interface

### Adapter Pattern
**Reference**: [Engineering Standards - Ports vs. Concrete Implementations](./engineering-standards.md#ports-vs-concrete-implementations)
**Check**: Adapter implements port

### Type Definition Pattern
**Reference**: [Engineering Standards - Type Definitions in Separate Files](./engineering-standards.md#type-definitions-in-separate-files)
**Check**: Types in separate file

### Error Handling Pattern
**Reference**: [Engineering Standards - Error Handling](./engineering-standards.md#error-handling)
**Check**: Domain exceptions used

### Import Organization Pattern
**Reference**: [Engineering Standards - Import Aliases](./engineering-standards.md#import-aliases)
**Check**: Imports follow order (external → cross-boundary → local)

## Related Documentation

- [Engineering Standards](./engineering-standards.md) - Coding conventions and patterns
- [Architecture Overview](./architecture-overview.md) - System architecture
- [Testing Guide](./testing-guide.md) - Testing standards and practices
