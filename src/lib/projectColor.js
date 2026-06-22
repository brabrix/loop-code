// Cor e iniciais do "avatar" de um projeto sem ícone próprio. Fica num módulo só pra
// o rail e a paleta de comandos usarem EXATAMENTE a mesma cor — a pessoa associa o
// projeto pelo ícone, então o fallback precisa ser consistente nos dois lugares.
export function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 45%)`;
}

export function initials(name) {
  return (name || '').slice(0, 2).toUpperCase();
}
