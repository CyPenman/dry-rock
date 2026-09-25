import { describe, expect, it } from 'vitest';
import { feedbackEmailFields, observationEmailFields } from '../src/api/reports.ts';
import { extractReports } from './extract-reports.mjs';

const observation = {
  id: 'stanage-popular-1790000000',
  cragId: 'stanage-popular',
  observedAtSec: 1790000000,
  condition: 'damp',
  note: 'green streaks "still" wet & slimy',
  snapshot: {
    sourceModel: 'ukmo_seamless',
    S: 0.4,
    M: 3.2,
    Mmax: 8,
    Trock: 9.5,
    climbable: false,
    tempC: 11,
    dewPointC: 8.2,
    windSpeedMs: 3,
    vpdKpa: 0.3,
    precipLast24hMm: 4.1,
    limitingFactor: 'rain',
    dayScore: 0.31,
    frictionHourScore: 0.5,
  },
  sentAtSec: 1790000100,
};

/** What FormSubmit's table template does to a value, then what Gmail's mbox export does to the HTML. */
function asHtmlEmail(fields) {
  const html = Object.entries(fields)
    .map(([k, v]) => `<tr><th>${k}</th><td>${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}</td></tr>`)
    .join('\n');
  // quoted-printable: '=' escaped, lines wrapped at 76 with soft breaks
  const qp = html.replace(/=/g, '=3D');
  return qp.match(/.{1,75}/g).join('=\n');
}

describe('emailed reports round-trip (§8.1)', () => {
  it('recovers an observation from a quoted-printable HTML email', () => {
    const [report] = extractReports(`From x\nSubject: y\n\n${asHtmlEmail(observationEmailFields(observation))}`);
    expect(report.kind).toBe('observation');
    expect(report.observation.note).toBe(observation.note);
    expect(report.observation.snapshot).toEqual(observation.snapshot);
    expect(report.observation.sentAtSec).toBeUndefined();
    expect(typeof report.appBuild).toBe('string');
  });

  it('recovers feedback from plain text, and several reports from one file', () => {
    const fb = feedbackEmailFields({ topic: 'crag', message: 'Add Almscliff {please}', name: 'Sam' }, 1790000500);
    expect(fb._replyto).toBeUndefined();
    const text = [fb, observationEmailFields(observation)].map((f) => Object.values(f).join('\n')).join('\n\n');
    const reports = extractReports(text);
    expect(reports.map((r) => r.kind)).toEqual(['feedback', 'observation']);
    expect(reports[0].message).toBe('Add Almscliff {please}');
  });

  it('puts the crag and what was seen in the subject', () => {
    expect(observationEmailFields(observation)._subject).toMatch(/^Dry Rock observation \| stanage-popular \| Damp \| \d{4}-\d\d-\d\d \d\d:\d\d$/);
  });
});
