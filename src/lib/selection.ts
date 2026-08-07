// Was gerade in der Seitenliste angezeigt wird: entweder der Inhalt eines Ordners
// (id === undefined => Wurzelebene, nicht abgelegte Seiten) oder alle Seiten mit einem Tag.
export type Selection = { type: 'folder'; id: string | undefined } | { type: 'tag'; id: string }
