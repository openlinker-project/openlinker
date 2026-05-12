/**
 * NewPromptTemplateDialog — Component Tests
 *
 * Covers form rendering, validation, channel mapping ('master' → null),
 * variables JSON parse + validation, success navigation, and API error
 * surface (#488).
 *
 * @module apps/web/src/features/prompt-templates/components
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { NewPromptTemplateDialog } from './new-prompt-template-dialog';
import type { PromptTemplate } from '../api/prompt-templates.types';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: overrides.id ?? 'tmpl-new',
    key: overrides.key ?? 'new.template.key',
    channel: overrides.channel !== undefined ? overrides.channel : null,
    version: overrides.version ?? 1,
    systemPrompt: overrides.systemPrompt ?? 'sys',
    userPromptTemplate: overrides.userPromptTemplate ?? 'user',
    variables: overrides.variables ?? [],
    state: overrides.state ?? 'draft',
    publishedAt: overrides.publishedAt ?? null,
    createdBy: overrides.createdBy ?? 'admin',
    createdAt: overrides.createdAt ?? '2026-04-23T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-23T10:00:00.000Z',
  };
}

describe('NewPromptTemplateDialog', () => {
  it('renders all form fields when open', () => {
    const client = createMockApiClient();
    renderWithProviders(
      <NewPromptTemplateDialog open={true} onOpenChange={vi.fn()} />,
      { apiClient: client },
    );
    expect(screen.getByLabelText(/^key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^channel/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/system prompt/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/user prompt template/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/variables \(json\)/i)).toBeInTheDocument();
  });

  it('shows a validation error when the key is empty', async () => {
    const create = vi.fn();
    const client = createMockApiClient({ promptTemplates: { create } });
    renderWithProviders(
      <NewPromptTemplateDialog open={true} onOpenChange={vi.fn()} />,
      { apiClient: client },
    );
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));
    // Both FormErrorSummary and the inline FieldError render the message.
    expect((await screen.findAllByText(/key is required/i)).length).toBeGreaterThan(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("sends channel: null when 'Master (generic)' is selected", async () => {
    navigateMock.mockClear();
    const create = vi.fn().mockResolvedValue(makeTemplate({ id: 'tmpl-new', channel: null }));
    const onOpenChange = vi.fn();
    const client = createMockApiClient({ promptTemplates: { create } });
    renderWithProviders(
      <NewPromptTemplateDialog open={true} onOpenChange={onOpenChange} />,
      { apiClient: client },
    );

    fireEvent.change(screen.getByLabelText(/^key/i), {
      target: { value: 'product.title.suggest' },
    });
    fireEvent.change(screen.getByLabelText(/system prompt/i), {
      target: { value: 'You are an assistant.' },
    });
    fireEvent.change(screen.getByLabelText(/user prompt template/i), {
      target: { value: 'Generate a title.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'product.title.suggest',
          channel: null,
          systemPrompt: 'You are an assistant.',
          userPromptTemplate: 'Generate a title.',
          variables: [],
        }),
      );
    });
  });

  it('navigates to the detail page on success and closes the dialog', async () => {
    navigateMock.mockClear();
    const create = vi.fn().mockResolvedValue(makeTemplate({ id: 'tmpl-new-42' }));
    const onOpenChange = vi.fn();
    const client = createMockApiClient({ promptTemplates: { create } });
    renderWithProviders(
      <NewPromptTemplateDialog open={true} onOpenChange={onOpenChange} />,
      { apiClient: client },
    );

    fireEvent.change(screen.getByLabelText(/^key/i), {
      target: { value: 'a.b' },
    });
    fireEvent.change(screen.getByLabelText(/system prompt/i), {
      target: { value: 'sys' },
    });
    fireEvent.change(screen.getByLabelText(/user prompt template/i), {
      target: { value: 'user' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/ai/prompt-templates/tmpl-new-42');
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows an inline alert when the API rejects (e.g. duplicate key)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('Key already exists'));
    const client = createMockApiClient({ promptTemplates: { create } });
    renderWithProviders(
      <NewPromptTemplateDialog open={true} onOpenChange={vi.fn()} />,
      { apiClient: client },
    );
    fireEvent.change(screen.getByLabelText(/^key/i), { target: { value: 'a.b' } });
    fireEvent.change(screen.getByLabelText(/system prompt/i), { target: { value: 'sys' } });
    fireEvent.change(screen.getByLabelText(/user prompt template/i), { target: { value: 'user' } });
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    expect(await screen.findByText(/key already exists/i)).toBeInTheDocument();
  });

  it('lists every registered plugin in the channel select (#580)', () => {
    const client = createMockApiClient();
    renderWithProviders(
      <NewPromptTemplateDialog open={true} onOpenChange={vi.fn()} />,
      { apiClient: client },
    );

    // The dialog derives its channel options from the live plugin registry.
    // Assert the registry-driven shape without freezing the plugin set —
    // a new plugin landing should not break this test.
    const channelSelect = screen.getByLabelText(/^channel/i);
    if (!(channelSelect instanceof HTMLSelectElement)) {
      throw new Error('channel control is not a <select>');
    }
    const optionValues = Array.from(channelSelect.options).map((option) => option.value);
    expect(optionValues[0]).toBe('master');
    expect(optionValues).toEqual(expect.arrayContaining(['master', 'prestashop', 'allegro']));
    expect(optionValues.length).toBeGreaterThanOrEqual(3);
  });

  it('sends an arbitrary plugin channel verbatim to the API (#580)', async () => {
    navigateMock.mockClear();
    const create = vi
      .fn()
      .mockResolvedValue(makeTemplate({ id: 'tmpl-new', channel: 'prestashop' }));
    const client = createMockApiClient({ promptTemplates: { create } });
    renderWithProviders(
      <NewPromptTemplateDialog open={true} onOpenChange={vi.fn()} />,
      { apiClient: client },
    );

    fireEvent.change(screen.getByLabelText(/^key/i), {
      target: { value: 'offer.description.suggest' },
    });
    fireEvent.change(screen.getByLabelText(/^channel/i), {
      target: { value: 'prestashop' },
    });
    fireEvent.change(screen.getByLabelText(/system prompt/i), { target: { value: 'sys' } });
    fireEvent.change(screen.getByLabelText(/user prompt template/i), { target: { value: 'user' } });
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'prestashop' }),
      );
    });
  });

  it('rejects invalid JSON in the variables field with an inline error', async () => {
    const create = vi.fn();
    const client = createMockApiClient({ promptTemplates: { create } });
    renderWithProviders(
      <NewPromptTemplateDialog open={true} onOpenChange={vi.fn()} />,
      { apiClient: client },
    );
    fireEvent.change(screen.getByLabelText(/^key/i), { target: { value: 'a.b' } });
    fireEvent.change(screen.getByLabelText(/system prompt/i), { target: { value: 'sys' } });
    fireEvent.change(screen.getByLabelText(/user prompt template/i), { target: { value: 'user' } });
    fireEvent.change(screen.getByLabelText(/variables \(json\)/i), {
      target: { value: 'not-json' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    expect((await screen.findAllByText(/invalid json/i)).length).toBeGreaterThan(0);
    expect(create).not.toHaveBeenCalled();
  });
});
