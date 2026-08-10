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

export function PenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0 0-3l-.5-.5a2.1 2.1 0 0 0-3 0l-10 10L4 20Z" />
      <path d="m13.5 7 3.5 3.5" />
      <path d="m5 15 4 4" />
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

// Info-Symbol fuer den "Eigenschaften"-Button (Seiten-Properties).
export function InfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.8v.1" />
    </IconBase>
  )
}

// Dokument mit eingeknickter Ecke fuer den "PDF einfuegen"-Button (DrawingCanvas-Toolbar) -
// bewusst ein einfaches generisches Datei-Symbol statt kleingedruckter "PDF"-Buchstaben, die bei
// 20px Icon-Groesse nicht mehr lesbar waeren.
export function PdfIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 13h5" />
      <path d="M9.5 16.5h5" />
    </IconBase>
  )
}

// Gestrichelte, freie Schlaufe mit kleinem Seil-Ende fuer den Lasso-Auswahl-Button
// (DrawingCanvas-Toolbar) - die gestrichelte Kontur greift optisch vorweg, wie die tatsaechliche
// Auswahlkontur beim Zeichnen aussieht (siehe drawDashedPath in DrawingCanvas.tsx).
export function LassoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path
        d="M12 4c3 0 5.5 1.1 7 2.9 1.3 1.6 1.3 3.6 0 5.2-1.7 2-4.6 3.1-7.6 3.1-2.3 0-4.4-.6-5.8-1.8-1.3-1.1-1.7-2.5-1.1-3.8C5.6 6.7 8.6 4 12 4Z"
        strokeDasharray="2.3 2.3"
      />
      <path d="M9.3 13.6c-.5 1.1-.2 2.4.7 3 .9.6 2.1.2 2.5-.9" />
    </IconBase>
  )
}

// Kleiner Papierkorb fuer den "Auswahl löschen"-Button, der erscheint, sobald eine
// Lasso-Auswahl aktiv ist (DrawingCanvas-Toolbar).
export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </IconBase>
  )
}
