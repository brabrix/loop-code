import { describe, it, expect } from 'vitest';
import { filterAndSortProjects } from './projectFilter.js';

const P = [
  { path: '/a', name: 'Zebra' },
  { path: '/b', name: 'alfa' },
  { path: '/c', name: 'Maçã' },
];

describe('filterAndSortProjects', () => {
  it('sem query e sort default preserva a ordem', () => {
    expect(filterAndSortProjects(P, { query: '', sort: 'default' }).map((p) => p.name)).toEqual([
      'Zebra',
      'alfa',
      'Maçã',
    ]);
  });

  it('filtra por nome case-insensitive', () => {
    expect(filterAndSortProjects(P, { query: 'AL', sort: 'default' }).map((p) => p.name)).toEqual([
      'alfa',
    ]);
  });

  it('ignora acentos na busca', () => {
    expect(filterAndSortProjects(P, { query: 'maca', sort: 'default' }).map((p) => p.name)).toEqual(
      ['Maçã'],
    );
  });

  it('ordena asc/desc sem diferenciar maiúsculas', () => {
    expect(filterAndSortProjects(P, { query: '', sort: 'asc' }).map((p) => p.name)).toEqual([
      'alfa',
      'Maçã',
      'Zebra',
    ]);
    expect(filterAndSortProjects(P, { query: '', sort: 'desc' }).map((p) => p.name)).toEqual([
      'Zebra',
      'Maçã',
      'alfa',
    ]);
  });

  it('não muta o array de entrada', () => {
    const copy = [...P];
    filterAndSortProjects(P, { query: '', sort: 'asc' });
    expect(P).toEqual(copy);
  });
});
