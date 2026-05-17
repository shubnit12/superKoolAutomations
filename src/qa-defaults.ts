/**
 * Keyword-driven answer router for Naukri's apply-chatbot questionnaire.
 *
 * The chatbot asks fairly repetitive questions across jobs:
 *   - Current location
 *   - Current / desired CTC
 *   - Current organisation
 *   - Total / relevant experience
 *   - Notice period
 *   - PAN card
 *   - PF/UAN status
 *   - Preferred-location confirmation (Yes/No)
 *
 * Personal data lives in `.env` (NOT in this file) so the codebase stays
 * publishable. This module just maps question-text patterns to env-var
 * sources and input types.
 *
 * Ordering inside `ENTRIES` matters: more specific patterns must come
 * BEFORE more general ones. Example: /desired.*ctc/ has to be evaluated
 * before /current.*ctc/ would otherwise accidentally match a question
 * like "What is your desired CTC?".
 */

export type InputKind = 'text' | 'radio';

export interface MatchedAnswer {
  /** The literal value to type / select. Always a non-empty string. */
  text: string;
  /** How to feed it into the chatbot UI. */
  kind: InputKind;
  /** Human-readable label for logs. */
  label: string;
  /** Env-var that supplied the answer — useful for caller-side dedup. */
  envVar: string;
}

interface Entry {
  /** Regex tested against the (lowercased) question text. */
  match: RegExp;
  /** Process-env variable that carries the answer value. */
  envVar: string;
  /** UI input type. Defaults to 'text'. */
  kind?: InputKind;
  /** Logging label. */
  label: string;
  /**
   * Fallback value used when `envVar` is unset / empty. Lets us ship
   * sensible positive-leaning defaults ("Yes" to availability /
   * willingness questions) without forcing users to define every env
   * variable upfront. The env-var ALWAYS wins if it's set.
   *
   * A function variant is allowed for values that need to be computed
   * at lookup time (e.g., a date that's "today + 15 days").
   */
  default?: string | (() => string);
}

// Order = priority. Put MORE SPECIFIC patterns first.
const ENTRIES: Entry[] = [
  // ── Compensation ───────────────────────────────────────────────────
  {
    match: /(expected|desired|expecting).*(ctc|salary|compensation|package)/i,
    envVar: 'NAUKRI_DESIRED_CTC',
    label: 'desired CTC',
  },
  {
    match: /(current|present).*(ctc|salary|compensation|package)/i,
    envVar: 'NAUKRI_CURRENT_CTC',
    label: 'current CTC',
  },

  // ── Location ───────────────────────────────────────────────────────
  // Relocation / willingness-to-be-in-city — Yes/No. Anchor on the
  // verbs "residing" / "relocate" / "living in" so we don't conflict
  // with the "what is your current location" text question below.
  {
    match: /(residing|relocate|relocation|willing to work|comfortable.*reloc|are you (currently )?living\s+in)/i,
    envVar: 'NAUKRI_PREFERRED_LOCATION_OK',
    kind: 'radio',
    label: 'relocation willingness',
  },
  {
    match: /preferred.*location.*\?|are you ok.*location/i,
    envVar: 'NAUKRI_PREFERRED_LOCATION_OK',
    kind: 'radio',
    label: 'preferred-location confirmation',
  },
  {
    match: /(current|present).*location|where.*based|where.*you.*live/i,
    envVar: 'NAUKRI_CURRENT_LOCATION',
    label: 'current location',
  },

  // ── Employer ───────────────────────────────────────────────────────
  {
    match: /(current|present).*(organi[sz]ation|company|employer)/i,
    envVar: 'NAUKRI_CURRENT_ORG',
    label: 'current organisation',
  },

  // ── Experience ─────────────────────────────────────────────────────
  // ORDER MATTERS. Each is tested top-to-bottom against the CURRENT
  // bot question only (jobs.ts reads the last .botMsg element, so we
  // never see stale text). More-specific patterns must come first.
  {
    match: /relevant.*experience/i,
    envVar: 'NAUKRI_RELEVANT_EXPERIENCE',
    label: 'relevant experience',
  },
  {
    // Skill-specific NUMERIC question: "How many years of experience
    // do you have in React.Js / Fullstack Development / AWS / ..."
    // The "how many years" / "years of experience" prefix is what
    // distinguishes this from the Yes/No "Do you have experience in X?"
    // question (handled by the positive-default radios further down).
    match: /\b(how many years|years of experience)\b.*\bin\s+\S+/i,
    envVar: 'NAUKRI_RELEVANT_EXPERIENCE',
    label: 'skill-specific experience',
  },
  {
    // True "how many years total" questions. Narrower than before so it
    // doesn't accidentally swallow skill-specific ones.
    match: /(total|overall).*experience|how many years.*(total|overall|of experience)\b(?!.*\bin\b)/i,
    envVar: 'NAUKRI_TOTAL_EXPERIENCE',
    label: 'total experience',
  },

  // ── Misc ───────────────────────────────────────────────────────────────
  {
    // "When is your LWD?" / "Last working day" — text input expecting
    // a date. We compute today + 15 days so it stays consistent with
    // the "15 Days or less" notice-period bucket.
    // Override with NAUKRI_LWD="DD/MM/YYYY" if you have a specific date.
    match: /\bl\.?w\.?d\.?\b|last\s*working\s*day/i,
    envVar: 'NAUKRI_LWD',
    kind: 'text',
    label: 'last working day',
    default: () => {
      const d = new Date();
      d.setDate(d.getDate() + 15);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    },
  },
  {
    // Notice period RADIO — Naukri's chatbot presents 6 fixed options
    // (confirmed from a live debug DOM dump):
    //   "Immediately" / "Within 15 Days" / "30 days" / "45 days" /
    //   "60 days" / "90 days"
    //
    // We default to "Within 15 Days" rather than "Immediately" because:
    //   1. Most Indian employees have at least a 2-week formal NP that
    //      they need to honour, so "Immediately" is rarely truthful.
    //   2. "Within 15 Days" still ranks well in recruiter sorting since
    //      they bucket together everyone <30 days.
    //
    // Override per your situation by setting NAUKRI_NOTICE_PERIOD_OPTION
    // to any of the six labels above.
    match: /notice.*period/i,
    envVar: 'NAUKRI_NOTICE_PERIOD_OPTION',
    kind: 'radio',
    label: 'notice period bucket',
    default: 'Within 15 Days',
  },
  { match: /pan\s*card|pan\s*number/i, envVar: 'NAUKRI_PAN_CARD', label: 'PAN card' },
  {
    match: /pf\s*\/?\s*uan|provident\s*fund|cleared.*uan/i,
    envVar: 'NAUKRI_PF_UAN_CLEARED',
    label: 'PF/UAN cleared',
  },

  // ── Positive-default radios ────────────────────────────────────────
  // Goal: maximise interview callbacks by saying YES to every
  // availability / willingness question Naukri's chatbots commonly ask.
  // Each has `default: 'Yes'`, so they work without ANY env config —
  // but a user can override per-rule by setting the env var.

  {
    match: /(available|free|ok).{0,30}(interview|call|discussion).{0,30}(today|tomorrow|weekend|saturday|sunday|this week|now)|attend.*(interview|call)/i,
    envVar: 'NAUKRI_AVAILABLE_FOR_INTERVIEW',
    kind: 'radio',
    label: 'available for interview',
    default: 'Yes',
  },
  {
    match: /can you join (immediately|asap|right away|within \d+)|are you (immediately )?available to join|join us (immediately|asap)/i,
    envVar: 'NAUKRI_OK_JOIN_IMMEDIATELY',
    kind: 'radio',
    label: 'available to join immediately',
    default: 'Yes',
  },
  {
    match: /are you (currently )?serving.*notice|on.*notice period/i,
    envVar: 'NAUKRI_SERVING_NOTICE',
    kind: 'radio',
    label: 'serving notice',
    default: 'Yes',
  },
  {
    match: /interested.*(role|position|opportunity|job)|are you keen|are you (still )?looking/i,
    envVar: 'NAUKRI_INTERESTED_IN_ROLE',
    kind: 'radio',
    label: 'interested in role',
    default: 'Yes',
  },
  {
    match: /work from office|wfo|return to office|5 days.*office|fully on.?site/i,
    envVar: 'NAUKRI_OK_WFO',
    kind: 'radio',
    label: 'OK with work-from-office',
    default: 'Yes',
  },
  {
    match: /work from home|wfh|hybrid (mode|work)|remote (work|role)/i,
    envVar: 'NAUKRI_OK_WFH',
    kind: 'radio',
    label: 'OK with hybrid / remote',
    default: 'Yes',
  },
  {
    match: /night shift|rotational shift|graveyard|us shift|uk shift|shift work/i,
    envVar: 'NAUKRI_OK_SHIFTS',
    kind: 'radio',
    label: 'OK with shifts',
    default: 'Yes',
  },
  {
    match: /comfortable.*(travel|onsite)|travel.*(client|onsite|abroad)|short[- ]term travel|on.?call|24x7|24\/7/i,
    envVar: 'NAUKRI_OK_TRAVEL_ONCALL',
    kind: 'radio',
    label: 'OK with travel / on-call',
    default: 'Yes',
  },
  {
    match: /have.*(laptop|workstation|desktop|broadband|wifi|internet)|own.*system|own.*device/i,
    envVar: 'NAUKRI_HAS_EQUIPMENT',
    kind: 'radio',
    label: 'has personal equipment',
    default: 'Yes',
  },
  {
    match: /(b\.?tech|bachelor|graduate|post\s*graduate|m\.?tech|engineering)\s*(degree|complete|done|passed)?/i,
    envVar: 'NAUKRI_IS_GRADUATE',
    kind: 'radio',
    label: 'is a graduate',
    default: 'Yes',
  },
  {
    // Generic "Do you have experience in X / hands-on X / worked on X"
    // skill-presence question. Defaulting Yes maximises calls; user can
    // set NAUKRI_HAS_SKILL_EXPERIENCE=No to be conservative.
    match: /(do you have|have you|are you familiar|hands[- ]on|worked (on|with)).*(experience|exposure|knowledge|familiarity)/i,
    envVar: 'NAUKRI_HAS_SKILL_EXPERIENCE',
    kind: 'radio',
    label: 'has skill experience',
    default: 'Yes',
  },
  {
    // Broader past-experience pattern — "Have you worked on X?" /
    // "Have you used X?" / "Have you built X?" — without requiring an
    // "experience" suffix. Catches things like:
    //   "Have you worked on Microsoft Dynamics 365, Business Central?"
    //   "Have you used Kubernetes in production?"
    //   "Did you implement caching strategies?"
    match: /\b(have you (worked|used|built|developed|implemented|deployed|integrated|managed|led|designed|architected|delivered|shipped|launched|maintained|created|owned|written|coded|automated|migrated|refactored)|did you (work|use|build|develop|implement|deliver|ship))/i,
    envVar: 'NAUKRI_HAS_WORKED_ON',
    kind: 'radio',
    label: 'has worked on tech',
    default: 'Yes',
  },
  {
    // "Please apply if you are open for Direct contract / 3-month
    // contract / fixed-term role" — a confirmation gate, often a free
    // text input rather than a radio. Saying "Yes" passes the gate
    // without filtering us out of recruiter pipelines. The "contratc"
    // misspelling is intentional — recruiters routinely typo this.
    match: /direct\s*contract|fixed[- ]term|contract\s*\(?\s*\d+\s*month|open\s+for\s+(direct\s+)?contract|contratc/i,
    envVar: 'NAUKRI_OPEN_TO_CONTRACT',
    kind: 'text',
    label: 'open to contract role',
    default: 'Yes',
  },
];

/**
 * Find the first matching answer for a chatbot question.
 *
 * @param question      Text to test against the rule patterns. Usually the
 *                      inner text of the chatbot drawer.
 * @param excludeEnvVars Set of env-var names to ignore (questions already
 *                      answered in this job's chatbot session). Lets the
 *                      caller iterate without re-firing the same rule.
 *
 * Returns `null` if:
 *   - no remaining pattern matches the question, OR
 *   - a pattern matches but the corresponding env-var is unset / empty.
 *
 * The caller decides how to handle a null (typically: check for the
 * "Thank you for your responses" success marker; if absent, bail on the job).
 */
export function findAnswer(
  question: string,
  excludeEnvVars: Set<string> = new Set(),
): MatchedAnswer | null {
  const normalized = question.trim();
  for (const entry of ENTRIES) {
    if (excludeEnvVars.has(entry.envVar)) continue;
    if (!entry.match.test(normalized)) continue;

    // Resolution order: env-var > rule default > skip.
    const fromEnv = (process.env[entry.envVar] ?? '').trim();
    const fromDefault =
      typeof entry.default === 'function'
        ? entry.default().trim()
        : (entry.default ?? '').trim();
    const value = fromEnv || fromDefault;

    if (!value) {
      console.warn(
        `[qa] matched "${entry.label}" but env ${entry.envVar} is unset ` +
          `and no built-in default — skipping`,
      );
      continue;
    }
    return {
      text: value,
      kind: entry.kind ?? 'text',
      label: entry.label,
      envVar: entry.envVar,
    };
  }
  return null;
}

/**
 * Exported only for tests / debugging — lets you see the rules at a glance.
 */
export function describeRules(): Array<{ label: string; pattern: string; envVar: string; kind: InputKind }> {
  return ENTRIES.map((e) => ({
    label: e.label,
    pattern: e.match.source,
    envVar: e.envVar,
    kind: e.kind ?? 'text',
  }));
}
