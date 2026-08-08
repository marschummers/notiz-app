// Kleine Linien-Icons fuer die Zeichen-Toolbar (ersetzen die bisherigen Text-Buttons) - als
// Inline-SVG statt einer Icon-Library, passend zu den vom Nutzer bereitgestellten Referenzbildern
// (Aufgabe.png/Textfeld.png/Radierer.png/Rückgängig.png/Leeren.png). Alle nutzen currentColor,
// damit sie automatisch die Button-Textfarbe (inkl. aktivem Kupfer-Zustand) uebernehmen.
import type { SVGProps } from 'react'

function IconBase(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={20}
      height={20}
      {...props}
    />
  )
}

export function TaskIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3.5" />
      <path d="M7.5 12.5 10.5 15.5 16.5 9" />
    </IconBase>
  )
}

export function TextFieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M9 9.5h6" />
      <path d="M12 9.5v6" />
    </IconBase>
  )
}

export function EraserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </IconBase>
  )
}

export function UndoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5A5.5 5.5 0 0 1 20 14.5v0A5.5 5.5 0 0 1 14.5 20H11" />
    </IconBase>
  )
}

export function BroomIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M20 4 12.5 11.5" />
      <path d="M11 13 6 18a2.5 2.5 0 0 0 3.5 3.5L14 16.5" />
      <path d="m9 15.5-2.5 2.5" />
      <path d="m11.5 18-2.5 2.5" />
      <path d="m17 7 1.5-1.5" />
      <path d="m19.5 9.5 1.5-1.5" />
      <path d="m15 5 1-1" />
    </IconBase>
  )
}
