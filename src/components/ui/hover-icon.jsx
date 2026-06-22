import { useEffect, useRef } from 'react';

// Liga a animação de um ícone lucide-animated ao hover do BOTÃO pai inteiro,
// não só do svg pequeno. Necessário em botões largos (ícone + texto), onde
// passar o mouse no texto não dispararia a animação interna do ícone.
//
// Drop-in: troque <EarthIcon size={15} /> por <HoverIcon as={EarthIcon} size={15} />.
// Passar o ref deixa o ícone em modo "controlado" (o hover interno dele desliga),
// e nós guiamos via startAnimation/stopAnimation no hover do <button> ancestral.
export function HoverIcon({ as: Icon, ...props }) {
  const iconRef = useRef(null);
  const probeRef = useRef(null);

  useEffect(() => {
    const btn = probeRef.current?.closest('button');
    if (!btn) return;
    const enter = () => iconRef.current?.startAnimation?.();
    const leave = () => iconRef.current?.stopAnimation?.();
    btn.addEventListener('mouseenter', enter);
    btn.addEventListener('mouseleave', leave);
    return () => {
      btn.removeEventListener('mouseenter', enter);
      btn.removeEventListener('mouseleave', leave);
    };
  }, []);

  return (
    <>
      {/* Sonda invisível (display:none, fora do fluxo flex) só pra achar o botão. */}
      <span ref={probeRef} className="hidden" aria-hidden="true" />
      <Icon ref={iconRef} {...props} />
    </>
  );
}
