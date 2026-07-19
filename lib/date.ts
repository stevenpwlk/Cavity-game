/** Date calendaire (YYYY-MM-DD) à Paris — sert de clé au défi homologué du jour. */
export function parisDateISO(at: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(at); // en-CA -> YYYY-MM-DD
}
