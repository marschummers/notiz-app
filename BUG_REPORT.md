# Bug Report: Apple Pencil Input wird nach schnellem Absetzen/Aufsetzen für ~1-2s komplett ignoriert

## Kurzfassung

In einer Web-App (Safari/WKWebView auf iPadOS), die eine vollflächige Zeichenfläche per
Pointer Events API implementiert, wird der Apple Pencil nach jedem kurzen Abheben
und erneuten Aufsetzen (< ca. 1-2 Sekunden Pause) für etwa 1-2 Sekunden komplett
ignoriert – es kommt **kein einziges** DOM-Event (nicht mal `pointerenter`/`pointerover`)
bei der Seite an. Danach funktioniert die Eingabe wieder normal, bis zum nächsten
schnellen Absetzen/Aufsetzen. Für Handschrift (Wortabstände, i-Punkt, t-Strich,
Satzzeichen) macht das die Eingabe unbrauchbar, da genau diese Bewegungen ständig
vorkommen.

Live-Reproduktion: https://marschummers.github.io/notiz-app/
Quellcode: https://github.com/marschummers/notiz-app (siehe `src/App.tsx`, `src/App.css`)

## Umgebung

- iPadOS: aktuelle Version (Update während der Diagnose durchgeführt, Fehler bestand vorher und nachher identisch)
- Browser: Safari, sowohl als normaler Tab als auch als installierte PWA ("Zum Home-Bildschirm") – auf iOS ist WebKit ohnehin die einzige verfügbare Engine, unabhängig vom Browser-Namen
- Apple Pencil: Hover-fähiges Modell (bestätigt durch `pointerenter`/`pointerover`-Events, die vor `pointerdown` feuern, sobald der Stift sich der Fläche nähert, ohne die Fläche zu berühren)
- Stack der Test-App: React 19 + Vite 8, TypeScript, deployed als statische PWA (vite-plugin-pwa) auf GitHub Pages

## Reproduktion

1. Seite öffnen, mit dem Stift einen Strich zeichnen und den Stift normal abheben
2. Innerhalb von ca. 1-2 Sekunden die Fläche mit dem Stift erneut berühren
3. Erwartung: neuer Strich beginnt sofort
4. Tatsächlich: nichts passiert. Wartet man stattdessen ca. 1-2 Sekunden nach dem
   Abheben, bevor man erneut aufsetzt, funktioniert es zuverlässig.

## Relevanter Code (vereinfacht)

```tsx
// Eingabe laeuft auf einem transparenten <div> ueber dem <canvas>, nicht auf dem
// <canvas> selbst (Begruendung siehe Abschnitt "Bereits gefundene und behobene
// Teilprobleme", Punkt 3).
<div className="canvas-wrap">
  <canvas ref={canvasRef} className="canvas" style={{ pointerEvents: 'none' }} />
  <div
    ref={overlayRef}
    className="overlay" // touch-action: none; -webkit-user-drag: none; -webkit-touch-callout: none;
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={endStroke}
    onPointerCancel={endStroke}
    onPointerLeave={endStroke}
    onLostPointerCapture={endStroke}
    onPointerEnter={handleHover}
    onPointerOver={handleHover}
    onPointerOut={handleHover}
  />
</div>
```

```ts
function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
  e.preventDefault() // wird IMMER zuerst aufgerufen, auch fuer Events die wir ignorieren
  // ... Palm-Rejection-Logik ...
  overlay.setPointerCapture(e.pointerId)
  // ... Stroke-Start ...
}
```

Vollständiger Code im Repo, Commit-Historie zeigt die einzelnen Debugging-Schritte.

## Bereits gefundene und behobene Teilprobleme (nicht die Ursache des Kernbugs)

Auf dem Weg zur Diagnose wurden mehrere echte, separate Bugs gefunden und behoben.
Keiner davon war die Ursache des Kernproblems, aber der Vollständigkeit halber:

1. **Fehlendes `preventDefault()` auf ignorierten Pointerdown-Events**: Wenn ein
   Touch-Event wegen Palm-Rejection ignoriert wurde, fehlte `preventDefault()` in
   diesem Codepfad. Dadurch griff iOS' native Text-Markierungs-Geste. Fix: 
   `preventDefault()` wird jetzt unconditional als erstes aufgerufen, unabhängig
   davon ob das Event später ignoriert wird.

2. **Nicht selbst-heilender Pointer-Capture-Zustand**: Falls ein `pointerup` je
   verloren ginge, würde die App den nächsten `pointerdown` fälschlich ignorieren.
   Fix: ein neuer Pencil-`pointerdown` beendet einen "hängen gebliebenen" Strich
   jetzt hart, statt sich blockieren zu lassen. Zusätzlich `releasePointerCapture`
   explizit aufgerufen und `onLostPointerCapture` als zusätzliches Sicherheitsnetz.

3. **`<canvas>` mit gerendertem Inhalt wird von Safari wie ein `<img>` behandelt**:
   Bei Kontakt des Stifts *auf oder nahe bereits gezeichneter Tinte* erschien ein
   natives iPadOS-"Teilen"-Panel (Systemleiste), das die Touch-Sequenz komplett
   abfing. Trat NUR über vorhandener Tinte auf, nie auf leerer Fläche – auch mit
   `-webkit-user-drag: none` und `-webkit-touch-callout: none` auf dem Canvas
   nicht behebbar. Fix: Pointer-Events laufen jetzt auf einem separaten,
   transparenten `<div>`-Overlay über dem Canvas; das Canvas selbst hat
   `pointer-events: none` und dient nur der Darstellung, wodurch Safaris
   "Bild-Heuristik" es nicht mehr als interaktives Share-Ziel erkennt.

Nach Fix von (3) verschwand das "Teilen"-Panel vollständig. Der Kernbug (Abheben +
schnelles Wiederaufsetzen wird ignoriert) besteht davon **unabhängig weiter** –
auch auf komplett leerer Fläche, ganz ohne Tinte in der Nähe.

## Ausschlussverfahren für den Kernbug

1. **Eigene Event-Logik als Ursache**: ausgeschlossen. Ein sichtbares On-Screen-
   Log (Zeitstempel + Event-Typ für down/up/cancel/leave/lostcapture/enter/over/out)
   wurde eingebaut. Während des "hängenden" Fensters erscheint **buchstäblich kein
   einziger Eintrag** – auch keine Hover-Events. Das Event kommt nicht verzögert
   oder falsch verarbeitet an, es kommt **gar nicht** an der Seite an.

2. **iOS Bedienungshilfen ("Touch Accommodations" / "Wiederholungen ignorieren")**:
   ausgeschlossen, war auf dem Testgerät deaktiviert.

3. **iPadOS-Versions-Bug**: ausgeschlossen. Update auf die zum Testzeitpunkt
   aktuelle iPadOS-Version durchgeführt, Verhalten identisch vorher/nachher.

4. **System-weite Pencil/Digitizer-Debounce (Hardware-/OS-Ebene, unabhängig von
   der jeweiligen App)**: ausgeschlossen. Exakt dieselbe Geste (schnelles Abheben +
   Wiederaufsetzen) wurde getestet:
   - auf einer leeren `about:blank`-Seite in Safari → **kein** Aussetzer
   - in Apples nativer Notizen-App (kein WebView, nutzt PencilKit) → **kein** Aussetzer
   
   Das beweist: Es ist weder ein reines iOS/Pencil-Hardwareverhalten noch ein
   allgemeines Safari/WebKit-Verhalten, sondern spezifisch mit unserer Seite bzw.
   ihrer Art der Touch-Interaktion verknüpft.

5. **Canvas-als-Bild-Heuristik (siehe Teilproblem 3 oben)**: ausgeschlossen als
   (vollständige) Ursache. Nach dem Overlay-Div-Fix verschwand das sichtbare
   "Teilen"-Panel, der Kernbug (stiller Aussetzer ohne jegliches UI) blieb
   bestehen, auch fernab jeglicher gezeichneter Tinte.

## Aktuelle Arbeitshypothese

Da der Bug ausschließlich auf unserer Seite auftritt (nicht auf `about:blank`,
nicht in einer nativen App), aber nicht mehr auf den Canvas/Bild-Mechanismus
zurückzuführen ist, vermuten wir, dass WebKit/iPadOS auf Elemente mit
`touch-action: none` in Kombination mit `setPointerCapture`/`preventDefault`
eine interne Geste-Arbitrierung anwendet – vermutlich um "echten neuen Kontakt"
von einem kurzen Aufprall/Jitter der Stiftspitze direkt nach dem Abheben zu
unterscheiden, und/oder um einen mehrdeutigen Hover→Touch-Zustandsübergang
(bei hover-fähigen Pencils) aufzulösen. Dieser Mechanismus scheint unterhalb der
Pointer-Events-Dispatch-Ebene in WebKits/UIKits Touch-Pipeline zu laufen, da
buchstäblich keine DOM-Events (auch keine niedrigschwelligen wie `pointerenter`)
während des betroffenen Fensters ausgelöst werden.

## Noch nicht getestete Ansätze (Vorschläge für die Weiteruntersuchung)

- `touch-action` probeweise weniger restriktiv setzen (z.B. `pan-y` statt `none`)
  und beobachten, ob die Arbitrierung dann ausbleibt (Kompromiss: native
  Scroll-/Zoom-Gesten müssten dann separat unterbunden werden)
- Test **ohne** `setPointerCapture`-Aufruf, um Wechselwirkungen mit Capture
  auszuschließen
- Test mit den älteren **Touch Events** (`touchstart`/`touchmove`/`touchend`)
  statt Pointer Events – zeigt sich das gleiche Verhalten dort auch, deutet das
  auf eine Ebene unterhalb sogar der Pointer-Events-Implementierung hin
  (UIKit-Gesture-Recognizer-Ebene)
- Minimal-Repro ganz ohne React/Vite/Service-Worker/PWA-Manifest/restriktive
  Viewport-Meta-Tags bauen, um App-Tooling als Faktor komplett auszuschließen
- bugs.webkit.org und Apple Developer Forums / Feedback Assistant nach
  bestehenden Reports durchsuchen (Suchbegriffe z.B. "Apple Pencil pointer
  events dropped", "PointerEvent pen lift recontact ignored")
- Test mit einem nicht-hover-fähigen Apple Pencil (1. Generation) bzw. auf
  einem iPad ohne Hover-Support, um zu prüfen ob der zusätzliche
  Hover-Zustandsautomat ursächlich beteiligt ist
