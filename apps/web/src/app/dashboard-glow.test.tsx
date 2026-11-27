import { act, render, screen, type RenderResult } from '@testing-library/react';
import { MotionConfig } from 'motion/react';
import type { ReactElement } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as spotsModule from './dashboard-glow-spots';
import { DashboardGlow } from './dashboard-glow';
import { useBackgroundGlow } from './hooks/use-background-glow';
import { renderHook } from '@testing-library/react';

let navigateTo: (path: string) => void = () => undefined;

function NavigateProbe(): ReactElement | null {
  const navigate = useNavigate();
  navigateTo = (path: string): void => {
    void navigate(path);
  };
  return null;
}

function renderGlow(reducedMotion: 'never' | 'always' = 'never'): RenderResult {
  return render(
    <MotionConfig reducedMotion={reducedMotion}>
      <MemoryRouter initialEntries={['/orders']}>
        <NavigateProbe />
        <DashboardGlow />
      </MemoryRouter>
    </MotionConfig>
  );
}

describe('DashboardGlow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render two orbs hidden from assistive technology when mounted', () => {
    const { container } = renderGlow();

    const glow = screen.getByTestId('dashboard-glow');
    expect(glow).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.dashboard-glow__orb')).toHaveLength(2);
  });

  it('should pick new spots when the route changes', () => {
    const pick = vi.spyOn(spotsModule, 'pickGlowSpots');
    renderGlow();
    expect(pick).not.toHaveBeenCalled();

    act(() => navigateTo('/products'));

    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('should keep the light still when reduced motion is on', () => {
    const pick = vi.spyOn(spotsModule, 'pickGlowSpots');
    renderGlow('always');

    act(() => navigateTo('/products'));

    expect(pick).not.toHaveBeenCalled();
    expect(screen.getByTestId('dashboard-glow')).toHaveClass('dashboard-glow--still');
  });

  it('should fade out and stop drifting when the operator switches it off', () => {
    const pick = vi.spyOn(spotsModule, 'pickGlowSpots');
    renderGlow();
    const toggle = renderHook(() => useBackgroundGlow());

    act(() => {
      toggle.result.current[1](false);
    });
    expect(screen.getByTestId('dashboard-glow')).toHaveClass('dashboard-glow--off');

    act(() => navigateTo('/products'));
    expect(pick).not.toHaveBeenCalled();

    act(() => {
      toggle.result.current[1](true);
    });
    expect(screen.getByTestId('dashboard-glow')).not.toHaveClass('dashboard-glow--off');
    window.localStorage.removeItem('openlinker-background-glow');
  });
});
