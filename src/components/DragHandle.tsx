import './DragHandle.css'

interface Props {
  onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => void
  onTouchMove: (e: React.TouchEvent<HTMLDivElement>) => void
  onTouchEnd: (e: React.TouchEvent<HTMLDivElement>) => void
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  className?: string
}

// Sechs-Punkte-Greifpunkt zum Verschieben per Drag - gleiches Muster wie der Task-Griff in
// DrawingCanvas.tsx, hier wiederverwendet fuer Ordner/Seiten (siehe lib/useDragReorder.ts).
// Eigenes onClick-Stop noetig, da die Zeile/Kachel selbst ein Oeffnen/Auswaehlen per Klick hat.
export default function DragHandle({ onTouchStart, onTouchMove, onTouchEnd, onMouseDown, className = '' }: Props) {
  return (
    <div
      className={`drag-handle ${className}`.trim()}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  )
}
