import { describe, it, expect } from 'vitest';
import {
  normaliseState,
  nextPendingStep,
  progressPercent,
  isComplete,
  ONBOARDING_STEP_ORDER,
} from './state';

describe('normaliseState', () => {
  it('returns a fully-populated default for a fresh profile (empty object)', () => {
    const s = normaliseState({});
    expect(s.people).toBe('pending');
    expect(s.rhythm).toBe('pending');
    expect(s.focus).toBe('pending');
    expect(s.preview).toBe('pending');
    expect(s.channels).toBe('pending');
    expect(s.completedAt).toBeNull();
    expect(s.answers).toEqual({});
  });

  it('returns default for null / undefined / non-object input', () => {
    expect(normaliseState(null).people).toBe('pending');
    expect(normaliseState(undefined).people).toBe('pending');
    expect(normaliseState(42).people).toBe('pending');
    expect(normaliseState('string').people).toBe('pending');
  });

  it('preserves valid step statuses', () => {
    const s = normaliseState({
      people: 'answered',
      rhythm: 'skipped',
      focus: 'pending',
      preview: 'answered',
      channels: 'skipped',
    });
    expect(s.people).toBe('answered');
    expect(s.rhythm).toBe('skipped');
    expect(s.focus).toBe('pending');
    expect(s.preview).toBe('answered');
    expect(s.channels).toBe('skipped');
  });

  it('coerces bad values to pending — never trusts JSONB content blindly', () => {
    const s = normaliseState({ people: 'completed', rhythm: 42, focus: null });
    expect(s.people).toBe('pending');
    expect(s.rhythm).toBe('pending');
    expect(s.focus).toBe('pending');
  });

  it('preserves answers map for known step keys, drops unknown keys', () => {
    const s = normaliseState({
      answers: {
        people: 'Rach (wife) and Robin (7yo)',
        rhythm: 'School run M-F',
        unknownStep: 'should drop',
      },
    });
    expect(s.answers.people).toBe('Rach (wife) and Robin (7yo)');
    expect(s.answers.rhythm).toBe('School run M-F');
    expect((s.answers as any).unknownStep).toBeUndefined();
  });

  it('preserves completedAt timestamp when present', () => {
    const ts = '2026-04-29T17:00:00Z';
    const s = normaliseState({ completedAt: ts });
    expect(s.completedAt).toBe(ts);
  });

  it('drops non-string completedAt', () => {
    const s = normaliseState({ completedAt: 12345 });
    expect(s.completedAt).toBeNull();
  });
});

describe('nextPendingStep', () => {
  it('returns the first pending step in canonical order', () => {
    const s = normaliseState({});
    expect(nextPendingStep(s)).toBe('people');
  });

  it('skips answered steps', () => {
    const s = normaliseState({ people: 'answered' });
    expect(nextPendingStep(s)).toBe('rhythm');
  });

  it('treats skipped steps as resolved (does not return them)', () => {
    const s = normaliseState({ people: 'skipped', rhythm: 'skipped' });
    expect(nextPendingStep(s)).toBe('focus');
  });

  it('returns null when every step is non-pending', () => {
    const s = normaliseState({
      people: 'answered',
      rhythm: 'answered',
      focus: 'skipped',
      preview: 'answered',
      channels: 'skipped',
    });
    expect(nextPendingStep(s)).toBeNull();
  });

  it('returns null when completedAt is set even if some steps are still pending', () => {
    const s = normaliseState({
      people: 'pending',
      completedAt: '2026-04-29T17:00:00Z',
    });
    expect(nextPendingStep(s)).toBeNull();
  });

  it('honours canonical step order — preview comes after focus, channels last', () => {
    const s = normaliseState({
      people: 'answered',
      rhythm: 'answered',
      focus: 'answered',
    });
    expect(nextPendingStep(s)).toBe('preview');
  });
});

describe('progressPercent', () => {
  it('returns 0 for a fresh profile', () => {
    expect(progressPercent(normaliseState({}))).toBe(0);
  });

  it('returns 100 when every step is non-pending', () => {
    const s = normaliseState({
      people: 'answered',
      rhythm: 'answered',
      focus: 'skipped',
      preview: 'answered',
      channels: 'answered',
    });
    expect(progressPercent(s)).toBe(100);
  });

  it('counts skipped + answered the same way', () => {
    const a = normaliseState({ people: 'answered' });
    const b = normaliseState({ people: 'skipped' });
    expect(progressPercent(a)).toBe(progressPercent(b));
  });

  it('rounds to nearest integer', () => {
    // 1 of 5 = 20%
    expect(progressPercent(normaliseState({ people: 'answered' }))).toBe(20);
    // 2 of 5 = 40%
    expect(progressPercent(normaliseState({ people: 'answered', rhythm: 'skipped' }))).toBe(40);
    // 3 of 5 = 60%
    expect(progressPercent(normaliseState({
      people: 'answered', rhythm: 'skipped', focus: 'answered',
    }))).toBe(60);
  });
});

describe('isComplete', () => {
  it('false for a fresh profile', () => {
    expect(isComplete(normaliseState({}))).toBe(false);
  });

  it('true when every step is non-pending', () => {
    const s = normaliseState({
      people: 'answered',
      rhythm: 'answered',
      focus: 'answered',
      preview: 'answered',
      channels: 'answered',
    });
    expect(isComplete(s)).toBe(true);
  });

  it('true when completedAt is set even if some steps are still pending', () => {
    const s = normaliseState({
      people: 'pending',
      completedAt: '2026-04-29T17:00:00Z',
    });
    expect(isComplete(s)).toBe(true);
  });

  it('false when at least one step is still pending and no completedAt', () => {
    const s = normaliseState({
      people: 'answered',
      rhythm: 'answered',
      focus: 'answered',
      preview: 'pending',
      channels: 'answered',
    });
    expect(isComplete(s)).toBe(false);
  });
});

describe('ONBOARDING_STEP_ORDER', () => {
  it('is the canonical order — locked so the UI navigation matches', () => {
    expect(ONBOARDING_STEP_ORDER).toEqual(['people', 'rhythm', 'focus', 'preview', 'channels']);
  });
});
