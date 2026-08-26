import { UserButton } from '@clerk/nextjs';
import { AppSidebar } from '../app-sidebar';
import { PreferenceControls } from '../preference-controls';

/**
 * The backoffice shell.
 *
 * Everything under `/dashboard` renders inside it, which is what finally made
 * good on the note left on `PreferenceControls`: the language and theme controls
 * were copied into fifteen page headers waiting for a shell to move into. This is
 * the shell. Each page is now just its own content — a heading and the work —
 * and the furniture lives in one file.
 *
 * The controls are handed to the sidebar as children rather than imported by it.
 * They are server components, and the sidebar has to be a client component to
 * read the current path; passing them through is how the two meet without
 * dragging the account menu and the theme toggle into the client bundle.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AppSidebar>
        <PreferenceControls />
        <UserButton />
      </AppSidebar>

      {/*
        `min-w-0` is not decoration. Without it a flex child refuses to shrink
        below its content, and one wide table anywhere in the app pushes the
        whole page sideways instead of scrolling inside its own container.
      */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
