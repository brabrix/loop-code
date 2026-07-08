// Busca + ordenação da lista "IA por projeto". Puro (sem React) pra testar fácil.
// sort: 'default' preserva a ordem recebida (a ordem do Rail); 'asc'/'desc' por nome.
const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function filterAndSortProjects(projects, { query = '', sort = 'default' } = {}) {
  const q = norm(query).trim();
  let out = q ? projects.filter((p) => norm(p.name).includes(q)) : projects.slice();
  if (sort === 'asc' || sort === 'desc') {
    out = out.slice().sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
    if (sort === 'desc') out.reverse();
  }
  return out;
}
