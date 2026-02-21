// api/lib/intent-classifier.js
// Simple yes/no/unclear classifier for user confirmations

const YES_WORDS = ["yes", "y", "yeah", "yep", "ok", "okay", "sure", "go ahead", "do it", "please", "yea", "ow"];
const NO_WORDS = ["no", "n", "nah", "nope", "cancel", "skip", "never mind", "nevermind", "don't", "dont", "stop"];

export function classifyConfirmation(text) {
  const lower = text.toLowerCase().trim();

  for (const w of YES_WORDS) {
    if (lower === w || lower.startsWith(w + " ") || lower.startsWith(w + ",") || lower.startsWith(w + ".")) {
      return "yes";
    }
  }

  for (const w of NO_WORDS) {
    if (lower === w || lower.startsWith(w + " ") || lower.startsWith(w + ",") || lower.startsWith(w + ".")) {
      return "no";
    }
  }

  return "unclear";
}
