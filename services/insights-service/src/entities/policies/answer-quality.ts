/**
 * Quality rules of a Q&A answer that the CODE enforces (the user never sees process chatter):
 * no apologies / retractions / mentions of a previous report or of the verification, and the first line must answer the question.
 */
const CHATTER = [
  /\b(retiro|retiré|retiramos|retira|retirar|se retira[n]?|aclaro|aclaraci[oó]n|aclaramos|disculp\w*|perd[oó]n|lamento|lo siento|corrijo|rectifico|rectificaci[oó]n)\b/i,
  /tienes raz[oó]n|ten[eé]s raz[oó]n|llevas raz[oó]n/i,
  /\b(reporte|respuesta|informe|resumen|versi[oó]n|borrador)\s+(anterior|previ[oa])\b/i,
  /\b(mi|el)\s+(reporte|informe)\s+(inicial|original)\b/i,
  /verificaci[oó]n\s+(de\s+)?(cifras|n[uú]meros|datos)|no (aparece|figura)[n]? en (ning[uú]n|los) resultado/i,
  /\b(i apologi[sz]e|apologies|sorry|my mistake|you(?:'re| are) (right|correct)|i (retract|withdraw|correct)|let me correct|retracting|correction:)\b/i,
  /\b(previous|earlier|prior|original)\s+(report|answer|response|summary|version|draft)\b/i,
  /\b(figures?|numbers?)\b.{0,40}\b(not (backed|supported|found)|no tool result|unsupported)\b/i,
];

export function hasProcessChatter(text: string): boolean {
  return CHATTER.some((re) => re.test(text));
}

const NOT_AN_ANSWER = /^[*_\s>-]*(per[ií]odo|period|fecha|date|consulta|query|rango|range|resumen|summary|datos|data|herramienta|tool)\b[^:]{0,30}:/i;

/** The first content line of the markdown, without heading marks. */
export function firstLine(markdown: string): string {
  return markdown.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
}

/** A direct answer: first line is a sentence (not a heading or a "Period: …" preamble). */
export function startsWithAnswer(markdown: string): boolean {
  const line = firstLine(markdown);
  return line.length >= 8 && !line.startsWith('#') && !NOT_AN_ANSWER.test(line);
}

/** Explicit summaries / reports keep the report format; everything else is a question and gets the Q&A format. */
export function isSummaryRequest(question: string): boolean {
  return /\b(res[uú]men|resume|res[uú]meme|summary|summari[sz]e|overview|informe|panorama|balance general|reporte (completo|general|semanal|mensual|de la)|(weekly|monthly|full|complete) report|(dame|genera\w*|prepara\w*|elabora\w*|give me|generate|write|produce|prepare) (un |el |a |the )?(reporte|report)\b)/i.test(question);
}

/** Plain text for the narration: the direct answer without markdown marks. */
export function plainAnswer(markdown: string): string {
  return firstLine(markdown).replace(/[*_`#>]/g, '').trim();
}
