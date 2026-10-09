import { afterEach, describe, expect, it, vi } from 'vitest';
import { debouncedRefresh } from '../src/lib/liveList.js';

describe('live list refresh debounce', () => {
  afterEach(() => vi.useRealTimers());

  it('coalesces a burst of socket nudges into one refresh', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const debounce = debouncedRefresh(refresh, 180);

    debounce.schedule();
    vi.advanceTimersByTime(100);
    debounce.schedule();
    vi.advanceTimersByTime(100);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('cancels a scheduled refresh when the page leaves', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const debounce = debouncedRefresh(refresh, 180);

    debounce.schedule();
    debounce.cancel();
    vi.advanceTimersByTime(200);
    expect(refresh).not.toHaveBeenCalled();
  });
});
