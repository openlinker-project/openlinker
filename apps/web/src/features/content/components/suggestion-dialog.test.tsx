/**
 * Suggestion Dialog — Unit Tests
 *
 * Verifies the generate → apply flow, the "not auto-saved" contract (Apply
 * just calls `onApply(text)` — persistence is the parent's job), and that
 * tone/extra inputs are forwarded as part of the suggest request payload.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuggestionDialog } from './suggestion-dialog';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { AI_GENERATION_DEMO_DISABLED_MESSAGE } from '../../../shared/config/demo-mode';
import type { SuggestionResponse } from '../api/content.types';

function makeSuggestionResponse(suggestion: string): SuggestionResponse {
  return {
    suggestion,
    requestId: 'req_1',
    templateKey: 'offer.description.suggest',
    templateVersion: 1,
    templateChannel: null,
    modelUsed: 'fake',
    latencyMs: 12,
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  };
}

describe('SuggestionDialog', () => {
  afterEach(cleanup);

  it('opens the dialog when the trigger is clicked', async () => {
    const mockApi = createMockApiClient();
    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
      { apiClient: mockApi },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Generate a draft for the/)).toBeInTheDocument();
  });

  it('forwards tone + extra instructions to the suggest API and previews the result', async () => {
    const suggest = vi
      .fn()
      .mockResolvedValue(makeSuggestionResponse('A concise product description.'));
    const mockApi = createMockApiClient({ content: { suggest } });
    const onApply = vi.fn();

    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel="allegro" onApply={onApply} />,
      { apiClient: mockApi },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));
    const dialog = await screen.findByRole('dialog');
    const within_ = within(dialog);

    await user.type(within_.getByLabelText('Tone'), 'confident');
    await user.type(within_.getByLabelText('Extra instructions'), 'mention warranty');
    await user.click(within_.getByRole('button', { name: 'Generate' }));

    expect(await within_.findByText('A concise product description.')).toBeInTheDocument();
    expect(suggest).toHaveBeenCalledWith('ol_product_1', {
      channel: 'allegro',
      tone: 'confident',
      extraInstructions: 'mention warranty',
    });
    // onApply must not fire until the operator explicitly applies.
    expect(onApply).not.toHaveBeenCalled();
  });

  it('calls onApply with the suggestion when the operator clicks "Apply to editor"', async () => {
    const suggest = vi.fn().mockResolvedValue(makeSuggestionResponse('Generated text'));
    const mockApi = createMockApiClient({ content: { suggest } });
    const onApply = vi.fn();

    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel={null} onApply={onApply} />,
      { apiClient: mockApi },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));
    const dialog = await screen.findByRole('dialog');
    const within_ = within(dialog);

    await user.click(within_.getByRole('button', { name: 'Generate' }));
    await within_.findByText('Generated text');
    await user.click(within_.getByRole('button', { name: 'Apply to editor' }));

    expect(onApply).toHaveBeenCalledWith('Generated text');
  });

  it('renders a deep link to /ai/prompt-templates when the suggest API returns a 404 missing-template error (#490)', async () => {
    const suggest = vi.fn().mockRejectedValue(
      new ApiError(
        'Prompt template not found: key=offer.description.suggest, channel=master, version=1. ' +
          'Seed a template with channel=null for this key, or use a channel-specific template.',
        404,
        { statusCode: 404, message: 'Prompt template not found: ...' },
      ),
    );
    const mockApi = createMockApiClient({ content: { suggest } });

    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
      { apiClient: mockApi },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));
    const dialog = await screen.findByRole('dialog');
    const within_ = within(dialog);

    await user.click(within_.getByRole('button', { name: 'Generate' }));

    // The error body shows up inside the dialog's Alert.
    expect(
      await within_.findByText(/Prompt template not found/),
    ).toBeInTheDocument();
    // And it carries the actionable deep link to the admin UI.
    const deepLink = within_.getByRole('link', { name: /Open prompt templates/ });
    expect(deepLink).toHaveAttribute('href', '/ai/prompt-templates');
  });

  it('does not render the deep link for unrelated errors', async () => {
    const suggest = vi
      .fn()
      .mockRejectedValue(new ApiError('Server exploded', 500, { statusCode: 500 }));
    const mockApi = createMockApiClient({ content: { suggest } });

    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
      { apiClient: mockApi },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));
    const dialog = await screen.findByRole('dialog');
    const within_ = within(dialog);

    await user.click(within_.getByRole('button', { name: 'Generate' }));

    expect(await within_.findByText('Server exploded')).toBeInTheDocument();
    expect(within_.queryByRole('link', { name: /Open prompt templates/ })).toBeNull();
  });

  it('omits empty tone and extraInstructions from the request payload', async () => {
    const suggest = vi.fn().mockResolvedValue(makeSuggestionResponse(''));
    const mockApi = createMockApiClient({ content: { suggest } });

    renderWithProviders(
      <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
      { apiClient: mockApi },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));
    const dialog = await screen.findByRole('dialog');
    const within_ = within(dialog);
    await user.click(within_.getByRole('button', { name: 'Generate' }));

    expect(suggest).toHaveBeenCalledWith('ol_product_1', {
      channel: null,
      tone: undefined,
      extraInstructions: undefined,
    });
  });

  describe('demo mode', () => {
    function renderInDemoMode() {
      const suggest = vi.fn();
      const mockApi = createMockApiClient({
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
        content: { suggest },
      });
      renderWithProviders(
        <SuggestionDialog productId="ol_product_1" channel={null} onApply={vi.fn()} />,
        { apiClient: mockApi },
      );
      return { suggest };
    }

    it('disables the trigger and does not open the dialog', async () => {
      const { suggest } = renderInDemoMode();
      const user = userEvent.setup();

      // Re-query inside waitFor: the enabled Dialog trigger renders first and is
      // replaced by the disabled demo trigger once the config query resolves.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Suggest with AI/ })).toBeDisabled(),
      );

      await user.click(screen.getByRole('button', { name: /Suggest with AI/ }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(suggest).not.toHaveBeenCalled();
    });

    it('surfaces the demo-mode tooltip on the locked trigger', async () => {
      renderInDemoMode();
      const user = userEvent.setup();

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Suggest with AI/ })).toBeDisabled(),
      );

      // The tooltip trigger is the focusable span wrapping the disabled button.
      const trigger = screen.getByRole('button', { name: /Suggest with AI/ });
      await user.hover(trigger.parentElement as HTMLElement);

      expect(
        await screen.findByText(AI_GENERATION_DEMO_DISABLED_MESSAGE),
      ).toBeInTheDocument();
    });
  });
});
