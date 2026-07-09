import { describe, it, expect } from 'vitest';
import { normalizeRect, rectsIntersect } from './marquee.js';

describe('normalizeRect', () => {
  it('normaliza arraste em qualquer direção', () => {
    expect(normalizeRect(10, 20, 4, 8)).toEqual({ left: 4, top: 8, right: 10, bottom: 20 });
  });
});

describe('rectsIntersect', () => {
  const box = { left: 0, top: 0, right: 100, bottom: 20 };
  it('true quando o retângulo cruza a linha', () => {
    expect(rectsIntersect({ left: 5, top: 5, right: 50, bottom: 30 }, box)).toBe(true);
  });
  it('false quando está totalmente acima', () => {
    expect(rectsIntersect({ left: 5, top: -30, right: 50, bottom: -5 }, box)).toBe(false);
  });
  it('false quando está totalmente à direita', () => {
    expect(rectsIntersect({ left: 120, top: 5, right: 140, bottom: 15 }, box)).toBe(false);
  });
});
