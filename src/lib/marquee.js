// Geometria da seleção retangular (marquee) da árvore de arquivos. Puro, testável
// sem DOM. Coords em px de viewport (getBoundingClientRect).
export function normalizeRect(x0, y0, x1, y1) {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1),
  };
}

export function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
