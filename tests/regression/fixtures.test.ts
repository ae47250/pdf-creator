import { describe, expect, it } from 'vitest';
import { parsePdfCreationRequest } from '@/lib/pdf/contract';
import { invalidScenarios, malformedCssScenario, payloadFor, requiredScenarioIds, successFixtures } from './fixtures';

describe('production regression fixture catalog', () => {
  it('maps every required fixture category to a stable scenario', () => {
    expect(requiredScenarioIds).toHaveLength(22);
    expect(new Set(requiredScenarioIds).size).toBe(22);
    expect(invalidScenarios).toHaveLength(7);
    expect(malformedCssScenario.id).toBe('malformed-css');
  });

  it.each(Object.values(successFixtures).filter((fixture) => fixture.id !== 'large'))('keeps $id contract-valid', (fixture) => {
    expect(parsePdfCreationRequest(payloadFor(fixture)).filename).toBe(fixture.filename);
  });

  it('keeps the generated large fixture below the permitted HTML ceiling', () => {
    const parsed = parsePdfCreationRequest(payloadFor(successFixtures.large));
    expect(Buffer.byteLength(parsed.html)).toBeLessThanOrEqual(3_500_000);
    expect(Buffer.byteLength(parsed.html)).toBeGreaterThan(2_900_000);
  });

  it('keeps application-specific HTML and CSS visibly distinct', () => {
    expect(successFixtures.appBlue.html).toContain('#0b5cad');
    expect(successFixtures.appGold.html).toContain('#8a5a00');
    expect(successFixtures.appBlue.html).not.toContain('Application Gold');
    expect(successFixtures.appGold.html).not.toContain('Application Blue');
  });

  it('keeps natural-flow qualification fixtures free of fixed markers and exact page assertions', () => {
    expect(successFixtures.flowing20.html).not.toContain('data-pdf-page');
    expect(payloadFor(successFixtures.flowing20)).not.toHaveProperty('expectedPageCount');
  });
});
