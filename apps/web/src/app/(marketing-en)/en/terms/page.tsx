import type { Metadata } from 'next';
import { LegalPage } from '../../../../marketing/legal';

export const metadata: Metadata = { title: 'Terms of use — Poolse' };

export default function Page(): React.ReactElement {
  return <LegalPage locale="en" document="terms" />;
}
