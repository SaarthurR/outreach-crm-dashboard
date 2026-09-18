/**
 * Address parsing for the Blast tab, kept apart from `gmail.ts` so the UI can
 * import it without pulling in googleapis.
 */

// Pasting from Gmail gives you "Name <a@b.com>, Other <c@d.com>", pasting from a
// sheet gives you one per line, pasting from a doc gives you whatever it gives you.
// Rather than guess the separator, pick the addresses out of whatever arrives.
const EMAIL_PATTERN = /[^\s<>,;"']+@[^\s<>,;"']+\.[a-z]{2,}/gi;

export function parseRecipients(text: string) {
  const seen = new Set<string>();
  const addresses: string[] = [];
  let duplicates = 0;

  for (const match of text.match(EMAIL_PATTERN) ?? []) {
    // A trailing comma or period rides along when someone writes a sentence.
    const address = match.replace(/[.,;]+$/, "").toLowerCase();

    if (seen.has(address)) {
      // Two identical emails to one inbox in one run is the fastest way to the spam folder.
      duplicates += 1;
      continue;
    }

    seen.add(address);
    addresses.push(address);
  }

  return { addresses, duplicates };
}
