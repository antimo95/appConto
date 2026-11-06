import { sweepStaleRunDirs } from './run-dirs.js';

/**
 * Prima dei test: si eliminano le cartelle temporanee di corse precedenti
 * rimaste sul disco (per esempio dopo un Ctrl+C), mai quella della corsa
 * attuale né quelle di un server ancora vivo.
 */
export default function globalSetup(): void {
  for (const dir of sweepStaleRunDirs(process.env.APPCONTO_E2E_DIR)) {
    console.log(`[e2e] rimossa cartella temporanea rimasta: ${dir}`);
  }
}
