import type { Metadata } from 'next';
import { LegalPage } from '../../../marketing/legal';

export const metadata: Metadata = { title: 'Política de privacidade — Poolse' };

export default function Page(): React.ReactElement {
  return <LegalPage locale="pt-PT" document="privacy" />;
}
