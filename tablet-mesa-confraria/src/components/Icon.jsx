// Wrapper fino pros ícones lineares dos mockups — todos seguem o mesmo
// padrão (stroke currentColor, sem fill), só o "d" do path muda.
export default function Icon({ path, className = 'w-4 h-4', strokeWidth = 1.6 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} className={className}>
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
