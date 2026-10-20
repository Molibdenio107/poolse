import { ModuleGate } from '@/components/module-gate';

/** POOLSE-87: these pages belong to the vacations module. */
export default function Layout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ModuleGate module="vacations">{children}</ModuleGate>;
}
