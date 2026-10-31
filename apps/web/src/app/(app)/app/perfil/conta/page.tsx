import { redirect } from 'next/navigation';

/**
 * Folded into `/app/perfil` (Rui, 31-10-2026, mockup B): the photo in the
 * header opens one screen with the profile on top. Kept as a redirect so a
 * link saved to the old address still lands.
 */
export default function OldAccountPage(): never {
  redirect('/app/perfil');
}
