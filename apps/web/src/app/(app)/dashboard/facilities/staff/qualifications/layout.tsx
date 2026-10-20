import { ModuleGate } from '@/components/module-gate';

/** POOLSE-87: these pages belong to the qualifications module. */
export default function Layout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ModuleGate module="qualifications">{children}</ModuleGate>;
}
