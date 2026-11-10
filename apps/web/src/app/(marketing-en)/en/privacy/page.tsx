import type { Metadata } from 'next';
import { LegalPage } from '../../../../marketing/legal';

export const metadata: Metadata = { title: 'Privacy policy — Poolse' };

export default function Page(): React.ReactElement {
  return <LegalPage locale="en" document="privacy" />;
}
