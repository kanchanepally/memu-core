import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveNovelMode } from './novel';

describe('novel entity detection', () => {
  const originalMode = process.env.MEMU_TWIN_NOVEL_MODE;

  beforeEach(() => {
    delete process.env.MEMU_TWIN_NOVEL_MODE;
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env.MEMU_TWIN_NOVEL_MODE;
    else process.env.MEMU_TWIN_NOVEL_MODE = originalMode;
  });

  describe('resolveNovelMode', () => {
    it('defaults to auto when unset', () => {
      expect(resolveNovelMode()).toBe('auto');
    });

    it('accepts explicit auto / prompt / off', () => {
      process.env.MEMU_TWIN_NOVEL_MODE = 'auto';
      expect(resolveNovelMode()).toBe('auto');
      process.env.MEMU_TWIN_NOVEL_MODE = 'prompt';
      expect(resolveNovelMode()).toBe('prompt');
      process.env.MEMU_TWIN_NOVEL_MODE = 'off';
      expect(resolveNovelMode()).toBe('off');
    });

    it('falls back to auto on invalid value', () => {
      process.env.MEMU_TWIN_NOVEL_MODE = 'nonsense';
      expect(resolveNovelMode()).toBe('auto');
    });
  });
});
