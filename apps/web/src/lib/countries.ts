/**
 * Countries for a nationality — POOLSE-131.
 *
 * ISO 3166-1 alpha-2 codes are stored; the names come from `Intl.DisplayNames`
 * in the reader's language, so no list of 250 names is translated by hand and
 * "Alemanha" / "Germany" both mean DE. Portugal leads, then the countries a
 * Portuguese club meets most often, then everything by name.
 */

const CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO ' +
  'JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR ' +
  'MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO ' +
  'RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV ' +
  'TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

/** Lusophone and neighbouring countries, after Portugal, before the rest. */
const FIRST = ['PT', 'BR', 'AO', 'CV', 'MZ', 'GW', 'ST', 'TL', 'ES', 'FR', 'GB', 'UA'];

export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale === 'en' ? 'en-GB' : locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Options for a select: Portugal and its neighbours first, then all by name. */
export function countryOptions(locale: string): { value: string; label: string }[] {
  const names = new Intl.DisplayNames([locale === 'en' ? 'en-GB' : locale], { type: 'region' });
  const label = (code: string): string => names.of(code) ?? code;
  const collator = new Intl.Collator(locale);
  const rest = CODES.filter((code) => !FIRST.includes(code))
    .map((code) => ({ value: code, label: label(code) }))
    .sort((a, b) => collator.compare(a.label, b.label));
  return [...FIRST.map((code) => ({ value: code, label: label(code) })), ...rest];
}
