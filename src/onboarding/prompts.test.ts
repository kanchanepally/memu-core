import { describe, it, expect } from 'vitest';
import { detectRegister, copyForStep, buildAcknowledgement } from './prompts';
import { normaliseState } from './state';

describe('detectRegister', () => {
  it('returns "household" on undefined / empty input', () => {
    expect(detectRegister(undefined)).toBe('household');
    expect(detectRegister('')).toBe('household');
  });

  it('detects solo register from explicit cues', () => {
    expect(detectRegister('Just me')).toBe('solo');
    expect(detectRegister('only me')).toBe('solo');
    expect(detectRegister('Just myself, no flatmates')).toBe('solo');
    expect(detectRegister('alone for now')).toBe('solo');
    expect(detectRegister('Solo, between flatmates')).toBe('solo');
  });

  it('detects children register from explicit terms', () => {
    expect(detectRegister('Rach (wife) and Robin our 7yo son')).toBe('children');
    expect(detectRegister('partner Tom and our daughter')).toBe('children');
    expect(detectRegister('two kids')).toBe('children');
    expect(detectRegister('toddler Mira')).toBe('children');
    expect(detectRegister('teenager named Asha')).toBe('children');
  });

  it('detects children register from age numbers', () => {
    expect(detectRegister('Robin (7yo)')).toBe('children');
    expect(detectRegister('Asha 14 yr')).toBe('children');
    expect(detectRegister('the 10-year-old, Marcus')).toBe('children');
  });

  it('detects couple register when partner term but no children term', () => {
    expect(detectRegister('Rach my wife')).toBe('couple');
    expect(detectRegister('partner Sam')).toBe('couple');
    expect(detectRegister('my husband Andre')).toBe('couple');
    expect(detectRegister('fiancée Mila')).toBe('couple');
  });

  it('children cue takes precedence over couple cue', () => {
    expect(detectRegister('wife Rach and son Robin')).toBe('children');
    expect(detectRegister('partner Tom and our 5yo Mira')).toBe('children');
  });

  it('falls back to household for ambiguous group input', () => {
    expect(detectRegister('Mum, Dad, and my brother')).toBe('household');
    expect(detectRegister('three flatmates')).toBe('household');
  });
});

describe('copyForStep', () => {
  it('people step copy is independent of state (always the same opener)', () => {
    const a = copyForStep('people', normaliseState({}));
    const b = copyForStep('people', normaliseState({ answers: { people: 'irrelevant' } }));
    expect(a.prompt).toBe(b.prompt);
    expect(a.prompt).toMatch(/who are the people/i);
  });

  it('rhythm step adapts to solo register from people answer', () => {
    const state = normaliseState({ answers: { people: 'Just me' } });
    const copy = copyForStep('rhythm', state);
    expect(copy.placeholder).toMatch(/standup|gym|sunday/i);
    // Solo register should NOT mention school runs.
    expect(copy.placeholder.toLowerCase()).not.toMatch(/school run/);
  });

  it('rhythm step adapts to children register', () => {
    const state = normaliseState({ answers: { people: 'Rach (wife) and Robin (7yo son)' } });
    const copy = copyForStep('rhythm', state);
    expect(copy.placeholder.toLowerCase()).toMatch(/school run/);
  });

  it('rhythm step adapts to couple register without children', () => {
    const state = normaliseState({ answers: { people: 'my partner Sam' } });
    const copy = copyForStep('rhythm', state);
    expect(copy.placeholder.toLowerCase()).toMatch(/together|date night|yoga|call to/);
  });

  it('focus step example references children when register is children', () => {
    const state = normaliseState({ answers: { people: 'Robin (7yo)' } });
    const copy = copyForStep('focus', state);
    expect(copy.placeholder.toLowerCase()).toMatch(/parent.teacher|robin|half-term/);
  });

  it('focus step references work when work signals appear', () => {
    const state = normaliseState({ answers: { people: 'Just me — solo founder' } });
    const copy = copyForStep('focus', state);
    expect(copy.placeholder.toLowerCase()).toMatch(/board|q[0-9]|client/);
  });

  it('every step returns non-empty prompt, placeholder, helper, skipLabel', () => {
    const state = normaliseState({});
    for (const step of ['people', 'rhythm', 'focus', 'preview', 'channels'] as const) {
      const copy = copyForStep(step, state);
      expect(copy.prompt.length).toBeGreaterThan(10);
      expect(copy.helper.length).toBeGreaterThan(5);
      expect(copy.skipLabel.length).toBeGreaterThan(0);
    }
  });

  it('no copy uses banned marketing language', () => {
    const banned = /\b(delightful|seamless|effortless|powerful|revolutionary|world-class)\b/i;
    const state = normaliseState({ answers: { people: 'Rach and Robin' } });
    for (const step of ['people', 'rhythm', 'focus', 'preview', 'channels'] as const) {
      const copy = copyForStep(step, state);
      expect(copy.prompt).not.toMatch(banned);
      expect(copy.placeholder).not.toMatch(banned);
      expect(copy.helper).not.toMatch(banned);
    }
  });
});

describe('buildAcknowledgement', () => {
  it('honest "Noted" branch when no observations + no names', () => {
    const ack = buildAcknowledgement({ step: 'people', learnedNames: [], observationCount: 0 });
    expect(ack).toMatch(/noted/i);
    // Critically: no fake "Got it!" — that would be confabulation.
    expect(ack.toLowerCase()).not.toContain('got it');
  });

  it('people step single name', () => {
    const ack = buildAcknowledgement({ step: 'people', learnedNames: ['Rach'], observationCount: 1 });
    expect(ack).toBe(`Got it — I'll remember Rach.`);
  });

  it('people step two names — joined with "and"', () => {
    const ack = buildAcknowledgement({
      step: 'people', learnedNames: ['Rach', 'Robin'], observationCount: 2,
    });
    expect(ack).toBe(`Got it — I'll remember Rach and Robin.`);
  });

  it('people step three or more names — Oxford comma + "and"', () => {
    const ack = buildAcknowledgement({
      step: 'people',
      learnedNames: ['Rach', 'Robin', 'Mum', 'Dad'],
      observationCount: 4,
    });
    expect(ack).toBe(`Got it — I'll remember Rach, Robin, Mum, and Dad.`);
  });

  it('rhythm step uses count, not names', () => {
    const ack = buildAcknowledgement({ step: 'rhythm', learnedNames: [], observationCount: 4 });
    expect(ack).toMatch(/4 routines/);
    expect(ack).not.toMatch(/Got it — I'll remember/);
  });

  it('rhythm step singular vs plural', () => {
    const one = buildAcknowledgement({ step: 'rhythm', learnedNames: [], observationCount: 1 });
    const many = buildAcknowledgement({ step: 'rhythm', learnedNames: [], observationCount: 5 });
    expect(one).toMatch(/one routine/);
    expect(many).toMatch(/5 routines/);
  });

  it('focus step references the Today tab', () => {
    const ack = buildAcknowledgement({ step: 'focus', learnedNames: [], observationCount: 3 });
    expect(ack.toLowerCase()).toMatch(/today/);
  });

  it('never makes a claim without observation evidence', () => {
    // Empty observations + people step → must NOT say "I'll remember [nobody]"
    const ack = buildAcknowledgement({ step: 'people', learnedNames: [], observationCount: 0 });
    expect(ack).not.toMatch(/I'll remember/);
  });
});
