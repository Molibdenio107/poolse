import type { Metadata } from 'next';
import { LegalPage } from '../../../marketing/legal';

export const metadata: Metadata = { title: 'Termos de utilização — Poolse' };

export default function Page(): React.ReactElement {
  return <LegalPage locale="pt-PT" document="terms" />;
}
