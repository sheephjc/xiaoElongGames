interface HiddenPieceBackProps {
  className?: string
}

export function HiddenPieceBack({ className = '' }: HiddenPieceBackProps) {
  return (
    <span className={`${className} dark-piece-back`}>
      <span className="dark-piece-back-ring" />
      <span className="dark-piece-back-mark" />
    </span>
  )
}
