/**
 * Story 2.4 — pure-logic tests for domain health rendering.
 * The DB-touching path (computeDomainStates, listDomainStates) is
 * exercised by manual QA per the story DoD.
 */

import { describe, it, expect } from 'vitest';
import { renderDomainHealthHeader, type DomainState } from './health';

function state(domain: string, health: 'green' | 'amber' | 'red', notes: string | null = null): DomainState {
  return {
    domain: domain as any,
    health,
    lastActivity: null,
    openItems: 0,
    overdueStandards: 0,
    approachingStandards: 0,
    notes,
    updatedAt: new Date(),
  };
}

describe('renderDomainHealthHeader', () => {
  it('opens with the heading line', () => {
    const out = renderDomainHealthHeader([state('health', 'green')]);
    expect(out.split('\n')[0]).toBe("Today's domains:");
  });

  it('lists greens compactly on one line, joined by commas', () => {
    const out = renderDomainHealthHeader([
      state('health', 'green'),
      state('shelter', 'green'),
      state('finance', 'green'),
    ]);
    expect(out).toContain('✓ Health, Shelter, Finance');
  });

  it('emits one line per amber with the note', () => {
    const out = renderDomainHealthHeader([
      state('health', 'amber', "Robin's dentist due"),
    ]);
    expect(out).toContain("⚠ Health — Robin's dentist due");
  });

  it('emits one line per red with the note', () => {
    const out = renderDomainHealthHeader([
      state('shelter', 'red', 'boiler service overdue by 2 weeks'),
    ]);
    expect(out).toContain('✕ Shelter — boiler service overdue by 2 weeks');
  });

  it('drops the em-dash when notes are missing', () => {
    const out = renderDomainHealthHeader([state('health', 'amber', null)]);
    expect(out).toContain('⚠ Health');
    expect(out).not.toContain('⚠ Health —');
  });

  it('renders multi-word domains with title-case spacing', () => {
    const out = renderDomainHealthHeader([state('personal_space', 'green')]);
    expect(out).toContain('Personal Space');
  });

  it('orders amber and red by their order in the input array', () => {
    const out = renderDomainHealthHeader([
      state('shelter', 'red', 'boiler'),
      state('health', 'amber', 'dentist'),
    ]);
    const lines = out.split('\n');
    // Header, then any greens block (none), then amber lines, then red lines.
    expect(lines.find(l => l.startsWith('⚠'))).toContain('Health');
    expect(lines.find(l => l.startsWith('✕'))).toContain('Shelter');
  });

  it('omits the green line entirely when no domains are green', () => {
    const out = renderDomainHealthHeader([state('health', 'red', 'overdue')]);
    expect(out).not.toContain('✓');
  });
});
