import { ModuleGate } from '@/components/module-gate';

/** POOLSE-87: these pages belong to the maintenance module. */
export default function Layout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ModuleGate module="maintenance">{children}</ModuleGate>;
}
