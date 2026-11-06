import type { getTranslations } from 'next-intl/server';
import type { BoletimData, BoletimPlacement } from '@poolse/rules';
import { countryName } from '@/lib/countries';
import type { FpnPrint } from '@/lib/fpn-forms';

/**
 * What a club's form says about a person, in Portuguese whoever reads it —
 * POOLSE-193. One definition, read by the print pages and by the phone's PDF, so
 * the two cannot disagree on a value.
 */

type Portuguese = Awaited<ReturnType<typeof getTranslations>>;

/** What `GET /students/:id/boletim` returns — POOLSE-134. */
export interface BoletimPrint {
  clubName: string;
  socioNumber: string | null;
  socioSince: string | null;
  isSocio: boolean;
  name: string;
  birthDate: string | null;
  taxNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine: string | null;
  locality: string | null;
  postalCode: string | null;
  parentOneName: string | null;
  parentTwoName: string | null;
  maritalStatus: string | null;
  profession: string | null;
  education: string | null;
  birthplace: string | null;
  nationality: string | null;
  minor: boolean;
  guardian: { name: string; phone: string | null; email: string | null; relationship: string | null } | null;
  /** The club's own form (POOLSE-142), or null for Poolse's. */
  template: { fileId: string; fields: BoletimPlacement[] } | null;
  /** Present only when the club's form places it. */
  idDocumentNumber: string | null;
  snsNumber: string | null;
}

export function boletimFormValues(data: BoletimPrint, pt: Portuguese): BoletimData {
  return {
    name: data.name,
    parentOneName: data.parentOneName,
    parentTwoName: data.parentTwoName,
    birthDate: data.birthDate,
    maritalStatus: data.maritalStatus === null ? null : pt(`students.identity.marital.${data.maritalStatus}`),
    profession: data.profession,
    education: data.education,
    birthplace: data.birthplace,
    nationality: data.nationality === null ? null : countryName(data.nationality, 'pt-PT'),
    addressLine: data.addressLine,
    locality: data.locality,
    postalCode: data.postalCode,
    phone: data.contactPhone,
    email: data.contactEmail,
    taxNumber: data.taxNumber,
    idDocumentNumber: data.idDocumentNumber,
    snsNumber: data.snsNumber,
    socioNumber: data.socioNumber,
    socioSince: data.socioSince,
    guardian: data.guardian,
  };
}

export function fpnFormValues(data: FpnPrint, season: string | null, pt: Portuguese): BoletimData {
  return {
    name: data.studentName,
    parentOneName: null,
    parentTwoName: null,
    birthDate: null,
    maritalStatus: null,
    profession: null,
    education: null,
    birthplace: null,
    nationality: null,
    addressLine: data.addressLine,
    locality: data.locality,
    postalCode: data.postalCode,
    phone: null,
    email: null,
    taxNumber: null,
    idDocumentNumber: data.idDocumentNumber,
    snsNumber: null,
    socioNumber: null,
    socioSince: null,
    guardian: null,
    fpn: {
        signerName: data.signerName === '' ? null : data.signerName,
        season,
        association: data.association,
        clubCode: data.clubCode,
        place: data.place,
        idDocumentType: data.idDocumentType === null ? null : pt(`documents.idDocument.types.${data.idDocumentType}`),
        issuedOn: data.issuedOn,
        validUntil: data.validUntil,
        disciplines: data.disciplines,
    },
  };
}
