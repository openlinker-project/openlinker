import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

describe('Tabs (Radix wrapper)', () => {
  afterEach(cleanup);

  it('switches content when a trigger is activated', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="payload">Payload</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">Summary body</TabsContent>
        <TabsContent value="payload">Payload body</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText('Summary body')).toBeInTheDocument();
    expect(screen.queryByText('Payload body')).toBeNull();

    await user.click(screen.getByText('Payload'));
    expect(screen.getByText('Payload body')).toBeInTheDocument();
  });
});
