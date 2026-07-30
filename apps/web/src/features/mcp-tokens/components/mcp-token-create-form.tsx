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
import type { ReactElement } from 'react';
import { z } from 'zod';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import type { CreateMcpTokenInput, McpTokenScope } from '../api/mcp-tokens.types';

const MAX_EXPIRY_DAYS = 365;

const createMcpTokenSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  scope: z.enum(['mcp:read', 'mcp:write']),
  expiresInDays: z
    .number()
    .int('Must be a whole number of days')
    .min(1, 'Must be at least 1 day')
    .max(MAX_EXPIRY_DAYS, `Must be ${MAX_EXPIRY_DAYS} days or fewer`),
});

type CreateMcpTokenFormValues = z.infer<typeof createMcpTokenSchema>;

interface McpTokenCreateFormProps {
  onSubmit: (input: CreateMcpTokenInput) => void;
  isSubmitting: boolean;
}

export function McpTokenCreateForm({
  onSubmit,
  isSubmitting,
}: McpTokenCreateFormProps): ReactElement {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateMcpTokenFormValues>({
    resolver: zodResolver(createMcpTokenSchema),
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
      <FormField label="Name" name="name" error={errors.name?.message}>
        <Input
          id="mcp-token-name"
          placeholder="e.g. Claude Desktop — laptop"
          invalid={Boolean(errors.name)}
          {...register('name')}
        />
      </FormField>

      <FormField
        label="Scope"
        name="scope"
        description="Read-only tokens cannot drive writes. Write implies read."
        error={errors.scope?.message}
      >
        <Select id="mcp-token-scope" invalid={Boolean(errors.scope)} {...register('scope')}>
          <option value="mcp:read">Read-only (mcp:read)</option>
          <option value="mcp:write">Read + write (mcp:write)</option>
        </Select>
      </FormField>

      <FormField
        label="Expires in (days)"
        name="expiresInDays"
        description={`Required. Maximum ${MAX_EXPIRY_DAYS} days.`}
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
        {isSubmitting ? 'Creating…' : 'Create token'}
      </Button>
    </form>
  );
}
