import { ModuleGate } from '@/components/module-gate';

/** POOLSE-87: avisos are a kind of message, so the messages module (POOLSE-166). */
export default function Layout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ModuleGate module="messages">{children}</ModuleGate>;
}
