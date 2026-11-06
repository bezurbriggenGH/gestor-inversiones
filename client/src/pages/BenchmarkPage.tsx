export function BenchmarkPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Benchmark</h1>
      <div className="rounded-xl border border-dashed border-line p-8 text-sm text-muted">
        <p className="text-base text-text">Próximamente</p>
        <p className="mt-2">Vas a poder comparar el rendimiento de tu cartera contra:</p>
        <ul className="mt-2 list-inside list-disc">
          <li>El índice Merval</li>
          <li>El S&amp;P 500 (vía el CEDEAR SPY)</li>
          <li>La inflación (IPC del INDEC)</li>
          <li>Haber dejado la plata en dólares MEP</li>
        </ul>
      </div>
    </div>
  );
}
