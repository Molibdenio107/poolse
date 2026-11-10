/**
 * A site's postal address — 10-11-2026 (Rui): *Distrito* and *País* beside the
 * morada, código postal and localidade.
 */

/**
 * Portugal's 18 distritos and its two regiões autónomas, as they are written.
 * A site in Portugal picks one of these; elsewhere the field is free text.
 */
export const PT_DISTRICTS = [
  'Aveiro',
  'Beja',
  'Braga',
  'Bragança',
  'Castelo Branco',
  'Coimbra',
  'Évora',
  'Faro',
  'Guarda',
  'Leiria',
  'Lisboa',
  'Portalegre',
  'Porto',
  'Santarém',
  'Setúbal',
  'Viana do Castelo',
  'Vila Real',
  'Viseu',
  'Região Autónoma dos Açores',
  'Região Autónoma da Madeira',
] as const;

function plain(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(distrito|district|regiao autonoma|autonomous region)\s+(de|do|da|dos|das|of)\s+/, '')
    .replace(/\s+district$/, '')
    .trim();
}

/**
 * The distrito a geocoder's region names, or null — so choosing a town can fill
 * it in. "Distrito de Aveiro", "Aveiro", "Lisbon District" and "Azores" all land;
 * anything not recognised is left for the person to pick.
 */
export function ptDistrictFrom(region: string | null | undefined): (typeof PT_DISTRICTS)[number] | null {
  if (region === null || region === undefined || region.trim() === '') return null;
  const wanted = plain(region);
  const aliases: Record<string, (typeof PT_DISTRICTS)[number]> = {
    lisbon: 'Lisboa',
    oporto: 'Porto',
    acores: 'Região Autónoma dos Açores',
    azores: 'Região Autónoma dos Açores',
    madeira: 'Região Autónoma da Madeira',
  };
  if (aliases[wanted] !== undefined) return aliases[wanted];
  return PT_DISTRICTS.find((one) => plain(one) === wanted) ?? null;
}

/** Whether a value is one of Portugal's distritos, exactly as listed. */
export function isPtDistrict(value: string): boolean {
  return (PT_DISTRICTS as readonly string[]).includes(value);
}

/**
 * ISO 3166-1 alpha-2, every assigned code. The screen names them in the reader's
 * language with `Intl.DisplayNames`; the API accepts only these.
 */
export const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS ' +
  'BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE ' +
  'EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM ' +
  'HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC ' +
  'LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA ' +
  'NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO ' +
  'TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

export function isCountryCode(value: string): boolean {
  return COUNTRY_CODES.includes(value);
}
