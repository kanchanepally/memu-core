import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectViolations,
  enforceTwinInvariant,
  resolveGuardMode,
  TwinViolationError,
  resetEntityNameCache,
} from './guard';

describe('detectViolations', () => {
  it('returns empty when no names registered', () => {
    expect(detectViolations('Hareesh is working.', [])).toEqual([]);
  });

  it('detects a real name as a whole word', () => {
    expect(detectViolations('Hareesh is working.', ['Hareesh'])).toEqual(['Hareesh']);
  });

  it('is case-insensitive', () => {
    expect(detectViolations('hareesh is working.', ['Hareesh'])).toEqual(['Hareesh']);
  });

  it('does not match inside larger words', () => {
    // 'Rob' must not match inside 'Robin'.
    expect(detectViolations('Robin is here.', ['Rob'])).toEqual([]);
  });

  it('detects multiple distinct violations', () => {
    const hits = detectViolations('Hareesh and Rach will be there.', ['Hareesh', 'Rach']);
    expect(hits.sort()).toEqual(['Hareesh', 'Rach']);
  });

  it('escapes regex metacharacters in names', () => {
    // A name like "St. Mark's" contains dot + apostrophe — must not blow up regex.
    expect(detectViolations("We go to St. Mark's.", ["St. Mark's"])).toEqual(["St. Mark's"]);
  });
});

describe('resolveGuardMode', () => {
  const originalMode = process.env.MEMU_TWIN_GUARD_MODE;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.MEMU_TWIN_GUARD_MODE;
    else process.env.MEMU_TWIN_GUARD_MODE = originalMode;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it('defaults to throw in non-production', () => {
    delete process.env.MEMU_TWIN_GUARD_MODE;
    process.env.NODE_ENV = 'development';
    expect(resolveGuardMode()).toBe('throw');
  });

  it('defaults to log_and_anonymize in production', () => {
    delete process.env.MEMU_TWIN_GUARD_MODE;
    process.env.NODE_ENV = 'production';
    expect(resolveGuardMode()).toBe('log_and_anonymize');
  });

  it('honours explicit env override', () => {
    process.env.MEMU_TWIN_GUARD_MODE = 'off';
    expect(resolveGuardMode()).toBe('off');
  });

  it('falls back to default on invalid env value', () => {
    process.env.MEMU_TWIN_GUARD_MODE = 'banana';
    process.env.NODE_ENV = 'development';
    expect(resolveGuardMode()).toBe('throw');
  });
});

describe('enforceTwinInvariant', () => {
  beforeEach(() => {
    resetEntityNameCache();
  });

  it('passes clean text vacuously when registry is empty', async () => {
    const result = await enforceTwinInvariant(
      'extraction',
      { userPrompt: 'Hareesh is working.' },
      { names: [] },
    );
    expect(result.verified).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('passes text that contains no registered names', async () => {
    const result = await enforceTwinInvariant(
      'extraction',
      { userPrompt: 'Adult-1 is working.' },
      { names: ['Hareesh', 'Rach'], mode: 'throw' },
    );
    expect(result.verified).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('throws TwinViolationError in throw mode when a real name leaks', async () => {
    await expect(
      enforceTwinInvariant(
        'extraction',
        { userPrompt: 'Hareesh is working.' },
        { names: ['Hareesh'], mode: 'throw' },
      ),
    ).rejects.toBeInstanceOf(TwinViolationError);
  });

  it('throw-mode error carries the violating entities', async () => {
    try {
      await enforceTwinInvariant(
        'extraction',
        { userPrompt: 'Hareesh and Rach are here.' },
        { names: ['Hareesh', 'Rach'], mode: 'throw' },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TwinViolationError);
      const v = (err as TwinViolationError).violations.sort();
      expect(v).toEqual(['Hareesh', 'Rach']);
      expect((err as TwinViolationError).skillName).toBe('extraction');
    }
  });

  it('detects violation in system prompt as well as user prompt', async () => {
    await expect(
      enforceTwinInvariant(
        'extraction',
        { systemPrompt: 'You are helping Hareesh.', userPrompt: 'Hello' },
        { names: ['Hareesh'], mode: 'throw' },
      ),
    ).rejects.toBeInstanceOf(TwinViolationError);
  });

  it('detects violation in history', async () => {
    await expect(
      enforceTwinInvariant(
        'extraction',
        {
          userPrompt: 'Hello',
          history: [{ role: 'user', content: 'Earlier: Hareesh said something' }],
        },
        { names: ['Hareesh'], mode: 'throw' },
      ),
    ).rejects.toBeInstanceOf(TwinViolationError);
  });

  it('off mode skips the check entirely', async () => {
    const result = await enforceTwinInvariant(
      'extraction',
      { userPrompt: 'Hareesh is working.' },
      { names: ['Hareesh'], mode: 'off' },
    );
    expect(result.violations).toEqual([]);
    // Off mode explicitly does not verify (we signal that the check was skipped).
    expect(result.verified).toBe(false);
  });
});
