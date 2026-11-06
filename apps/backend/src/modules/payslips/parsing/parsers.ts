import type { PayslipParser } from './payslip-parser.js';
import { zucchettiLulParser } from './zucchetti-lul.parser.js';

/**
 * I formati riconosciuti, in ordine di tentativo.
 *
 * Un formato nuovo si aggiunge qui con un proprio parser: nient'altro cambia.
 */
export const PAYSLIP_PARSERS: readonly PayslipParser[] = [zucchettiLulParser];
