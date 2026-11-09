/**
 * MCP Token Create Form
 *
 * Mint form for an MCP Personal Access Token (#1486). React Hook Form +
 * Zod, per the FE-001 baseline.
 *
 * Expiry is a REQUIRED field with a default rather than an optional
 * "never" — the MCP SDK rejects a token whose `expiresAt` is unset, so a
 * non-expiring token could never authenticate.
 *
 * @module apps/web/src/features/mcp-tokens/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useMemo, type ReactElement } from 'react';
import { z } from 'zod';
import {
  interpolate,
  useMessages,
  type Messages,
  type ResolvedCopy,
} from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import type { CreateMcpTokenInput, McpTokenScope } from '../api/mcp-tokens.types';

const MAX_EXPIRY_DAYS = 365;

type CreateFormCopy = ResolvedCopy<Messages['mcp-tokens']>['mcpTokenCreateForm'];

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the zod type is inferred from this builder
function createMcpTokenSchema(copy: CreateFormCopy['validation']) {
  return z.object({
    name: z.string().trim().min(1, copy.nameRequired).max(100, copy.nameTooLong),
    scope: z.enum(['mcp:read', 'mcp:write']),
    expiresInDays: z
      .number()
      .int(copy.wholeDays)
      .min(1, copy.minDays)
      .max(MAX_EXPIRY_DAYS, interpolate(copy.maxDays, { max: MAX_EXPIRY_DAYS })),
  });
}

type CreateMcpTokenFormValues = z.infer<ReturnType<typeof createMcpTokenSchema>>;

interface McpTokenCreateFormProps {
  onSubmit: (input: CreateMcpTokenInput) => void;
  isSubmitting: boolean;
}

export function McpTokenCreateForm({
  onSubmit,
  isSubmitting,
}: McpTokenCreateFormProps): ReactElement {
  const copy = useMessages('mcp-tokens').mcpTokenCreateForm;
  const schema = useMemo(() => createMcpTokenSchema(copy.validation), [copy.validation]);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateMcpTokenFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', scope: 'mcp:read', expiresInDays: 90 },
  });

  // handleSubmit returns a promise; wrap in `void` so the DOM handler stays
  // void-returning (matches the mailer-settings-dialog precedent).
  const submit = handleSubmit((values) => {
    onSubmit({
      name: values.name,
      scope: values.scope as McpTokenScope,
      expiresInDays: values.expiresInDays,
    });
    reset();
  });

  return (
    <form
      className="mcp-token-create-form"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <FormField label={copy.nameLabel} name="name" error={errors.name?.message}>
        <Input
          id="mcp-token-name"
          placeholder={copy.namePlaceholder}
          invalid={Boolean(errors.name)}
          {...register('name')}
        />
      </FormField>

      <FormField
        label={copy.scopeLabel}
        name="scope"
        description={copy.scopeDescription}
        error={errors.scope?.message}
      >
        <Select id="mcp-token-scope" invalid={Boolean(errors.scope)} {...register('scope')}>
          <option value="mcp:read">{copy.scopeRead}</option>
          <option value="mcp:write">{copy.scopeWrite}</option>
        </Select>
      </FormField>

      <FormField
        label={copy.expiryLabel}
        name="expiresInDays"
        description={interpolate(copy.expiryDescription, { max: MAX_EXPIRY_DAYS })}
        error={errors.expiresInDays?.message}
      >
        <Input
          id="mcp-token-expiry"
          type="number"
          min={1}
          max={MAX_EXPIRY_DAYS}
          invalid={Boolean(errors.expiresInDays)}
          {...register('expiresInDays', { valueAsNumber: true })}
        />
      </FormField>

      <Button type="submit" tone="primary" disabled={isSubmitting}>
        {isSubmitting ? copy.submitting : copy.submit}
      </Button>
    </form>
  );
}
