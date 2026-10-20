import { ModuleGate } from '@/components/module-gate';

/** POOLSE-87 sweep: the water report belongs to the water_quality module. */
export default function Layout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ModuleGate module="water_quality">{children}</ModuleGate>;
}
