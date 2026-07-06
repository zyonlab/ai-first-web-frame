export type TestComponentProps = { label: string };

export function TestComponent({ label }: TestComponentProps) {
  return <span>{label}</span>;
}
