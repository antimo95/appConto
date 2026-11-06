import { HttpClient, HttpResourceRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { NewPayslip, PayslipAnalysis, PayslipData, PayslipDetail } from './payslip.model';

export function payslipsRequest(): HttpResourceRequest {
  return { url: `${API_BASE_URL}/payslips` };
}

export function payslipSummariesRequest(): HttpResourceRequest {
  return { url: `${API_BASE_URL}/payslip-summaries` };
}

export function payslipRequest(id: string): HttpResourceRequest {
  return { url: `${API_BASE_URL}/payslips/${id}` };
}

export function payslipDocumentUrl(id: string): string {
  return `${API_BASE_URL}/payslips/${id}/document`;
}

/** Le scritture: le letture passano da `httpResource` nella pagina. */
@Injectable({ providedIn: 'root' })
export class PayslipsApi {
  private readonly http = inject(HttpClient);

  /** Il PDF parte com'è, senza multipart: il nome viaggia in un'intestazione. */
  analyze(file: File): Observable<PayslipAnalysis> {
    return this.http.post<PayslipAnalysis>(`${API_BASE_URL}/payslip-analyses`, file, {
      headers: {
        'Content-Type': 'application/pdf',
        'X-File-Name': encodeURIComponent(file.name)
      }
    });
  }

  /** Scarta il PDF temporaneo di un'analisi abbandonata. */
  discardAnalysis(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/payslip-analyses/${id}`);
  }

  create(payslip: NewPayslip): Observable<PayslipDetail> {
    return this.http.post<PayslipDetail>(`${API_BASE_URL}/payslips`, payslip);
  }

  update(id: string, changes: Partial<PayslipData>): Observable<PayslipDetail> {
    return this.http.patch<PayslipDetail>(`${API_BASE_URL}/payslips/${id}`, changes);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/payslips/${id}`);
  }
}
