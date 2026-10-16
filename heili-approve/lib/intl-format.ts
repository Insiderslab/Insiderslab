/**
 * Shared Intl.DateTimeFormat instances.
 *
 * Building a formatter costs about 0.1 ms; formatting with one is ~100 times
 * cheaper. Pages that list hundreds of posts formatted every date with fresh
 * formatters (two or three per date, counting the time-zone check): the
 * portal home of a 360-post client spent ~150 ms of its 177 ms there
 * (QA 2026-10-16). Same output, one instance per locale and options.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();
const zones = new Map<string, boolean>();
/** Bound: options come from code, not from users, but keep the cache finite anyway. */
const MAX_ENTRIES = 500;

/** `new Intl.DateTimeFormat(locale, options)`, reused. Throws like the constructor for an invalid time zone. */
export function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    if (formatters.size >= MAX_ENTRIES) formatters.clear();
    formatters.set(key, formatter);
  }
  return formatter;
}

/** True when the runtime knows this IANA time zone (the answer is remembered). */
export function isValidTimeZone(timeZone: string): boolean {
  let valid = zones.get(timeZone);
  if (valid === undefined) {
    try {
      new Intl.DateTimeFormat("it-IT", { timeZone });
      valid = true;
    } catch {
      valid = false;
    }
    if (zones.size >= MAX_ENTRIES) zones.clear();
    zones.set(timeZone, valid);
  }
  return valid;
}
