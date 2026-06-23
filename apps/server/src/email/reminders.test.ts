import { describe, expect, it } from 'vitest';
import { renderAdminInactivity, renderUrgentInactivity, renderUserReminder } from './reminders';

describe('login-reminder renderers', () => {
  it('user reminder cites the gap and links sign-in', () => {
    const m = renderUserReminder({ login: 'shakil', name: 'Shakil Ahmed', hours: 26 });
    expect(m.subject).toMatch(/log in/i);
    expect(m.html).toContain('Shakil');
    expect(m.html).toContain('/auth/github');
    expect(m.text).toContain('26h');
  });

  it('admin summary lists each inactive member', () => {
    const m = renderAdminInactivity([
      { login: 'shakil', name: null, hours: 25, emailed: true },
      { login: 'dana', name: null, hours: 40, emailed: false },
    ]);
    expect(m.subject).toContain('2 members');
    expect(m.html).toContain('shakil');
    expect(m.html).toContain('dana');
    expect(m.text).toContain('reminded');
  });

  it('urgent alert is flagged URGENT and escapes names', () => {
    const m = renderUrgentInactivity([{ login: 'evil', name: '<b>x</b>', hours: 50, emailed: true }]);
    expect(m.subject).toMatch(/^URGENT/);
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.html).toContain('&lt;b&gt;');
    expect(m.text).toMatch(/48h/);
  });
});
