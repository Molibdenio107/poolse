import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

/**
 * Public routes, listed explicitly. Everything not on this list requires a
 * session — the same default-deny shape the API uses, for the same reason: a new
 * page should be protected because nobody remembered to protect it, not
 * unprotected because nobody remembered to.
 */
const isPublicRoute = createRouteMatcher([
  '/',
  '/pricing',
  // The English marketing pages. `/en(.*)` rather than listing each one, because
  // marketing pages will keep being added and forgetting to make one public
  // would send a visitor to a sign-in screen from a search result.
  // With the slash — sweep of 15-10-2026: '/en(.*)' also made '/energy…' public.
  '/en',
  '/en/(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  // POOLSE-71's public water page, opened from a QR at the entrance by people
  // who have no account. It reads one token and nothing else.
  '/agua/(.*)',
  // POOLSE-69's public sign-up form, linked from a club's own website. It
  // reads and writes through the API's slug-keyed public routes and nothing else.
  '/inscricao/(.*)',
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  // Skips Next internals and static files, runs on everything else including
  // route handlers. Lifted from Clerk's documented matcher rather than invented.
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
